import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from '../../entities/contact.entity';
import { Customer } from '../../entities/customer.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { TicketAttachment } from '../../entities/ticket-attachment.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { TicketsService } from '../tickets/tickets.service';
import { MailService } from '../mail/mail.service';
import { publicTicketNumber } from '../../common/utils/ticket-number.util';
import { InboundEmailDto } from './dto';

// Inbound email ingestion: receives an email payload and either continues an
// existing ticket thread or creates a new one.
// Resolves the sender against known Contacts (by email); if no contact matches
// and no explicit overrides are provided, the email is left unclassified and
// logged for review (no ticket is guessed from an unknown sender — Fase 1 rule).
//
// "Modo acumulación": while SolidOps coexists with Zammad, incoming emails become
// full tickets (contact, thread, SLA) but NO outbound email is sent to the sender
// unless SystemSettings.emailAutoResponseEnabled is true.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(TicketMessage)
    private readonly messages: Repository<TicketMessage>,
    @InjectRepository(TicketAttachment)
    private readonly attachmentRepo: Repository<TicketAttachment>,
    @InjectRepository(SystemSettings)
    private readonly settings: Repository<SystemSettings>,
    private readonly tickets: TicketsService,
    private readonly mail: MailService,
  ) {}

  private async autoResponseEnabled(): Promise<boolean> {
    try {
      const rows = await this.settings.find();
      return rows[0]?.emailAutoResponseEnabled === true;
    } catch {
      return false;
    }
  }

  async ingest(dto: InboundEmailDto): Promise<{ ok: boolean; detail: string }> {
    // Guardia anti-loop: un correo cuyo remitente es la propia casilla monitoreada
    // (auto-respuesta nuestra, notificación de Zammad que comparte la INBOX, o un
    // envío hacia sí misma) NO debe generar ticket ni desencadenar otra
    // auto-respuesta. Sin esto, al activar la auto-confirmación el worker vuelve a
    // ingerir la confirmación que él mismo envió (mismo sender = smtp.from), crea
    // un ticket por cada ciclo (subject_key con #ID hex variable rompe la dedupe)
    // y envía otra confirmación — loop infinito "Recibimos tu solicitud — Ticket #X".
    const selfSmtp = await this.mail.getSmtpFrom();
    const isSelf =
      selfSmtp &&
      (dto.fromEmail || '').toLowerCase().trim() === selfSmtp.toLowerCase().trim();
    if (isSelf) {
      this.logger.log(
        `[LOOP-GUARD] ${dto.fromEmail} → correo desde la propia casilla; descartado (sin ticket, sin auto-resp)`,
      );
      return { ok: true, detail: 'sin ticket (correo desde la propia casilla)' };
    }

    // Resolve contact.
    let contactId = dto.contactId;
    let customerId: string | null = dto.customerId ?? null;
    let siteId: string | null = null;

    if (!contactId) {
      let contact = await this.contacts.findOne({
        where: { email: dto.fromEmail.toLowerCase() },
      });
      if (!contact) {
        // Remitente desconocido → Crear Customer + Contact automáticamente para
        // que TODO correo entrante genere un ticket (decisión de negocio). Se
        // vincula el remitente para futuros correos de la misma dirección.
        contact = await this.ensureContactForUnknownSender(dto.fromEmail);
      }
      contactId = contact.id;
      customerId = contact.customerId;
    }

    if (!customerId) {
      throw new BadRequestException('No se pudo resolver el cliente del remitente');
    }

    const result = await this.tickets.upsertFromEmail({
      fromEmail: dto.fromEmail,
      subject: dto.subject,
      body: dto.body ?? null,
      bodyHtml: dto.bodyHtml ?? null,
      contactId,
      customerId,
      siteId,
      shadow: dto.shadow,
      legacyGroup: dto.legacyGroup,
      attachments: dto.attachments as Array<{ filename: string; url: string; mimeType: string; sizeBytes?: number; cid?: string | null; disposition?: 'inline' | 'attachment' }>,
    });

    // Outbound policy: "modo acumulación". While false (default), NO outbound
    // email goes to the sender — the ticket is created full (contact, thread,
    // SLA) but the platform stays silent. When flipped true, se envía la
    // plantilla "ticket recibido" al remitente SOLO si el ticket se creó nuevo
    // (no se reenvía para mensajes que solo agregan al hilo existente).
    const auto = await this.autoResponseEnabled();
    if (!auto) {
      this.logger.log(
        `[ACUMULACIÓN] ${dto.fromEmail} → ${result.action} ticket ${result.ticket.id} (sin envío saliente al cliente)`,
      );
    } else if (result.action === 'created' && !dto.shadow) {
      // Plantilla "ticket recibido" — solo para tickets nuevos, no en modo sombra.
      const ticketNumber = publicTicketNumber(result.ticket.ticketNumber, result.ticket.createdAt);
      const portalUrl = process.env.PORTAL_URL || 'http://localhost:3000/portal/login';
      try {
        await this.mail.sendTicketReceived(dto.fromEmail, { ticketNumber, portalUrl });
        this.logger.log(`[AUTO-RESP] Ticket recibido enviado a ${dto.fromEmail} (ticket ${result.ticket.id})`);
      } catch (e) {
        this.logger.error(`[AUTO-RESP] Falló el envío a ${dto.fromEmail}: ${(e as Error).message}`);
      }
    } else if (result.action === 'appended') {
      this.logger.log(`[ACUMULACIÓN] ${dto.fromEmail} → mensaje agregado al ticket ${result.ticket.id} (sin auto-resp)`);
    }

    return {
      ok: true,
      detail: `${result.action === 'created' ? 'Ticket creado' : 'Ticket actualizado'}: ${result.ticket.id}`,
    };
  }

  private async inboundAttachments(
    messageId: string,
    attachments: NonNullable<InboundEmailDto['attachments']>,
  ) {
    // In Fase 1 attachments arrive as already-stored URLs (the real MIME
    // decoding is Fase 2). Persist attachment metadata rows referencing them.
    for (const a of attachments) {
      await this.attachmentRepo.save(
        this.attachmentRepo.create({
          ticketMessageId: messageId,
          fileUrl: a.url,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: 0,
        }),
      );
    }
  }

  async lastMessage(ticketId: string) {
    return this.messages.findOne({
      where: { ticketId },
      order: { createdAt: 'DESC' },
    });
  }

  // Remitente desconocido → crea un Customer + Contact a partir del email (y del
  // nombre del From si puede extraerse). Devuelve el Contact asociado. Idempotente:
  // si ya existe un contacto con ese email (carrera), lo reutiliza.
  private async ensureContactForUnknownSender(fromEmail: string): Promise<Contact> {
    const email = fromEmail.toLowerCase();
    const existing = await this.contacts.findOne({ where: { email } });
    if (existing) return existing;

    // Nombre de la persona/empresa: parte local del email con formato amigable.
    const name = this.humanizeFromEmail(email);

    // Cliente: reutilizar uno del mismo dominio (varias direcciones del mismo
    // cliente suelen compartir dominio) o crear uno nuevo "Cliente <dominio>".
    const domain = email.split('@')[1] || 'desconocido';
    let customer = await this.customers
      .createQueryBuilder('c')
      .where('c.name ILIKE :dn', { dn: `%${domain}%` })
      .orderBy('c.created_at', 'ASC')
      .getOne();
    if (!customer) {
      customer = await this.customers.save(
        this.customers.create({ name: `Cliente ${domain}` }),
      );
      this.logger.log(`[AUTO] Cliente creado para remitente desconocido: ${customer.name}`);
    }

    const contact = await this.contacts.save(
      this.contacts.create({ customerId: customer.id, name, email }),
    );
    this.logger.log(`[AUTO] Contacto creado para ${email} (cliente ${customer.name})`);
    return contact;
  }

  private humanizeFromEmail(email: string): string {
    const local = email.split('@')[0] || '';
    const words = local.replace(/[._-]+/g, ' ').split(/\s+/).filter(Boolean);
    const cap = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return cap || email;
  }
}
