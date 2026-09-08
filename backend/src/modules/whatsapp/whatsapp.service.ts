import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { Request, Response } from 'express';
import { Contact } from '../../entities/contact.entity';
import { Customer } from '../../entities/customer.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { Technician } from '../../entities/technician.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { Ticket } from '../../entities/ticket.entity';
import { TicketsService } from '../tickets/tickets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { isWorkingTime, BusinessHours } from '../../common/utils/business-hours.util';
import { TicketChannel, TicketStatus, TicketPriority, TicketAuthorType, NotificationType } from '../../common/enums';
import { StorageService } from '../../storage/storage.service';

// Menú de bienvenida del bot de WhatsApp.
const MENU = `¡Hola! Sos bienvenido/a a Solido Connecting Solutions 👋

Contanos qué te pasa, elegí una opción escribiendo el número:

1️⃣ No tengo internet / la red no anda
2️⃣ Mi computadora o equipo no funciona bien
3️⃣ Un programa o sistema no me funciona
4️⃣ Otro tema / hablar con un técnico

Escribí *0* en cualquier momento para volver a ver este menú.

📵 Este número es solo para mensajes de WhatsApp, no atiende
llamadas. Para una emergencia, llamá al +54 9 2324 683764.`;

const MENU_RETRY = `No entendí tu respuesta 🤔 elegí una opción:\n\n${MENU}`;
const CONFIRM = `¡Listo! Un técnico va a responderte a la brevedad. Mientras tanto, contanos brevemente tu consulta.`;
const CONFIRM_OUTSIDE = `¡Listo! Registramos tu consulta 📋

En este momento estamos fuera de nuestro horario de atención:
Lunes a viernes de 8 a 17hs, sábados de 8 a 12hs.

Un técnico te va a responder apenas reabramos. Si es una emergencia,
llamá al +54 9 2324 683764.`;

// Plantilla de Meta para recordatorios de turno iniciados por la empresa
// (mensajes fuera de la ventana de 24 h EXIGEN plantilla aprobada, no texto libre).
// Texto sugerido al crearla en Meta Business Manager:
//   "Recordatorio: tenés un turno asignado con {{1}} a las {{2}}."
// Variables numeradas (no nombres): {{1}} = cliente/sitio, {{2}} = hora del turno.
// Categoría: Utility. Nombre exacto a confirmar una vez Meta la apruebe.
const APPOINTMENT_REMINDER_TEMPLATE = 'appointment_reminder';
const TEMPLATE_LANG = 'es_AR';

// Zona horaria para renderizar la hora del turno en el recordatorio de WhatsApp.
const APPOINTMENT_TZ = 'America/Argentina/Buenos_Aires';

// Versión de la Graph API de Meta (misma versión que el envío saliente v21.0).
const GRAPH_API_VERSION = 'v21.0';

// Límite de seguridad para medias de WhatsApp recibidas por el webhook. Meta limita
// las imágenes a 5 MB, pero si llega un documento con mime de imagen se procesa igual:
// este tope (25 MB) garantiza un error claro y no silencioso antes de subir a MinIO.
const WHATSAPP_MEDIA_MAX_BYTES = 26214400;

const WA_MEDIA_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

// Opciones del menú → categoría interna, box y prioridad. La categoría es lo que
// ve el staff (no expone terminología L1/L2/L3 ni boxes internos al cliente).
const OPTIONS: Record<string, { category: string; legacyGroup: string | null; priority: TicketPriority; description?: string }> = {
  '1': { category: 'Red / Conectividad', legacyGroup: null, priority: TicketPriority.NORMAL },
  '2': { category: 'Hardware / Equipo', legacyGroup: '__WORKSHOP_BOX__', priority: TicketPriority.NORMAL },
  '3': { category: 'Software / Sistema', legacyGroup: null, priority: TicketPriority.NORMAL },
  '4': {
    category: 'Otro / Atención directa',
    legacyGroup: null,
    priority: TicketPriority.ALTA,
    description: 'Solicitó hablar con un técnico directamente',
  },
};

// Estado de la conversación guardado en Contact.whatsappMenuState.
interface MenuState {
  state: 'awaiting_option' | 'awaiting_option_retry' | null;
  messages: Array<{ author: 'cliente' | 'bot'; body: string }>;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(TicketGroup) private readonly groups: Repository<TicketGroup>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(SystemSettings) private readonly settings: Repository<SystemSettings>,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => TicketsService)) private readonly tickets: TicketsService,
  ) {}

  // ¿Está dentro del horario de atención? Reusa el horario del sistema
  // (SystemSettings.businessHours) + isWorkingTime del util, para no hardcodear
  // el horario en dos lugares. El horario del sistema (08-17 L-V, 08-12 Sáb) ya
  // coincide con el del chatbot.
  private async isWithinBusinessHours(): Promise<boolean> {
    try {
      const row = await this.settings.find();
      const hours = row[0]?.businessHours as BusinessHours | null | undefined;
      if (!hours) return true; // sin horario definido, se asume que siempre se atiende
      return isWorkingTime(new Date(), hours);
    } catch {
      return true;
    }
  }

  // --- Verificación del webhook (Meta) ---------------------------------------
  verifyWebhook(mode: string, verifyToken: string, challenge: string, res: Response) {
    const expected = this.config.get<string>('whatsapp.verifyToken');
    if (mode === 'subscribe' && verifyToken === expected) {
      this.logger.log('[WA] Webhook verificado por Meta');
      res.status(200).send(challenge);
      return;
    }
    this.logger.warn('[WA] Verificación de webhook rechazada (verify_token inválido)');
    res.status(403).send('Forbidden');
  }

  // --- Recepción de mensajes -------------------------------------------------
  async receive(req: Request, res: Response) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!this.verifySignature(rawBody, req.headers['x-hub-signature-256'] as string)) {
      this.logger.warn('[WA] Firma X-Hub-Signature-256 inválida; payload rechazado');
      res.status(401).send('Unauthorized');
      return;
    }

    // Meta espera 200 rápido para no reintentar; el procesamiento es best-effort.
    res.status(200).send('EVENT_RECEIVED');
    // Procesar después de responder (no bloquear la respuesta a Meta).
    void this.processPayload(req.body).catch((e) => {
      this.logger.error(`[WA] Error procesando payload: ${(e as Error).message}`);
    });
  }

  private verifySignature(rawBody: Buffer | undefined, header: string): boolean {
    const secret = this.config.get<string>('whatsapp.appSecret');
    // Si no hay secret configurado (dev), se omite la verificación para no romper
    // las pruebas locales; en producción debe estar set.
    if (!secret) {
      this.logger.warn('[WA] WHATSAPP_APP_SECRET no configurado; se omite verificación de firma');
      return true;
    }
    if (!rawBody || !header) return false;
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    return expected === header;
  }

  private async processPayload(payload: any): Promise<void> {
    const messages: any[] = [];
    for (const entry of payload?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};
        for (const msg of value?.messages || []) {
          messages.push({ msg, senderName: value?.contacts?.[0]?.profile?.name ?? null });
        }
      }
    }
    for (const { msg, senderName } of messages) {
      try {
        await this.handleIncoming(msg, senderName);
      } catch (e) {
        this.logger.error(`[WA] Fallo procesando mensaje de ${msg?.from}: ${(e as Error).message}`);
      }
    }
  }

  private async handleIncoming(msg: any, senderName: string | null): Promise<void> {
    const from = String(msg?.from || msg?.wa_id || '');
    if (!from) {
      this.logger.warn('[WA] Mensaje sin remitente, se ignora');
      return;
    }
    const text = String(msg?.text?.body || '').trim();
    const imageMedia = this.extractImageMedia(msg);
    if (!text && !imageMedia) {
      this.logger.warn(`[WA] Mensaje de ${from} con tipo no soportado (${msg?.type ?? 'sin tipo'}), se ignora`);
      return;
    }

    this.logger.log(`[WA] Mensaje recibido de ${from}: tipo=${msg?.type ?? 'texto'}${text ? ` texto="${text.slice(0, 80)}"` : ''}`);

    const contact = await this.resolveContact(from, senderName);

    // Ticket de WhatsApp abierto para este contacto.
    const open = await this.findOpenWhatsappTicket(contact.id);

    // Imagen recibida: se adjunta al ticket abierto (o se informa si no hay hilo).
    if (imageMedia) {
      await this.handleImageMessage(contact, open, imageMedia);
      return;
    }

    if (!open) {
      await this.handleChatbot(contact, from, text);
    } else {
      // Ya hay un ticket abierto: se agrega el mensaje (sin menú).
      if (!contact.customerId) {
        this.logger.warn(`[WA] Contacto ${contact.id} sin empresa; mensaje no asociado a ticket`);
        return;
      }
      const res = await this.tickets.upsertFromWhatsapp({
        contactId: contact.id,
        customerId: contact.customerId,
        title: open.title,
        messages: [{ author: 'cliente', body: text }],
      });
      this.logger.log(`[WA] Mensaje agregado al ticket abierto ${open.id} (${from})`);
      await this.notifyWhatsappMessage(res.ticket, contact.name);
    }
  }

  // --- Imágenes recibidas por WhatsApp ---------------------------------------
  // Extrae la media de un mensaje de tipo `image` (el caso normal de fotos) o de
  // un `document` cuyo mime sea `image/*` (fotos enviadas como archivo adjunto).
  private extractImageMedia(msg: any): { id: string; mimeType: string; caption?: string } | null {
    if (msg?.type === 'image' && msg?.image?.id) {
      return {
        id: String(msg.image.id),
        mimeType: String(msg.image.mime_type || 'image/jpeg'),
        caption: msg.image.caption,
      };
    }
    if (
      msg?.type === 'document' &&
      msg?.document?.id &&
      String(msg.document.mime_type || '').startsWith('image/')
    ) {
      return {
        id: String(msg.document.id),
        mimeType: String(msg.document.mime_type || 'image/jpeg'),
        caption: msg.document.caption,
      };
    }
    return null;
  }

  // Descarga la media desde la Graph API de Meta (URL temporal + token en el
  // header), la sube a MinIO (igual que los adjuntos de email) y la adjunta al
  // ticket abierto del contacto. El mensaje en la conversación lleva el caption
  // de la imagen (si vino) o un texto genérico.
  private async handleImageMessage(contact: Contact, open: Ticket | null, media: { id: string; mimeType: string; caption?: string }): Promise<void> {
    if (!open) {
      this.logger.warn(`[WA] Imagen de ${contact.whatsapp} sin ticket abierto; no hay hilo al cual adjuntarla`);
      return;
    }
    if (!contact.customerId) {
      this.logger.warn(`[WA] Contacto ${contact.id} sin empresa; imagen no asociada a ticket`);
      return;
    }
    const body = String(media.caption || '').trim() || 'Imagen adjunta (WhatsApp)';
    try {
      const { buffer, filename, mimeType } = await this.downloadWhatsAppMedia(media.id);
      if (buffer.length > WHATSAPP_MEDIA_MAX_BYTES) {
        throw new Error(
          `la imagen excede el límite de ${Math.round(WHATSAPP_MEDIA_MAX_BYTES / 1024 / 1024)} MB (${buffer.length} bytes)`,
        );
      }
      const { url } = await this.storage.putObject(buffer, filename, mimeType, 'tickets');
      const res = await this.tickets.upsertFromWhatsapp({
        contactId: contact.id,
        customerId: contact.customerId,
        title: open.title,
        messages: [
          {
            author: 'cliente',
            body,
            attachments: [{ filename, url, mimeType, sizeBytes: buffer.length }],
          },
        ],
      });
      this.logger.log(`[WA] Imagen ${filename} adjuntada al ticket ${res.ticket.id} (${buffer.length} bytes)`);
      await this.notifyWhatsappMessage(res.ticket, contact.name);
    } catch (e) {
      this.logger.error(`[WA] Fallo adjuntando imagen del contacto ${contact.id} al ticket ${open.id}: ${(e as Error).message}`);
      try {
        await this.tickets.upsertFromWhatsapp({
          contactId: contact.id,
          customerId: contact.customerId,
          title: open.title,
          messages: [
            {
              author: 'bot',
              body: `⚠ No se pudo guardar la imagen que envió el cliente por WhatsApp: ${(e as Error).message}`,
            },
          ],
        });
      } catch (e2) {
        this.logger.error(`[WA] Fallo registrando aviso de imagen en ticket ${open.id}: ${(e2 as Error).message}`);
      }
    }
  }

  // 1) GET {media-id} de la Graph API → URL temporal de descarga (+mime).
  // 2) GET esa URL con el access token en el header → bytes de la imagen.
  private async downloadWhatsAppMedia(mediaId: string): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const token = this.config.get<string>('whatsapp.accessToken');
    if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN no configurado');

    const infoRes = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!infoRes.ok) {
      const body = (await infoRes.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(`Meta media info HTTP ${infoRes.status}: ${body?.error?.message || infoRes.statusText}`);
    }
    const info = (await infoRes.json()) as { url?: string; mime_type?: string };
    if (!info.url) throw new Error('Meta no devolvió URL de descarga para la media');

    const dlRes = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!dlRes.ok) throw new Error(`Descarga de media HTTP ${dlRes.status}`);

    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const mimeType = info.mime_type || 'image/jpeg';
    const ext = WA_MEDIA_EXT[mimeType] || 'img';
    const filename = `whatsapp-${Date.now()}.${ext}`;
    return { buffer, filename, mimeType };
  }

  // --- Chatbot (primer contacto, sin ticket abierto) -------------------------
  private async handleChatbot(contact: Contact, from: string, text: string): Promise<void> {
    let state: MenuState = (contact.whatsappMenuState as MenuState) || { state: null, messages: [] };
    // Acumular el mensaje entrante en el historial pendiente.
    state.messages = [...(state.messages || []), { author: 'cliente', body: text }];

    const option = OPTIONS[text];

    // '0' en cualquier momento (sin ticket abierto): re-muestra el menú.
    if (text === '0') {
      await this.sendOutbound(from, MENU);
      state.messages.push({ author: 'bot', body: MENU });
      state.state = 'awaiting_option';
      await this.saveState(contact, state);
      return;
    }

    // Opción válida 1-4 → crear el ticket ahora.
    if (option) {
      await this.createTicketFromOption(contact, from, option, state);
      return;
    }

    // Respuesta inválida.
    if (state.state === 'awaiting_option_retry') {
      // Segunda respuesta inválida seguida → escalar a la opción 4.
      this.logger.log(`[WA] ${from}: escalado automático a opción 4 tras 2 intentos inválidos`);
      await this.createTicketFromOption(contact, from, OPTIONS['4'], state);
      return;
    }

    // Primer mensaje (sin menú aún, state null) → mostrar el menú de bienvenida.
    // O primer intento inválido después del menú (state 'awaiting_option') →
    // re-mostrar el menú con aviso "No entendí". El estado 'awaiting_option_retry'
    // ya se manejó arriba (escala).
    const isFirstMessage = state.state === null;
    const menuText = isFirstMessage ? MENU : MENU_RETRY;
    await this.sendOutbound(from, menuText);
    state.messages.push({ author: 'bot', body: menuText });
    state.state = isFirstMessage ? 'awaiting_option' : 'awaiting_option_retry';
    await this.saveState(contact, state);
  }

  private async createTicketFromOption(contact: Contact, from: string, option: { category: string; legacyGroup: string | null; priority: TicketPriority; description?: string }, state: MenuState): Promise<void> {
    if (!contact.customerId) {
      this.logger.warn(`[WA] Contacto ${contact.id} sin empresa; no se crea ticket desde ${from}`);
      await this.sendOutbound(from, 'Gracias por tu mensaje. Para abrir un ticket por WhatsApp es necesario estar vinculado a una empresa. Si creés que es un error, comunicate con nosotros por otro medio.');
      return;
    }
    let legacyGroup: string | null = option.legacyGroup;
    if (legacyGroup === '__WORKSHOP_BOX__') {
      // Enrutar al box del módulo Taller (module_key='workshop'). No se crea un
      // equipo de Taller automáticamente; solo se enruta el ticket.
      const workshopBox = await this.groups.findOne({ where: { moduleKey: 'workshop', active: true } });
      legacyGroup = workshopBox?.name ?? 'Taller';
    }

    const within = await this.isWithinBusinessHours();
    const confirm = within ? CONFIRM : CONFIRM_OUTSIDE;
    const messages: Array<{ author: 'cliente' | 'bot'; body: string }> = [
      ...state.messages,
      { author: 'bot', body: confirm },
    ];

    const result = await this.tickets.upsertFromWhatsapp({
      contactId: contact.id,
      customerId: contact.customerId,
      title: `WhatsApp: ${option.category}`,
      category: option.category,
      legacyGroup,
      priority: option.priority,
      description: option.description ?? null,
      messages,
    });
    this.logger.log(`[WA] Ticket ${result.action} ${result.ticket.id} para ${from} (categoría ${option.category}, box ${legacyGroup ?? 'nativo'})`);

    // Enviar la confirmación real por WhatsApp, notificar y limpiar el estado.
    await this.sendOutbound(from, confirm);
    await this.notifyWhatsappMessage(result.ticket, contact.name);
    await this.clearState(contact);
  }

  private async saveState(contact: Contact, state: MenuState): Promise<void> {
    contact.whatsappMenuState = state;
    await this.contacts.save(contact);
  }
  private async clearState(contact: Contact): Promise<void> {
    contact.whatsappMenuState = null;
    await this.contacts.save(contact);
  }

  // --- Resolución de contacto por teléfono -----------------------------------
  // Dedupe: primero busca un contacto existente con ese número (whatsapp y luego
  // phone); SOLO si no existe crea el contacto genérico "Cliente WA {n}". Así, un
  // número ya vinculado (o residente de un contacto real) nunca genera duplicado.
  // Los contactos fusionados (soft-deleted por "link-to") quedan fuera del lookup
  // automáticamente (withDeleted: false), y el número vive en el contacto destino.
  private async resolveContact(from: string, senderName?: string | null): Promise<Contact> {
    const phone = normalizePhone(from);
    let contact = await this.contacts.findOne({ where: { whatsapp: phone }, withDeleted: false });
    if (!contact) {
      // Fallback: si el contacto tiene el número en `phone` pero no en `whatsapp`.
      contact = await this.contacts.findOne({ where: { phone }, withDeleted: false });
    }
    if (!contact) {
      const customer = await this.ensureCustomerForPhone(phone);
      contact = await this.contacts.save(
        this.contacts.create({ customerId: customer.id, name: senderName || humanizePhone(phone), whatsapp: phone }),
      );
      this.logger.log(`[WA] Contacto creado para ${phone} (cliente ${customer.name})`);
    } else if (senderName && !contact.name) {
      contact.name = senderName;
      await this.contacts.save(contact);
    }
    return contact;
  }

  private async ensureCustomerForPhone(phone: string): Promise<Customer> {
    const label = `Cliente WA ${phone.slice(-6)}`;
    let customer = await this.customers
      .createQueryBuilder('c')
      .where('c.name ILIKE :n', { n: `%${label}%` })
      .orderBy('c.created_at', 'ASC')
      .getOne();
    if (!customer) {
      customer = await this.customers.save(this.customers.create({ name: label }));
    }
    return customer;
  }

  // --- Ticket abierto de WhatsApp --------------------------------------------
  private async findOpenWhatsappTicket(contactId: string): Promise<Ticket | null> {
    return this.tickets.findOpenWhatsappTicket(contactId);
  }

  // --- Envío saliente (WhatsApp Cloud API) -----------------------------------
  async sendOutbound(to: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const token = this.config.get<string>('whatsapp.accessToken');
    const phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    if (!token || !phoneNumberId) {
      this.logger.warn(`[WA] Envío omitido a ${to}: WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID no configurados`);
      return { ok: false, error: 'WhatsApp no configurado (faltan credenciales)' };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        this.logger.error(`[WA] Fallo envío a ${to}: ${res.status} ${JSON.stringify(data)}`);
        return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      }
      this.logger.log(`[WA] Enviado a ${to} (${text.slice(0, 40)}...)`);
      return { ok: true };
    } catch (e) {
      this.logger.error(`[WA] Fallo envío a ${to}: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }

  // Envío de plantilla pre-aprobada por Meta (necesario para mensajes iniciados por
  // la empresa fuera de la ventana de 24 h). Las variables se pasan como body_params
  // en la sección body del componente MAIN.
  async sendAppointmentReminderTemplate(
    to: string,
    customerName: string,
    startTime: Date,
  ): Promise<{ ok: boolean; error?: string }> {
    const token = this.config.get<string>('whatsapp.accessToken');
    const phoneNumberId = this.config.get<string>('whatsapp.phoneNumberId');
    if (!token || !phoneNumberId) {
      this.logger.warn(`[WA-REMINDER] Envío omitido a ${to}: credenciales WhatsApp no configuradas`);
      return { ok: false, error: 'WhatsApp no configurado (faltan credenciales)' };
    }

    const timeStr = startTime.toLocaleString('es-AR', {
      timeZone: APPOINTMENT_TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    const body = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: APPOINTMENT_REMINDER_TEMPLATE,
        language: { code: TEMPLATE_LANG },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: customerName || 'un cliente' },
              { type: 'text', text: timeStr },
            ],
          },
        ],
      },
    };

    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        this.logger.error(`[WA-REMINDER] Fallo envío a ${to}: ${res.status} ${JSON.stringify(data)}`);
        return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
      }
      this.logger.log(`[WA-REMINDER] Plantilla enviada a ${to} (turno ${startTime.toISOString()})`);
      return { ok: true };
    } catch (e) {
      this.logger.error(`[WA-REMINDER] Fallo envío a ${to}: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }

  // Notificación in-app (persistida + push por Socket.IO) cuando llega un mensaje
  // de WhatsApp que crea/actualiza un ticket. Si el ticket tiene técnico asignado,
  // se le notifica a ese técnico; si no, a todos los técnicos (decisión: no existe
  // criterio previo de "notificar a todos en tickets sin asignar" en el sistema,
  // se toma este para que ningún mensaje de WhatsApp quede sin avisar).
  private async notifyWhatsappMessage(ticket: Ticket, contactName: string): Promise<void> {
    try {
      const title = `Nuevo mensaje de WhatsApp de ${contactName || 'un contacto'}`;
      const recipients: string[] = [];
      if (ticket.technicianId) {
        const tech = await this.technicians.findOne({ where: { id: ticket.technicianId } });
        if (tech?.userId) recipients.push(tech.userId);
      } else {
        const all = await this.technicians.find();
        for (const t of all) if (t.userId) recipients.push(t.userId);
      }
      for (const userId of recipients) {
        await this.notifications.create({
          userId,
          type: NotificationType.WHATSAPP_MESSAGE,
          payload: { ticketId: ticket.id, title },
        });
      }
      this.logger.log(`[WA] Notificación de WhatsApp enviada a ${recipients.length} usuario(s) (ticket ${ticket.id})`);
    } catch (e) {
      this.logger.error(`[WA] Fallo notificación de WhatsApp: ${(e as Error).message}`);
    }
  }
}

// Normaliza un teléfono a solo dígitos (Meta manda '5491172450095').
function normalizePhone(p: string): string {
  return String(p || '').replace(/\D/g, '');
}

function humanizePhone(phone: string): string {
  const digits = normalizePhone(phone);
  // '+54 9 11 7245-0095' aproximado desde los dígitos (sin garantía de formato).
  return digits.length >= 10 ? `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)} ${digits.slice(6)}` : digits;
}
