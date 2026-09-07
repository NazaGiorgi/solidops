import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailboxesService } from '../mailboxes/mailboxes.service';
import { SystemSettings } from '../../entities/system-settings.entity';
import { WorkshopEquipmentStatus } from '../../common/enums';

// System outbound email (password-reset links, auto-responses, etc.). Reuses the
// SMTP config of a configured mailbox (prefers soporte@solidocs.com.ar). If no
// SMTP is loaded yet (dev), it falls back to logging the email so the flow stays
// testable.
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly mailboxes: MailboxesService,
    @InjectRepository(SystemSettings)
    private readonly settings: Repository<SystemSettings>,
  ) {}

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    const subject = 'Reestablece tu contraseña — SolidOps';
    const text =
      `Recibimos una solicitud para reestablecer tu contraseña.\n\n` +
      `Usá este enlace (válido por 1 hora):\n${resetUrl}\n\n` +
      `Si no solicitaste esto, ignorá este correo.`;
    const html =
      `<p>Recibimos una solicitud para reestablecer tu contraseña.</p>` +
      `<p>Usá este enlace (válido por 1 hora):<br/><a href="${resetUrl}">${resetUrl}</a></p>` +
      `<p>Si no solicitaste esto, ignorá este correo.</p>`;
    await this.send(to, subject, text, html, 'Reset');
  }

  // Confirmación de email para cuentas nuevas del portal (registro). NO depende
  // del toggle de auto-respuestas: es un email transaccional de activación.
  async sendEmailVerification(to: string, opts: { name: string; link: string }): Promise<void> {
    const subject = 'Verificá tu correo — Portal de clientes';
    const text =
      `Hola ${opts.name},\n\n` +
      `Para activar tu cuenta del portal de clientes confirmá tu dirección de correo:\n\n` +
      `${opts.link}\n\n` +
      `Este enlace es válido por 24 horas. ${opts.name ? '' : ''}Si no creaste esta cuenta, ignorá este correo.`;
    const html =
      `<p>Hola ${opts.name},</p>` +
      `<p>Para activar tu cuenta del portal de clientes confirmá tu dirección de correo:</p>` +
      `<p><a href="${opts.link}">${opts.link}</a></p>` +
      `<p>Este enlace es válido por 24 horas. Si no creaste esta cuenta, ignorá este correo.</p>`;
    await this.send(to, subject, text, html, 'Verificación email');
  }

  // Plantilla "ticket recibido" — el ticket se creó desde correo entrante.
  async sendTicketReceived(to: string, opts: { ticketNumber: string; portalUrl: string }): Promise<void> {
    if (!(await this.autoEnabled())) { this.logger.log(`[AUTO-RESP OFF] ticket recibido a ${to} omitido (toggle apagado)`); return; }
    const subject = `Recibimos tu solicitud — Ticket #${opts.ticketNumber}`;
    const text =
      `Hola,\n\n` +
      `Recibimos tu solicitud y ya quedó registrada como el Ticket #${opts.ticketNumber}. ` +
      `Nuestro equipo de soporte técnico la va a revisar a la brevedad.\n\n` +
      `Si necesitás agregar más información, simplemente respondé a este correo — se suma directo al ticket. ` +
      `También podés hacer seguimiento en cualquier momento ingresando a tu portal de cliente: ${opts.portalUrl}\n\n` +
      `Gracias por confiar en nosotros.\n\n` +
      `Equipo de Soporte — Solido Connecting Solutions\n` +
      `SolidoCS, lo hacemos simple.`;
    const html =
      `<p>Hola,</p>` +
      `<p>Recibimos tu solicitud y ya quedó registrada como el <strong>Ticket #${opts.ticketNumber}</strong>. ` +
      `Nuestro equipo de soporte técnico la va a revisar a la brevedad.</p>` +
      `<p>Si necesitás agregar más información, simplemente respondé a este correo — se suma directo al ticket. ` +
      `También podés hacer seguimiento en cualquier momento ingresando a tu <a href="${opts.portalUrl}">portal de cliente</a>.</p>` +
      `<p>Gracias por confiar en nosotros.</p>` +
      `<p>Equipo de Soporte — Solido Connecting Solutions<br/>SolidoCS, lo hacemos simple.</p>`;
    await this.send(to, subject, text, html, 'Ticket recibido');
  }

  // Plantilla variante "registramos tu solicitud" — para tickets creados MANUALMENTE
  // por un técnico (p.ej. tras un llamado telefónico, presencial o chat). Texto
  // neutral que no asume el medio. Asunto y cuerpo distintos al de correo entrante.
  async sendTicketCreatedManual(to: string, opts: { ticketNumber: string; portalUrl: string }): Promise<void> {
    if (!(await this.autoEnabled())) { this.logger.log(`[AUTO-RESP OFF] manual a ${to} omitido (toggle apagado)`); return; }
    const subject = `Registramos tu solicitud — Ticket #${opts.ticketNumber}`;
    const text =
      `Hola,\n\n` +
      `Registramos tu solicitud y quedó cargada como el Ticket #${opts.ticketNumber}. ` +
      `Nuestro equipo de soporte técnico la va a revisar a la brevedad.\n\n` +
      `Podés hacer seguimiento en cualquier momento desde tu portal de cliente: ${opts.portalUrl}\n\n` +
      `Gracias por confiar en nosotros.\n\n` +
      `Equipo de Soporte — Solido Connecting Solutions\n` +
      `SolidoCS, lo hacemos simple.`;
    const html =
      `<p>Hola,</p>` +
      `<p>Registramos tu solicitud y quedó cargada como el <strong>Ticket #${opts.ticketNumber}</strong>. ` +
      `Nuestro equipo de soporte técnico la va a revisar a la brevedad.</p>` +
      `<p>Podés hacer seguimiento en cualquier momento desde tu <a href="${opts.portalUrl}">portal de cliente</a>.</p>` +
      `<p>Gracias por confiar en nosotros.</p>` +
      `<p>Equipo de Soporte — Solido Connecting Solutions<br/>SolidoCS, lo hacemos simple.</p>`;
    await this.send(to, subject, text, html, 'Ticket registrado (manual)');
  }

  // Plantilla "en proceso" — un técnico tomó el ticket / pasó a en proceso.
  async sendTicketInProgress(to: string, opts: { ticketNumber: string }): Promise<void> {
    if (!(await this.autoEnabled())) { this.logger.log(`[AUTO-RESP OFF] en proceso a ${to} omitido (toggle apagado)`); return; }
    const subject = `Tu ticket #${opts.ticketNumber} está en proceso`;
    const text =
      `Hola,\n\n` +
      `Tu ticket #${opts.ticketNumber} está siendo atendido por nuestro equipo de soporte técnico. ` +
      `Te avisaremos apenas tengamos novedades o necesitemos más información de tu parte.\n\n` +
      `Equipo de Soporte — Solido Connecting Solutions\n` +
      `SolidoCS, lo hacemos simple.`;
    const html =
      `<p>Hola,</p>` +
      `<p>Tu ticket <strong>#${opts.ticketNumber}</strong> está siendo atendido por nuestro equipo de soporte técnico. ` +
      `Te avisaremos apenas tengamos novedades o necesitemos más información de tu parte.</p>` +
      `<p>Equipo de Soporte — Solido Connecting Solutions<br/>SolidoCS, lo hacemos simple.</p>`;
    await this.send(to, subject, text, html, 'Ticket en proceso');
  }

  // Plantilla "resuelto" — el ticket se marcó como resuelto.
  async sendTicketResolved(to: string, opts: { ticketNumber: string }): Promise<void> {
    if (!(await this.autoEnabled())) { this.logger.log(`[AUTO-RESP OFF] resuelto a ${to} omitido (toggle apagado)`); return; }
    const subject = `Tu ticket #${opts.ticketNumber} fue resuelto`;
    const text =
      `Hola,\n\n` +
      `Tu ticket #${opts.ticketNumber} fue marcado como resuelto. Si el problema persiste o tenés alguna duda, ` +
      `simplemente respondé a este correo y lo reabrimos.\n\n` +
      `Gracias por confiar en nosotros.\n` +
      `Equipo de Soporte — Solido Connecting Solutions\n` +
      `SolidoCS, lo hacemos simple.`;
    const html =
      `<p>Hola,</p>` +
      `<p>Tu ticket <strong>#${opts.ticketNumber}</strong> fue marcado como resuelto. Si el problema persiste o tenés ` +
      `alguna duda, simplemente respondé a este correo y lo reabrimos.</p>` +
      `<p>Gracias por confiar en nosotros.</p>` +
      `<p>Equipo de Soporte — Solido Connecting Solutions<br/>SolidoCS, lo hacemos simple.</p>`;
    await this.send(to, subject, text, html, 'Ticket resuelto');
  }

  // Plantilla convocatoria trabajo/servicio — Taller (estado de un equipo).
  // Se dispara desde WorkshopService al cambiar el estado (best-effort; el
  // cambio de estado no debe fallar si el correo falla). Adjunta PDF cuando
  // corresponde (comprobante de recepción en RECIBIDO, presupuesto en DIAGNOSTICADO).
  async sendWorkshopStatus(input: {
    status: WorkshopEquipmentStatus;
    to: string;
    contactName: string | null;
    comprobanteNumber: string | null;
    attachment?: { filename: string; content: Buffer; contentType?: string } | null;
  }): Promise<void> {
    const greeting = input.contactName ? `Hola ${input.contactName},` : 'Hola,';
const signatureText = '\n\nSaludos,\nSolido Connecting Solutions\nServicios de Informática\nTel: 2324 683764';

    const signatureHtml = '<br/><br/>Saludos,<br/>Solido Connecting Solutions<br/>Servicios de Informática<br/>Tel: 2324 683764';
    let subject = '';
    let text = '';
    let html = '';

    switch (input.status) {
      case WorkshopEquipmentStatus.RECIBIDO: {
        const n = input.comprobanteNumber ? ` N.º ${input.comprobanteNumber}` : '';
        subject = `Recibimos tu equipo — Comprobante${n}`;
        text =
          `${greeting}\n\n` +
          `Te confirmamos que recibimos tu equipo en nuestro taller. Adjuntamos el ` +
          `comprobante de recepción con el detalle de lo recibido y la falla reportada.\n\n` +
          `Conservá este comprobante: lo vas a necesitar para retirar el equipo.\n\n` +
          `Cualquier reparación o repuesto necesario va a requerir tu aprobación previa ` +
          `mediante un presupuesto, que te vamos a enviar apenas esté listo.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Te confirmamos que recibimos tu equipo en nuestro taller. Adjuntamos el ` +
          `comprobante de recepción con el detalle de lo recibido y la falla reportada.</p>` +
          `<p><strong>Conservá este comprobante:</strong> lo vas a necesitar para retirar el equipo.</p>` +
          `<p>Cualquier reparación o repuesto necesario va a requerir tu aprobación previa ` +
          `mediante un presupuesto, que te vamos a enviar apenas esté listo.${signatureHtml}</p>`;
        break;
      }
      case WorkshopEquipmentStatus.EN_DIAGNOSTICO: {
        subject = 'Estamos revisando tu equipo';
        text =
          `${greeting}\n\n` +
          `Te avisamos que comenzamos con el diagnóstico de tu equipo. En cuanto ` +
          `identifiquemos el problema, te vamos a enviar el presupuesto correspondiente ` +
          `para tu aprobación.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Te avisamos que comenzamos con el diagnóstico de tu equipo. En cuanto ` +
          `identifiquemos el problema, te vamos a enviar el presupuesto correspondiente ` +
          `para tu aprobación.${signatureHtml}</p>`;
        break;
      }
      case WorkshopEquipmentStatus.DIAGNOSTICADO: {
        subject = 'Diagnóstico listo — Presupuesto disponible';
        text =
          `${greeting}\n\n` +
          `Ya completamos el diagnóstico de tu equipo. Adjuntamos el presupuesto con el ` +
          `detalle de la reparación necesaria.\n\n` +
          `Necesitamos tu aprobación para continuar con el trabajo. Podés responder este ` +
          `mismo email o contactarnos para confirmar.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Ya completamos el diagnóstico de tu equipo. Adjuntamos el presupuesto con el ` +
          `detalle de la reparación necesaria.</p>` +
          `<p>Necesitamos tu aprobación para continuar con el trabajo. Podés responder este ` +
          `mismo email o contactarnos para confirmar.${signatureHtml}</p>`;
        break;
      }
      case WorkshopEquipmentStatus.EN_REPARACION: {
        subject = 'Comenzamos la reparación de tu equipo';
        text =
          `${greeting}\n\n` +
          `Te confirmamos que, con el presupuesto ya aprobado, comenzamos con la ` +
          `reparación de tu equipo. Te vamos a avisar apenas esté listo para retirar.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Te confirmamos que, con el presupuesto ya aprobado, comenzamos con la ` +
          `reparación de tu equipo. Te vamos a avisar apenas esté listo para retirar.${signatureHtml}</p>`;
        break;
      }
      case WorkshopEquipmentStatus.LISTO_PARA_RETIRAR: {
        subject = 'Tu equipo está listo para retirar';
        text =
          `${greeting}\n\n` +
          `Tu equipo ya está reparado y listo para que lo retires de nuestro local.\n\n` +
          `Te recordamos traer el comprobante de recepción (o el número de comprobante) ` +
          `para agilizar la entrega.\n\n` +
          `Estamos a tu disposición de lunes a viernes de 8 a 17 hs.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Tu equipo ya está reparado y listo para que lo retires de nuestro local.</p>` +
          `<p>Te recordamos traer el comprobante de recepción (o el número de comprobante) ` +
          `para agilizar la entrega.</p>` +
          `<p>Estamos a tu disposición de lunes a viernes de 8 a 17 hs.${signatureHtml}</p>`;
        break;
      }
      case WorkshopEquipmentStatus.ENTREGADO: {
        subject = 'Gracias por confiar en nosotros';
        text =
          `${greeting}\n\n` +
          `Te confirmamos la entrega de tu equipo. Gracias por confiar en Solido ` +
          `Connecting Solutions.\n\n` +
          `Ante cualquier consulta o si el problema persiste, no dudes en contactarnos.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Te confirmamos la entrega de tu equipo. Gracias por confiar en Solido ` +
          `Connecting Solutions.</p>` +
          `<p>Ante cualquier consulta o si el problema persiste, no dudes en contactarnos.${signatureHtml}</p>`;
        break;
      }
      default: {
        subject = 'Actualización de tu equipo en el taller';
        text =
          `${greeting}\n\n` +
          `Te informamos una actualización en el estado de tu equipo en nuestro taller.${signatureText}`;
        html =
          `<p>${greeting}</p>` +
          `<p>Te informamos una actualización en el estado de tu equipo en nuestro taller.${signatureHtml}</p>`;
      }
    }

    const attachments = input.attachment
      ? [
          {
            filename: input.attachment.filename,
            content: input.attachment.content,
            contentType: input.attachment.contentType ?? 'application/pdf',
          },
        ]
      : undefined;
    await this.send(input.to, subject, text, html, `Workshop ${input.status}`, attachments);
  }

  // Plantilla de respuesta manual de un técnico a un ticket de canal email.
  // Envía el contenido REAL que escribió el técnico (no una plantilla de estado).
  // NO depende del toggle emailAutoResponseEnabled: es una respuesta real a un
  // cliente (equivalente por email al envío saliente de WhatsApp), no una
  // auto-respuesta. Asunto con prefijo "Re:" para enhebrar en el cliente.
  async sendTicketReply(
    to: string,
    opts: { ticketNumber: string; subject: string; body: string; technicianName?: string | null },
  ): Promise<void> {
    const subject = /^re:/i.test(opts.subject) ? opts.subject : `Re: ${opts.subject}`;
    const byTech = opts.technicianName
      ? `Respuesta de ${opts.technicianName} de Soporte — Solido Connecting Solutions`
      : 'Respuesta de Soporte — Solido Connecting Solutions';
    const text =
      `${opts.body}\n\n` +
      `---\n` +
      `Ticket #${opts.ticketNumber}\n` +
      `${byTech}\n` +
      `Para continuar la conversación, respondé a este correo — se suma directo al ticket.\n` +
      `SolidoCS, lo hacemos simple.`;
    const htmlBody = opts.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    const html =
      `<p>${htmlBody}</p>` +
      `<hr/>` +
      `<p><strong>Ticket #${opts.ticketNumber}</strong><br/>` +
      `${byTech}</p>` +
      `<p style="font-size:0.85em; color:#666;">Para continuar la conversación, respondé a este correo — se suma directo al ticket.` +
      `<br/>SolidoCS, lo hacemos simple.</p>`;
    await this.send(to, subject, text, html, 'Respuesta de ticket');
  }

  // Verifica el toggle global "respuestas automáticas por email".
  private async autoEnabled(): Promise<boolean> {
    try {
      const rows = await this.settings.find();
      return rows[0]?.emailAutoResponseEnabled === true;
    } catch {
      return false;
    }
  }

  // Dirección de correo propia del sistema (del SMTP config, p.ej.
  // soporte@solidocs.com.ar). Usada por la guardia anti-loop para detectar
  // correos cuyo remitente es la propia casilla monitoreada.
  async getSmtpFrom(): Promise<string | null> {
    try {
      const smtp = await this.mailboxes.getSmtpConfig();
      return smtp?.from ?? null;
    } catch {
      return null;
    }
  }

  // Plantilla de recordatorio de cita de Agenda para el técnico asignado.
  async sendAppointmentReminder(to: string, opts: {
    technicianName: string;
    subject: string;
    startAt: string;
    customerName?: string | null;
    notes?: string | null;
  }): Promise<void> {
    const dt = new Date(opts.startAt);
    const date = dt.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
    const time = dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const subject = `Recordatorio: ${opts.subject} — ${time}`;
    const text =
      `Hola ${opts.technicianName},\n\n` +
      `Te recordamos tu turno:\n\n` +
      `${opts.subject}\n` +
      `Fecha y hora: ${date} a las ${time}\n` +
      (opts.customerName ? `Cliente: ${opts.customerName}\n` : '') +
      (opts.notes ? `Notas: ${opts.notes}\n` : '') +
      `\nSaludos,\nSolido Connecting Solutions`;
    const html =
      `<p>Hola ${opts.technicianName},</p>` +
      `<p>Te recordamos tu turno:</p>` +
      `<p><strong>${opts.subject}</strong><br/>` +
      `Fecha y hora: ${date} a las ${time}` +
      (opts.customerName ? `<br/>Cliente: ${opts.customerName}` : '') +
      (opts.notes ? `<br/>Notas: ${opts.notes}` : '') +
      `</p><p>Saludos,<br/>Solido Connecting Solutions</p>`;
    await this.send(to, subject, text, html, 'Recordatorio cita');
  }

  // Helper privado: obtiene SMTP, crea el transporte y envía (o loguea en dev).
  private async send(
    to: string,
    subject: string,
    text: string,
    html: string,
    logTag: string,
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>,
  ): Promise<void> {
    const smtp = await this.mailboxes.getSmtpConfig();
    if (!smtp) {
      this.logger.warn(`[NO-SMTP] ${logTag} para ${to}: ${subject}`);
      if (attachments && attachments.length > 0) {
        this.logger.log(`[NO-SMTP] Adjuntos: ${attachments.map((a) => a.filename).join(', ')}`);
      }
      this.logger.log(`[NO-SMTP] Email content: ${text}`);
      return;
    }
    // Invariante anti-loop: nunca enviar un correo hacia la propia dirección de
    // envío (auto-respuestas → INBOX de la casilla monitoreada → re-ingestión).
    // Defensa en profundidad junto a la guardia de ingest().
    if (to.toLowerCase().trim() === smtp.from.toLowerCase().trim()) {
      this.logger.log(`[LOOP-GUARD] ${logTag} para ${to} omitido (destino = propia casilla)`);
      return;
    }
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: smtp.requireTLS,
      auth: { user: smtp.user, pass: smtp.password },
    });
    await transport.sendMail({ from: smtp.from, to, subject, text, html, attachments });
    this.logger.log(`${logTag} enviado a ${to} (${subject})`);
  }
}
