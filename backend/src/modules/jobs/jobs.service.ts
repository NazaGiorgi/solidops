import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { Technician } from '../../entities/technician.entity';
import { Contract } from '../../entities/contract.entity';
import { Appointment } from '../../entities/appointment.entity';
import { SlaService } from '../tickets/sla.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { NotificationType, SlaStatus, ACTIVE_TICKET_STATUSES } from '../../common/enums';
import { CalendarService } from '../calendar/calendar.service';

// Background jobs:
//  - Re-evaluate SLA status and emit "SLA en riesgo" notifications.
//  - Detect overdue tasks and notify assignees.
//  - Send appointment reminders to assigned technicians (email + WhatsApp).
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private notified = new Set<string>();

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    @InjectRepository(Appointment) private readonly appointments: Repository<Appointment>,
    private readonly slaService: SlaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappService,
    private readonly calendar: CalendarService,
  ) {}

  @Cron('*/5 * * * *') // every 5 minutes
  async checkSlaAndOverdues() {
    try {
      await this.checkSlaStatus();
    } catch (e) {
      this.logger.error('checkSlaStatus: ' + (e as Error).message);
    }
    try {
      const overdue = await this.calendar.checkAndNotifyOverdue();
      if (overdue > 0) this.logger.log(`Tareas atrasadas notificadas: ${overdue}`);
    } catch (e) {
      this.logger.error('checkOverdue: ' + (e as Error).message);
    }
    try {
      const reminders = await this.checkAppointmentReminders();
      if (reminders > 0) this.logger.log(`Recordatorios de cita enviados: ${reminders}`);
    } catch (e) {
      this.logger.error('checkAppointmentReminders: ' + (e as Error).message);
    }
  }

  private async checkSlaStatus(): Promise<void> {
    const tickets = await this.tickets
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
      .getMany();
    if (tickets.length === 0) return;

    const contracts = await this.contracts.find({ where: { active: true } });
    const contractMap = new Map(contracts.map((c) => [c.customerId, c]));

    const techs = await this.technicians.find();
    const techToUser = new Map(techs.map((t) => [t.id, t.userId]));

    for (const ticket of tickets) {
      const contract = ticket.customerId ? (contractMap.get(ticket.customerId) ?? null) : null;
      const { sla, status } = this.slaService.compute(ticket, contract);
      if (
        (status === SlaStatus.AMARILLO || status === SlaStatus.ROJO) &&
        ticket.technicianId
      ) {
        const key = `${ticket.id}:${status}`;
        if (this.notified.has(key)) continue;
        const userId = techToUser.get(ticket.technicianId);
        if (!userId) continue;
        await this.notifications.create({
          userId,
          type: NotificationType.SLA_EN_RIESGO,
          payload: {
            ticketId: ticket.id,
            title: ticket.title,
            status,
            sla: { ...sla },
          },
        });
        this.notified.add(key);
        // Keep the de-dup set bounded.
        if (this.notified.size > 5000) this.notified.clear();
      }
    }
  }

  // Envía recordatorios de citas de Agenda a los técnicos asignados,
  // `reminder_minutes` minutos antes del start_at. Marca reminder_sent_at (email)
  // y whatsapp_reminder_sent_at (WhatsApp) de forma independiente tras el intento:
  //  - Email: se marca siempre (aunque falle) para no reintentar en loop infinito.
  //  - WhatsApp: se marca SOLO si al menos un envío fue exitoso; si falla todo
  //    (plantilla sin aprobar / sin whatsapp_phone), se reintenta en el siguiente
  //    ciclo del cron (5 min). Devuelve cuántas citas procesaron al menos un canal.
  private async checkAppointmentReminders(): Promise<number> {
    const now = new Date();
    const appts = await this.appointments
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.technician', 'mainTech')
      .leftJoinAndSelect('mainTech.user', 'mainUser')
      .leftJoinAndSelect('a.technicianLinks', 'links')
      .leftJoinAndSelect('links.technician', 'linkTech')
      .leftJoinAndSelect('linkTech.user', 'linkUser')
      .leftJoinAndSelect('a.customer', 'customer')
      .where('a.reminder_minutes IS NOT NULL')
      // El email Y el WhatsApp se controlan independientemente: si uno falló y el
      // otro no, reintenta solo el que falló en el siguiente ciclo.
      .andWhere('(a.reminder_sent_at IS NULL OR a.whatsapp_reminder_sent_at IS NULL)')
      .andWhere('a.start_at > :now', { now })
      // La ventana de recordatorio ya empezó: ahora >= start_at - reminder_minutes.
      .andWhere(`(a.start_at - (a.reminder_minutes * interval '1 minute')) <= :now`, { now })
      .getMany();

    let processed = 0;
    for (const appt of appts) {
      // Reúne los técnicos (principal + links) sin duplicar, con email y whatsappPhone.
      const techs = new Map<string, { name: string; email: string | null; whatsappPhone: string | null }>();
      const addTech = (
        id: string | null | undefined,
        u?: { name?: string; email?: string } | null,
        wp?: string | null,
      ) => {
        if (!id || !u) return;
        techs.set(id, { name: u.name || u.email || 'Técnico', email: u.email || null, whatsappPhone: wp ?? null });
      };
      addTech(appt.technicianId, appt.technician?.user, appt.technician?.whatsappPhone ?? null);
      for (const link of appt.technicianLinks || [])
        addTech(link.technicianId, link.technician?.user, link.technician?.whatsappPhone ?? null);

      // --- Canal 1: Email (comportamiento actual, sin cambios) ------------------
      let anyEmailSent = false;
      if (!appt.reminderSentAt) {
        for (const tech of techs.values()) {
          if (!tech.email) {
            this.logger.warn(`[CITA-REMINDER] cita ${appt.id}: técnico sin email (${tech.name}), se omite`);
            continue;
          }
          try {
            await this.mail.sendAppointmentReminder(tech.email, {
              technicianName: tech.name,
              subject: appt.subject || 'turno',
              startAt: appt.startAt.toISOString(),
              customerName: appt.customer?.name ?? null,
              notes: appt.notes ?? null,
            });
            this.logger.log(`[CITA-REMINDER] cita ${appt.id}: recordatorio email enviado a ${tech.email}`);
            anyEmailSent = true;
          } catch (e) {
            this.logger.error(`[CITA-REMINDER] cita ${appt.id}: fallo email a ${tech.email}: ${(e as Error).message}`);
          }
        }
      }

      // --- Canal 2: WhatsApp (template pre-aprobada de Meta) --------------------
      // Se reintenta solo si whatsappReminderSentAt es null (no afecta al email).
      let anyWhatsappSent = false;
      if (!appt.whatsappReminderSentAt) {
        for (const tech of techs.values()) {
          if (!tech.whatsappPhone) continue; // sin teléfono → se omite silenciosamente
          try {
            const result = await this.whatsapp.sendAppointmentReminderTemplate(
              tech.whatsappPhone,
              appt.customer?.name || 'un cliente',
              appt.startAt,
            );
            if (result.ok) {
              this.logger.log(`[CITA-WA] cita ${appt.id}: recordatorio WhatsApp enviado a ${tech.name} (${tech.whatsappPhone})`);
              anyWhatsappSent = true;
            } else {
              this.logger.warn(`[CITA-WA] cita ${appt.id}: fallo WhatsApp a ${tech.whatsappPhone}: ${result.error} (se reintenta en próximo ciclo)`);
            }
          } catch (e) {
            this.logger.error(`[CITA-WA] cita ${appt.id}: fallo WhatsApp a ${tech.whatsappPhone}: ${(e as Error).message}`);
          }
        }
      }

      // Marca email siempre tras el intento (aunque todos los envíos fallen) para
      // no reintentar en loop infinito — comportamiento original sin cambios.
      if (!appt.reminderSentAt) appt.reminderSentAt = new Date();
      // WhatsApp se marca SOLO si al menos un envío fue exitoso; si falla todo
      // (plantilla sin aprobar / sin teléfono), se reintenta en el próximo ciclo.
      if (anyWhatsappSent) appt.whatsappReminderSentAt = new Date();
      await this.appointments.save(appt);
      if (anyEmailSent || anyWhatsappSent) processed++;
    }
    return processed;
  }
}
