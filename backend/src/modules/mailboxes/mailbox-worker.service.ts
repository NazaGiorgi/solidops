import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImapFlow } from 'imapflow';
import { Readable } from 'stream';
import { Mailbox } from '../../entities/mailbox.entity';
import { InboundMailLog } from '../../entities/inbound-mail-log.entity';
import { MailboxesService } from './mailboxes.service';
import { MailboxRulesService } from './mailbox-rules.service';
import { EmailService } from '../email/email.service';
import { StorageService } from '../../storage/storage.service';
import { parseMime, normalizeCid, ParsedAttachment } from './mime.helper';

// Cron worker that polls EVERY active mailbox (not a hardcoded one), so adding
// a mailbox from the admin screen is enough for it to start being processed.
//
// SHADOW MODE (shadow_mode = true): the mailbox is still owned by Zammad during
// this phase. We read messages but NEVER mark them as seen/read, NEVER delete,
// and NEVER auto-reply. This is safe to run concurrently with Zammad because
// keep_on_server=true on the Zammad side. In shadow mode the fetched results
// are just logged/tallied (no real ingestion yet — switching shadow_mode off is
// what enables real processing, wired in the routing step 1.2).
@Injectable()
export class MailboxWorker {
  private readonly logger = new Logger(MailboxWorker.name);

  constructor(
    @InjectRepository(Mailbox) private readonly mailboxes: Repository<Mailbox>,
    @InjectRepository(InboundMailLog)
    private readonly inboundLog: Repository<InboundMailLog>,
    private readonly service: MailboxesService,
    private readonly rules: MailboxRulesService,
    private readonly emailService: EmailService,
    private readonly storage: StorageService,
  ) {}

  @Cron('*/1 * * * *')
  async pollAll() {
    const mailboxes = await this.service.activeMailboxesForWorker();
    if (mailboxes.length === 0) {
      this.logger.log('Sin casillas activas; worker omitido');
      return;
    }
    for (const mb of mailboxes) {
      try {
        await this.pollOne(mb);
      } catch (e) {
        const msg = (e as Error).message;
        this.logger.error(`Fallo al procesar ${mb.email}: ${msg}`);
        await this.mailboxes.update(mb.id, { lastCheckedAt: new Date(), lastError: msg });
      }
    }
  }

  private async pollOne(mb: Mailbox & { decryptedImapPassword: string }) {
    const client = new ImapFlow({
      host: mb.imapHost,
      port: mb.imapPort,
      secure: mb.imapSsl,
      auth: { user: mb.imapUser, pass: mb.decryptedImapPassword },
      logger: false,
    });
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        // UID-tracking detection (independent of \Seen). Read the predicted next
        // UID and the mailbox UIDVALIDITY so SolidOps and Zammad can both read
        // the same mailbox without clobbering each other's \Seen flags.
        const uidNext = client.mailbox?.uidNext ?? 0;
        const serverValidity = client.mailbox?.uidValidity?.toString() ?? null;

        // Figure out which UIDs to process this cycle.
        const uids = await this.resolveUidsToProcess(mb, client, uidNext, serverValidity);
        const count = uids.length;

        if (mb.shadowMode) {
          // SHADOW: read-only. Do NOT set \Seen, do NOT delete, do NOT reply.
          this.logger.log(
            `[SOMBRA] ${mb.email}: ${count} nuevos (UID>${mb.lastProcessedUid ?? 0}) — solo lectura`,
          );
          await this.recordShadow(mb, client, uids);
          this.logger.log(`[SOMBRA] ${mb.email}: muestreados ${count}`);
        } else {
          this.logger.log(`[REAL] ${mb.email}: ${count} nuevos (UID>${mb.lastProcessedUid ?? 0}) — evaluando reglas`);
          const processed = await this.processMessages(mb, client, uids);
          this.logger.log(`[REAL] ${mb.email}: enrutados ${processed}`);
        }

        // Advance the processed-UID cursor to the highest UID we have seen, so the
        // next cycle only fetches newer messages. Never touches \Seen.
        const maxUid = uids.length ? Math.max(...uids) : uidNext - 1;
        if (maxUid > (mb.lastProcessedUid ?? 0)) {
          mb.lastProcessedUid = maxUid;
          mb.syncUidValidity = serverValidity;
          await this.mailboxes.save(mb);
        }
      } finally {
        await lock.release();
      }
      await this.mailboxes.update(mb.id, { lastCheckedAt: new Date(), lastError: null });
    } catch (e) {
      await this.mailboxes.update(mb.id, { lastCheckedAt: new Date(), lastError: (e as Error).message });
      throw new Error(`IMAP ${mb.email}: ${(e as Error).message}`);
    } finally {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    }
  }

  // Decide which UIDs to fetch this cycle, purely from the UID cursor and the
  // mailbox UIDVALIDITY — NOT from the \Seen flag.
  //  - If UIDVALIDITY changed (mailbox re-indexed), reset the cursor from a
  //    reasonable cutoff (last 7 days) and update the stored validity.
  //  - If we have no cursor yet (fresh sync), seed it to the current max UID so
  //    we DON'T reprocess the whole history; the next cycle picks up new mail.
  private async resolveUidsToProcess(
    mb: Mailbox & { decryptedImapPassword: string },
    client: ImapFlow,
    uidNext: number,
    serverValidity: string | null,
  ): Promise<number[]> {
    const storedValidity = mb.syncUidValidity;
    const isFirstSync = mb.lastProcessedUid == null && storedValidity == null;
    const validityChanged =
      storedValidity != null && serverValidity != null && storedValidity !== serverValidity;

    // First time this mailbox is synced: seed the cursor to the current max UID so
    // the existing history is NOT reprocessed as brand-new. Return none now; the
    // next cycle only picks up messages arriving afterwards.
    if (isFirstSync) {
      const maxUid = Math.max(0, uidNext - 1);
      mb.lastProcessedUid = maxUid;
      mb.syncUidValidity = serverValidity;
      await this.mailboxes.save(mb);
      this.logger.log(
        `[UIDSYNC] ${mb.email}: cursor inicializado a UID ${maxUid} (no se reprocesa historial)`,
      );
      return [];
    }

    // UIDVALIDITY changed (mailbox re-indexed): the old cursor is meaningless.
    // Re-cortar from the last 7 days to avoid losing mail around the re-index.
    if (validityChanged) {
      this.logger.warn(
        `[UIDSYNC] ${mb.email}: UIDVALIDITY cambió ${storedValidity} -> ${serverValidity}; re-cortando desde hace 7 días`,
      );
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      const found = await this.searchUids(client, { since }, mb.lastProcessedUid ?? 0);
      mb.syncUidValidity = serverValidity;
      if (found.length) {
        const maxNew = Math.max(...found);
        if (maxNew > (mb.lastProcessedUid ?? 0)) mb.lastProcessedUid = maxNew;
      }
      await this.mailboxes.save(mb);
      return found;
    }

    // Normal case: process any message whose UID is higher than the cursor.
    const from = (mb.lastProcessedUid ?? 0) + 1;
    if (from > uidNext) return [];
    return this.searchUids(client, { uid: `${from}:*` }, mb.lastProcessedUid ?? 0);
  }

  // Search for UIDs matching a criterion (range or since). Filters out any UID
  // at or below the cursor (defensive: some servers return sequence-derived UIDs
  // that may include the cursor itself), guaranteeing idempotent processing.
  private async searchUids(
    client: ImapFlow,
    query: { uid?: string; since?: Date },
    minUid: number,
  ): Promise<number[]> {
    const total = await client.search(query, { uid: true });
    const arr = Array.isArray(total) ? total : [];
    return arr.filter((u) => u > minUid);
  }

  // SHADOW: record message metadata into inbound_mail_log (routed=false) so the
  // "preview" / "sin regla" views have data to evaluate routing against, while
  // the mailbox is still owned by Zammad. Read-only: never sets flags.
  private async recordShadow(
    mb: Mailbox & { decryptedImapPassword: string },
    client: ImapFlow,
    uids: number[],
  ): Promise<void> {
    if (!uids.length) return;
    for await (const msg of client.fetch(
      { uid: uids.slice(0, 50) },
      { uid: true, envelope: true },
      { uid: true },
    )) {
      const env = msg.envelope as Record<string, unknown> | undefined;
      const from = (env?.from as unknown[] | undefined)?.[0] as
        | { address?: string }
        | undefined;
      const fromEmail = from?.address ?? '';
      const subject = (env?.subject as string) || `(sin asunto) ${msg.uid}`;
      const messageId = extractMessageId(msg);
      if (messageId) {
        const already = await this.inboundLog.findOne({
          where: { messageId, mailboxEmail: mb.email },
        });
        if (!already) {
          await this.inboundLog.save(
            this.inboundLog.create({
              mailboxEmail: mb.email,
              fromEmail,
              subject,
              imapUid: (msg.uid as number) ?? null,
              messageId,
              destination: null,
              routed: false,
              entityId: null,
              receivedAt: new Date(),
            }),
          );
        }
      }
    }
  }

  // Extract + route each recent message for a mailbox. Every message is
  // recorded in InboundMailLog (audit trail + "recent without rule" view).
  // Used only in REAL mode (shadow mode records separately, see shadow sample).
  private async processMessages(
    mb: Mailbox & { decryptedImapPassword: string },
    client: ImapFlow,
    uids: number[],
  ): Promise<number> {
    let routed = 0;
    if (!uids.length) return 0;
    for await (const msg of client.fetch(
      { uid: uids.slice(0, 30) },
      // source: true => imapflow descarga el mensaje MIME COMPLETO (lo ensambla
      // por chunks internamente hasta el fin del mensaje, sin truncarlo). El
      // anterior `maxLength: 300000` solo fijaba el tamaño de chunk del streaming
      // (no un límite de descarga), pero es confuso: se usa true para garantizar
      // el MIME integral.
      { uid: true, envelope: true, source: true },
      { uid: true },
    )) {
      try {
        const env = msg.envelope as Record<string, unknown> | undefined;
        const from = (env?.from as unknown[] | undefined)?.[0] as
          | { address?: string }
          | undefined;
        const fromEmail = from?.address ?? '';
        const subject =
          (env?.subject as string) || `(sin asunto) ${msg.uid}`;
        // Parse MIME correcto: decodifica CTE (quoted-printable/base64) + charset,
        // resuelve multipart/alternative y multipart/related, y separa imágenes
        // inline (CID) de adjuntos reales.
        const parsed = await this.parseMessage(msg);
        const bodyText = parsed.text;
        // HTML con los CID ya sustituidos por URLs de descarga del backend.
        const bodyHtml = parsed.html;
        const attachmentsRefs = parsed.attachments;
        const messageId = extractMessageId(msg);

        // De-dupe: skip a message we already routed (same Message-ID).
        if (messageId) {
          const already = await this.inboundLog.findOne({
            where: { messageId, mailboxEmail: mb.email, routed: true },
          });
          if (already) {
            this.logger.log(`[REAL] ${mb.email} [${msg.uid}] duplicado (${messageId}); saltado`);
            continue;
          }
        }

        const decision = await this.rules.evaluate(mb, {
          fromEmail,
          subject,
          body: bodyText,
        });
        routed++;

        let destination = decision.destination as string | null;
        let entityId: string | null = null;
        let actuallyRouted = !!decision.matchedRuleId;

        // Route by destination.
        if (decision.destination === 'discard') {
          this.logger.log(`[REAL] ${mb.email} [${msg.uid}] descartado por regla`);
          actuallyRouted = true;
        } else if (decision.destination === 'document') {
          const doc = await this.rules.routeToDocument(
            { fromEmail, subject, body: bodyText },
            decision.customerId,
          );
          entityId = doc.id;
          actuallyRouted = true;
          this.logger.log(
            `[REAL] ${mb.email} [${msg.uid}] -> documento ${doc.id} (${doc.customerId ? 'con cliente' : 'sin clasificar'})`,
          );
        } else {
          // destination === 'ticket' (or no rule matched): create a real ticket
          // via EmailService (resolves sender -> contact -> customer). If the
          // sender is unknown, EmailService does NOT create a ticket (P4 rule)
          // and the email stays in the "sin regla" tray. Shadow flag is passed
          // so the ticket is isolated + carries the "no responder" warning.
          const res = await this.emailService.ingest({
            fromEmail,
            subject,
            body: bodyText,
            bodyHtml: bodyHtml ?? undefined,
            attachments: attachmentsRefs,
            legacyGroup: decision.targetGroupName ?? undefined,
            ...(messageId ? { messageId } : {}),
            shadow: mb.shadowMode,
          });
          if (res.ok) {
            entityId = extractTicketId(res.detail);
            actuallyRouted = true;
          } else if (!actuallyRouted) {
            destination = null; // unsorted
          }
          this.logger.log(
            `[REAL] ${mb.email} [${msg.uid}] -> ${res.detail || 'sin ticket (remitente desconocido)'}`,
          );
        }

        await this.inboundLog.save(
          this.inboundLog.create({
            mailboxEmail: mb.email,
            fromEmail,
            subject,
            imapUid: (msg.uid as number) ?? null,
            messageId,
            destination,
            routed: actuallyRouted,
            entityId,
            receivedAt: new Date(),
          }),
        );
      } catch (e) {
        this.logger.error(`[REAL] ${mb.email} [${msg.uid}] fallo al enrutar: ${(e as Error).message}`);
      }
    }
    return routed;
  }

  // Parsea un mensaje MIME completo y devuelve texto plano + HTML (con los CID de
  // imágenes inline resueltos a URLs de descarga del backend) + la lista de
  // adjuntos ya subidos a MinIO. Nunca lanza: si el MIME es inválido, devuelve un
  // cuerpo mínimo para no tumbar el worker.
  private async parseMessage(
    msg: Record<string, unknown>,
  ): Promise<{ text: string; html: string | null; attachments: Array<{ filename: string; url: string; mimeType: string; sizeBytes: number; cid: string | null; disposition: 'inline' | 'attachment' }> }> {
    const source = msg.source as Buffer | undefined;
    if (!source || source.length === 0) {
      const text = (msg.text as string | undefined) || '';
      return { text: text.replace(/\r\n/g, '\n'), html: null, attachments: [] };
    }

    // [DIAG] Guardar el MIME RAW real descargado por IMAP, SOLO si está activado
    // IMAP_DEBUG_RAW=1, para poder comparar con Zammad e inspeccionar el MIME
    // original (Content-Type/CTE/charset/parts). No registra credenciales.
    const messageId = extractMessageId(msg);
    if (process.env.IMAP_DEBUG_RAW === '1') {
      try {
        await this.saveRawForDebug(source, messageId ?? `uid-${String(msg.uid ?? '?')}`);
      } catch (e) {
        this.logger.warn(`[DIAG] No se pudo guardar el RAW: ${(e as Error).message}`);
      }
    }

    let parsed;
    try {
      parsed = await parseMime(source);
    } catch (e) {
      this.logger.warn(`Falló parseo MIME: ${(e as Error).message}; usando texto crudo`);
      const raw = source.toString('utf-8').replace(/\r\n/g, '\n');
      return { text: raw, html: null, attachments: [] };
    }

    // Subir imágenes inline a MinIO y resolver los `cid:` en el HTML por su URL.
    const attachments: Array<{ filename: string; url: string; mimeType: string; sizeBytes: number; cid: string | null; disposition: 'inline' | 'attachment' }> = [];

    if (parsed.html && parsed.images.size > 0) {
      let html = parsed.html;
      // Reemplazamos cada cid:xxxxx por la URL de descarga del attachment.
      for (const [cid, img] of parsed.images) {
        const ext = extensionForMime(img.mimeType);
        const filename = `image-${cid.slice(0, 8)}.${ext}`;
        const { url } = await this.storage.putObject(img.data, filename, img.mimeType, 'tickets');
        const norm = normalizeCid(cid) ?? '';
        // Reemplaza src="cid:..." y src='cid:...' (case-insensitive).
        const re = /src\s*=\s*["']cid:([^"']+)["']/gi;
        html = html.replace(re, (m, mcid: string) => {
          if (normalizeCid(mcid) === norm) return `src="${url}"`;
          return m;
        });
      }
      parsed.html = html;
    }

    // Adjuntos reales (disposition: attachment) a MinIO.
    for (const a of parsed.attachments as ParsedAttachment[]) {
      const name = a.filename || `attachment-${Math.random().toString(36).slice(2, 10)}`;
      const { url } = await this.storage.putObject(a.data, name, a.mimeType, 'tickets');
      attachments.push({
        filename: name,
        url,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        cid: a.cid,
        disposition: a.disposition,
      });
    }

    return { text: parsed.text, html: parsed.html, attachments };
  }

  // [DIAG] Guarda el MIME RAW descargado en debug/imap-raw/<messageId>.eml, solo
  // con IMAP_DEBUG_RAW=1. Sirve para comparar con Zammad y verificar que el RAW
  // que llega por IMAP está completo (Content-Type, CTE, charset, parts). No
  // registra credenciales.
  private async saveRawForDebug(source: Buffer, name: string): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');
    const safeName = `/${String(name).replace(/[^a-zA-Z0-9@._-]/g, '_')}.eml`;
    const dir = path.join(process.cwd(), 'debug', 'imap-raw');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, safeName), source);
    this.logger.log(`[DIAG] RAW guardado: ${path.join(dir, safeName)} (${source.length} bytes)`);
  }
}

// Extract the Message-ID header from a fetched message (imapflow exposes it on
// the envelope in some builds; fall back to a searchable field).
function extractMessageId(msg: Record<string, unknown>): string | null {
  const enve = msg.envelope as Record<string, unknown> | undefined;
  const id = (enve?.messageId as string) || (msg.messageId as string) || null;
  return id ? id.slice(0, 400) : null;
}

// Extensión de archivo a partir de un MIME type (para nombrar imágenes inline).
function extensionForMime(mime: string | null | undefined): string {
  const m = (mime || '').toLowerCase();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/html': 'html',
  };
  return map[m] || (m.split('/')[1] || 'bin');
}

// Parse the ticket id out of an ingest detail string like
// "Ticket creado: <uuid>".
function extractTicketId(detail: string): string | null {
  const m = detail.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m?.[1] ?? null;
}
