import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { TicketAttachment } from '../../entities/ticket-attachment.entity';
import { Contact } from '../../entities/contact.entity';
import { TicketStatus, TicketPriority, TicketAuthorType, TicketChannel } from '../../common/enums';
import { StorageService } from '../../storage/storage.service';

export interface ZammadAttachment {
  filename: string;
  mime_type: string;
  size_bytes: number;
  local_path: string | null;
}
export interface ZammadArticle {
  author_type: string;
  body: string;
  created_at: string;
  attachments: ZammadAttachment[];
}
export interface ZammadTicketFull {
  id: number | string;
  legacy_group: string;
  title: string;
  status: string;
  priority: string;
  customer_email: string;
  customer_name: string;
  organization: string;
  created_at: string;
  articles: ZammadArticle[];
}
export interface ImportOptions {
  dryRun: boolean;
  outDir: string;       // carpeta local con los NDJSON (y attachments_*/)
  failReport: string;   // archivo donde escribir el reporte de fallidos
  attachmentsPrefix: string; // prefijo en MinIO (default 'tickets')
  limit?: number;       // para prueba parcial
}
export interface ImportResult {
  read: number;
  dryRun: boolean;
  ticketsCreated: number;
  ticketsSkipped: number;
  ticketsFailed: number;
  matchedByEmail: number;
  unmatched: number;
  messagesImported: number;
  attachmentsImported: number;
  attachmentsFailed: number;
  byGroup: Record<string, number>;
  failures: Array<{ id: string; group: string; reason: string }>;
}

// Opciones y resultado del modo "attachment-only": migra los adjuntos de tickets
// de Zammad YA importados (sin tocar tickets/mensajes). Para re-exportar Zammad
// con adjuntos (ZAMMAD_INCLUDE_ATTACHMENTS=1) y completar la migración pendiente.
export interface AttachmentsOnlyOptions {
  dryRun: boolean;
  outDir: string;            // carpeta con los NDJSON (con attachments + local_path)
  failReport: string;
  attachmentsPrefix: string; // prefijo en MinIO (default 'tickets')
  limit?: number;            // nº máximo de tickets a procesar (para prueba chica)
  ticketIds?: number[];      // si se pasa, procesar SOLO esos id de Zammad (prueba chica)
}
export interface AttachmentsOnlyResult {
  read: number;
  dryRun: boolean;
  ticketsProcessed: number;
  ticketsSkipped: number;
  ticketsFailed: number;
  messagesMatched: number;
  attachmentsCreated: number;
  attachmentsSkipped: number;
  attachmentsFailed: number;
  bytesUploaded: number;
  failures: Array<{ ticketId: string; articleIdx: number; filename: string; reason: string }>;
}

// Los grupos de soporte reales; el resto (Users/Backups MK/Taller/Ventas) es ruido.
export const SUPPORT_GROUPS = ['L1', 'L2', 'L3'];

@Injectable()
export class TicketImportService {
  private readonly logger = new Logger(TicketImportService.name);

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
    @InjectRepository(TicketAttachment) private readonly attachments: Repository<TicketAttachment>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly storage: StorageService,
    private readonly dataSource: DataSource,
  ) {}

  private mapStatus(z: string): TicketStatus {
    const s = z.toLowerCase();
    if (s.includes('closed')) return TicketStatus.CERRADO;
    if (s.includes('resolved')) return TicketStatus.RESUELTO;
    if (s.includes('pending')) return TicketStatus.ESPERANDO_CLIENTE;
    if (s.includes('open')) return TicketStatus.ABIERTO;
    return TicketStatus.NUEVO;
  }
  private mapPriority(p: string): TicketPriority {
    const s = p.toLowerCase();
    if (s.includes('4') || s.includes('urgent')) return TicketPriority.CRITICA;
    if (s.includes('3') || s.includes('high')) return TicketPriority.ALTA;
    if (s.includes('1') || s.includes('low')) return TicketPriority.BAJA;
    return TicketPriority.NORMAL;
  }
  private mapAuthor(a: string): TicketAuthorType {
    if (a === 'customer') return TicketAuthorType.CLIENTE;
    if (a === 'system') return TicketAuthorType.SISTEMA;
    return TicketAuthorType.TECNICO;
  }

  // Mapas precargados para resolver el mapeo sin consultar la BD por cada ticket.
  private contactByEmail: Map<string, { customerId: string | null; contactId: string }> = new Map();

  private async loadMaps(): Promise<void> {
    const contacts = await this.contacts.find();
    this.contactByEmail = new Map();
    for (const c of contacts) {
      if (c.email) this.contactByEmail.set(c.email.toLowerCase().trim(), { customerId: c.customerId, contactId: c.id });
    }
  }

  private async resolveCustomerContact(t: ZammadTicketFull): Promise<{
    customerId: string | null;
    contactId: string | null;
    matched: boolean;
  }> {
    const email = (t.customer_email || '').toLowerCase().trim();
    // Único criterio de mapeo: por email del contacto (sin falsos positivos por
    // nombre). Si el email no matchea un contact existente, el ticket queda sin
    // cliente (customer_id = NULL), visible y filtrable, para revisión manual.
    if (email) {
      const hit = this.contactByEmail.get(email);
      if (hit) return { customerId: hit.customerId, contactId: hit.contactId, matched: true };
    }
    return { customerId: null, contactId: null, matched: false };
  }

  private async importTicket(
    t: ZammadTicketFull,
    result: ImportResult,
    opts: ImportOptions,
  ): Promise<void> {
    // Idempotencia: si ya existe el legacy_zammad_id, skip.
    const existing = await this.tickets.findOne({ where: { legacyZammadId: String(t.id) } });
    if (existing) {
      result.ticketsSkipped++;
      return;
    }

    const { customerId, contactId, matched } = await this.resolveCustomerContact(t);
    if (matched) result.matchedByEmail++;
    else result.unmatched++;
    const groupKey = t.legacy_group || '(sin grupo)';
    result.byGroup[groupKey] = (result.byGroup[groupKey] || 0) + 1;

    if (opts.dryRun) {
      result.ticketsCreated++;
      result.messagesImported += (t.articles || []).length;
      result.attachmentsImported += (t.articles || []).reduce((n, a) => n + (a.attachments || []).length, 0);
      return;
    }

    // Transacción por ticket (con mensajes y adjuntos). Directo a base.
    await this.dataSource.transaction(async (mgr) => {
      const ticket = mgr.create(Ticket, {
        customerId,
        contactId,
        title: t.title || '(sin título)',
        status: this.mapStatus(t.status),
        priority: this.mapPriority(t.priority),
        source: 'email',
        shadow: false,
        legacyZammadId: String(t.id),
        legacyGroup: t.legacy_group || null,
        subjectKey: t.title ? t.title.toLowerCase().trim() : '',
        firstResponseAt: null,
        resolvedAt: null,
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.created_at),
      });
      const saved = await mgr.save(ticket);

      for (const a of t.articles || []) {
        const msg = mgr.create(TicketMessage, {
          ticketId: saved.id,
          authorType: this.mapAuthor(a.author_type),
          channel: TicketChannel.EMAIL,
          body: a.body || '',
          fromEmail: t.customer_email || null,
          createdAt: new Date(a.created_at),
          updatedAt: new Date(a.created_at),
        });
        const savedMsg = await mgr.save(msg);
        result.messagesImported++;

        for (const att of a.attachments || []) {
          if (!att.local_path) { result.attachmentsFailed++; continue; }
          try {
            const full = path.resolve(opts.outDir, att.local_path);
            const buffer = readFileSync(full);
            const { url } = await this.storage.putObject(
              buffer,
              att.filename,
              att.mime_type || 'application/octet-stream',
              opts.attachmentsPrefix || 'tickets',
            );
            await mgr.insert(TicketAttachment, {
              ticketMessageId: savedMsg.id,
              fileUrl: url,
              filename: att.filename,
              mimeType: att.mime_type || 'application/octet-stream',
              sizeBytes: att.size_bytes || buffer.length,
            });
            result.attachmentsImported++;
          } catch (e) {
            result.attachmentsFailed++;
            throw e; // rollback la transacción del ticket (falla el ticket completo)
          }
        }
      }
    });

    result.ticketsCreated++;
  }

  async import(opts: ImportOptions): Promise<ImportResult> {
    const result: ImportResult = {
      read: 0,
      dryRun: opts.dryRun,
      ticketsCreated: 0,
      ticketsSkipped: 0,
      ticketsFailed: 0,
      matchedByEmail: 0,
      unmatched: 0,
      messagesImported: 0,
      attachmentsImported: 0,
      attachmentsFailed: 0,
      byGroup: {},
      failures: [],
    };

    // Precargar los mapas de mapeo (contactos por email) para no consultar la BD
    // por cada uno de los ~40k tickets.
    await this.loadMaps();
    this.logger.log(`Mapas de mapeo: ${this.contactByEmail.size} contactos`);

    // Lee los NDJSON del directorio (tickets_*.ndjson), en orden.
    const files = readdirSorted(opts.outDir, /^tickets_\d+\.ndjson$/);
    this.logger.log(`NDJSON encontrados: ${files.length} (${opts.outDir})`);

    let processed = 0;
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        if (opts.limit && result.ticketsCreated >= opts.limit) break;
        let t: ZammadTicketFull;
        try {
          t = JSON.parse(line);
        } catch (e) {
          result.failures.push({ id: '?', group: '?', reason: `JSON inválido: ${(e as Error).message}` });
          result.ticketsFailed++;
          continue;
        }
        result.read++;
        try {
          await this.importTicket(t, result, opts);
        } catch (e) {
          result.ticketsFailed++;
          result.failures.push({ id: String(t.id), group: t.legacy_group || '?', reason: (e as Error).message });
          this.logger.warn(`Fallo ticket ${t.id}: ${(e as Error).message}`);
        }
        processed++;
        if (processed % 250 === 0) {
          this.logger.log(`Procesados ${processed} (creados=${result.ticketsCreated}, fallos=${result.ticketsFailed})`);
        }
      }
      if (opts.limit && result.ticketsCreated >= opts.limit) break;
    }

    // Reporte de fallidos a archivo (si el usuario lo pide).
    if (opts.failReport) {
      const report = [
        `# Reporte de importación tickets Zammad`,
        `Leídos: ${result.read}`,
        `Creados: ${result.ticketsCreated}`,
        `Omitidos (ya existían): ${result.ticketsSkipped}`,
        `Fallidos: ${result.ticketsFailed}`,
        `Con cliente por email: ${result.matchedByEmail}`,
        `Sin cliente: ${result.unmatched}`,
        `Mensajes: ${result.messagesImported}`,
        `Adjuntos: ${result.attachmentsImported} (fallidos ${result.attachmentsFailed})`,
        ``,
        `## Por grupo:`,
        ...Object.entries(result.byGroup).map(([g, n]) => `  - ${g}: ${n}`),
        ``,
        `## Fallidos:`,
        ...result.failures.map((f) => `  - ${f.id} [${f.group}] -> ${f.reason}`),
        ``,
      ].join('\n');
      writeFileSync(opts.failReport, report, 'utf8');
      this.logger.log(`Reporte de fallidos: ${opts.failReport}`);
    }

    this.logger.log(
      `Import tickets: ${result.ticketsCreated} creados, ${result.ticketsSkipped} omitidos, ` +
        `${result.ticketsFailed} fallidos, ${result.matchedByEmail} con cliente, ${result.unmatched} sin cliente, ` +
        `${result.messagesImported} mensajes, ${result.attachmentsImported} adjuntos.`,
    );
    return result;
  }

  // ==========================================================================
  // Modo "attachment-only": migra SOLO los adjuntos de tickets de Zammad que ya
  // se importaron a SolidOps (los que tienen legacy_zammad_id). No toca tickets
  // ni mensajes (ya existen); solo completa la cola de adjuntos que quedó sin
  // migrar. Idempotente: no duplica un adjunto ya presente en un mensaje.
  //
  // Relies on the same NDJSON export (re-exportado con ZAMMAD_INCLUDE_ATTACHMENTS=1)
  // con attachments[].local_path apuntando a attachments_NNNNNN/<article>/<att>/<file>.
  // El join ticket->mensaje se hace por índice en orden de created_at (el import
  // original creó un mensaje por artículo en ese mismo orden, verificado 1:1).
  // ==========================================================================
  async importAttachmentsOnly(opts: AttachmentsOnlyOptions): Promise<AttachmentsOnlyResult> {
    const result: AttachmentsOnlyResult = {
      read: 0,
      dryRun: opts.dryRun,
      ticketsProcessed: 0,
      ticketsSkipped: 0,
      ticketsFailed: 0,
      messagesMatched: 0,
      attachmentsCreated: 0,
      attachmentsSkipped: 0,
      attachmentsFailed: 0,
      bytesUploaded: 0,
      failures: [],
    };

    const files = readdirSorted(opts.outDir, /^tickets_\d+\.ndjson$/);
    this.logger.log(`[ATTACH-ONLY] NDJSON: ${files.length} (${opts.outDir}) dryRun=${opts.dryRun}`);

    let processed = 0;
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const lines = content.split(/\r?\n/).filter((l) => l.trim());
      for (const line of lines) {
        let t: ZammadTicketFull;
        try {
          t = JSON.parse(line);
        } catch (e) {
          result.ticketsFailed++;
          result.failures.push({ ticketId: '?', articleIdx: 0, filename: '?', reason: `JSON inválido: ${(e as Error).message}` });
          continue;
        }
        result.read++;

        // Filtros de prueba: limit global y/o lista explícita de ids.
        if (opts.ticketIds && !opts.ticketIds.includes(Number(t.id))) continue;
        if (opts.limit && result.ticketsProcessed >= opts.limit) break;

        try {
          await this.processTicketAttachments(t, result, opts);
        } catch (e) {
          result.ticketsFailed++;
          result.failures.push({ ticketId: String(t.id), articleIdx: 0, filename: '?', reason: `Fallo ticket: ${(e as Error).message}` });
          this.logger.warn(`[ATTACH-ONLY] Fallo ticket ${t.id}: ${(e as Error).message}`);
        }
        processed++;
        if (processed % 1000 === 0) {
          this.logger.log(`[ATTACH-ONLY] ...procesados ${processed} (creados=${result.attachmentsCreated}, fallos=${result.attachmentsFailed})`);
        }
      }
      if (opts.limit && result.ticketsProcessed >= opts.limit) break;
    }

    if (opts.failReport) {
      const report = [
        `# Reporte de migración de adjuntos (attachment-only)`,
        `Leídos: ${result.read}`,
        `Tickets procesados: ${result.ticketsProcessed}`,
        `Tickets omitidos: ${result.ticketsSkipped}`,
        `Tickets fallidos: ${result.ticketsFailed}`,
        `Mensajes emparejados: ${result.messagesMatched}`,
        `Adjuntos creados: ${result.attachmentsCreated}`,
        `Adjuntos omitidos (ya existían): ${result.attachmentsSkipped}`,
        `Adjuntos fallidos: ${result.attachmentsFailed}`,
        `Bytes subidos: ${result.bytesUploaded} (${(result.bytesUploaded / 1048576).toFixed(2)} MB)`,
        ``,
        `## Fallidos:`,
        ...result.failures.map((f) => `  - ticket ${f.ticketId} [art ${f.articleIdx}] ${f.filename} -> ${f.reason}`),
        ``,
      ].join('\n');
      writeFileSync(opts.failReport, report, 'utf8');
      this.logger.log(`Reporte de fallidos: ${opts.failReport}`);
    }

    this.logger.log(
      `[ATTACH-ONLY] tickets=${result.ticketsProcessed} (skip ${result.ticketsSkipped}, fail ${result.ticketsFailed}) ` +
        `adjuntos creados=${result.attachmentsCreated} omitidos=${result.attachmentsSkipped} fallidos=${result.attachmentsFailed} ` +
        `(${(result.bytesUploaded / 1048576).toFixed(2)} MB)`,
    );
    return result;
  }

  private async processTicketAttachments(
    t: ZammadTicketFull,
    result: AttachmentsOnlyResult,
    opts: AttachmentsOnlyOptions,
  ): Promise<void> {
    const ticket = await this.tickets.findOne({ where: { legacyZammadId: String(t.id) } });
    if (!ticket) {
      result.ticketsSkipped++;
      this.logger.warn(`[ATTACH-ONLY] ticket ${t.id} no está migrado en SolidOps; se omite.`);
      return;
    }
    result.ticketsProcessed++;

    const articles = t.articles || [];
    if (articles.length === 0) return;

    // Mensajes existentes del ticket.
    const messages = await this.messages.find({ where: { ticketId: ticket.id } });
    if (messages.length !== articles.length) {
      // Desincronización inesperada: no asumir, registrar y fallar este ticket.
      throw new Error(
        `desincronización: ${articles.length} artículos en NDJSON vs ${messages.length} mensajes en SolidOps`,
      );
    }

    // Clave determinística por mensaje: (created_at, body normalizado). El body
    // se normaliza (lower + colapsar espacio) porque la importación pudo guardar
    // variantes de whitespace/saltos de línea, pero el contenido textual coincide.
    const usedMessageIds = new Set<string>();
    const normalizedByKey = new Map<string, TicketMessage>();
    for (const m of messages) {
      const key = `${new Date(m.createdAt).toISOString()}\u0000${normalizeBody(m.body)}`;
      // Si dos mensajes colapsan a la misma clave (misma fecha y mismo body
      // normalizado) son indistinguibles: cualquiera sirve para sus adjuntos.
      normalizedByKey.set(key, m);
    }

    // Registros de adjuntos ya presentes por mensaje (para idempotencia).
    const existingByMessage = new Map<string, Set<string>>();
    const attRows = await this.attachments.find({ where: { ticketMessageId: In(messages.map((m) => m.id)) } });
    for (const a of attRows) {
      if (!existingByMessage.has(a.ticketMessageId)) existingByMessage.set(a.ticketMessageId, new Set());
      existingByMessage.get(a.ticketMessageId)!.add(`${a.filename}\u0000${a.sizeBytes}`);
    }

    for (let ai = 0; ai < articles.length; ai++) {
      const article = articles[ai];
      const key = `${new Date(article.created_at).toISOString()}\u0000${normalizeBody(article.body)}`;
      let msg = normalizedByKey.get(key);
      if (!msg) {
        // Fallback defensivo (no debería ocurrir): emparejar por fecha exacta sin
        // body, si hay un único mensaje con esa fecha aún sin usar.
        const byDate = messages.find((m) => !usedMessageIds.has(m.id) &&
          new Date(m.createdAt).getTime() === new Date(article.created_at).getTime());
        msg = byDate || messages[ai];
      }
      if (!msg || usedMessageIds.has(msg.id)) {
        throw new Error(
          `imposible emparejar artículo ${ai} (created=${article.created_at}) con un mensaje del ticket ${t.id}`,
        );
      }
      usedMessageIds.add(msg.id);
      result.messagesMatched++;

      for (const att of article.attachments || []) {
        const akey = `${att.filename}\u0000${att.size_bytes}`;
        if (existingByMessage.get(msg.id)?.has(akey)) {
          result.attachmentsSkipped++;
          continue;
        }
        if (!att.local_path) {
          result.attachmentsFailed++;
          result.failures.push({ ticketId: String(t.id), articleIdx: ai, filename: att.filename || '?', reason: 'sin local_path' });
          continue;
        }

        const full = path.resolve(opts.outDir, att.local_path);
        let buffer: Buffer;
        try {
          buffer = readFileSync(full);
        } catch (e) {
          result.attachmentsFailed++;
          result.failures.push({ ticketId: String(t.id), articleIdx: ai, filename: att.filename || '?', reason: `archivo no leíble: ${(e as Error).message}` });
          continue;
        }
        // Tamaño real en disco contra metadata del export: si no coincide, avisar
        // (puede ser normal para base64 viejo) pero NO frenar.
        if (att.size_bytes && buffer.length !== Number(att.size_bytes)) {
          this.logger.warn(`[ATTACH-ONLY] tamaño difiere (disk=${buffer.length} vs meta=${att.size_bytes}) en ${att.filename}`);
        }
        if (opts.dryRun) {
          result.attachmentsCreated++;
          result.bytesUploaded += buffer.length;
          continue;
        }
        try {
          const { url } = await this.storage.putObject(
            buffer,
            sanitizeFilename(att.filename),
            att.mime_type || 'application/octet-stream',
            opts.attachmentsPrefix || 'tickets',
          );
          await this.attachments.insert({
            ticketMessageId: msg.id,
            fileUrl: url,
            filename: att.filename,
            mimeType: att.mime_type || 'application/octet-stream',
            sizeBytes: att.size_bytes || buffer.length,
          });
          result.attachmentsCreated++;
          result.bytesUploaded += buffer.length;
        } catch (e) {
          result.attachmentsFailed++;
          result.failures.push({ ticketId: String(t.id), articleIdx: ai, filename: att.filename || '?', reason: (e as Error).message });
          this.logger.warn(`[ATTACH-ONLY] fallo adjunto ${att.filename}: ${(e as Error).message}`);
        }
      }
    }
  }
}

function readdirSorted(dir: string, re: RegExp): string[] {
  const { readdirSync } = require('fs');
  return readdirSync(dir)
    .filter((f: string) => re.test(f))
    .sort()
    .map((f: string) => path.join(dir, f));
}

function sanitizeFilename(name: string): string {
  const base = String(name || '').replace(/[/\\]/g, '_').replace(/[^0-9a-zA-Z._-]/g, '_');
  return base || 'archivo';
}

// Normaliza el body para comparación determinística: el contenido de un artículo
// de Zammad y el mensaje migrado en SolidOps pueden variar en whitespace/saltos
// de línea, pero el texto coincide. También normaliza UTF-8 a mínima forma NFC.
function normalizeBody(s: string): string {
  return (s || '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
