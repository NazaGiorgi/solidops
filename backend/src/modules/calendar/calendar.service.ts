import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { AppointmentTechnician } from '../../entities/appointment-technician.entity';
import { Task } from '../../entities/task.entity';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
  MoveAppointmentDto,
  CreateTaskDto,
  UpdateTaskDto,
  ListCalendarQuery,
} from './dto';
import {
  AuditAction,
  AuditEntityType,
  TaskStatus,
  RecurrenceRule,
  NotificationType,
  TicketPriority,
  AppointmentStatus,
} from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { User } from '../../entities/user.entity';

@Injectable()
export class CalendarService {
  constructor(
    @InjectRepository(Appointment) private readonly appointments: Repository<Appointment>,
    @InjectRepository(AppointmentTechnician)
    private readonly appointmentTechs: Repository<AppointmentTechnician>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAppointments(query: ListCalendarQuery, actor: AuthenticatedUser) {
    const where: Record<string, unknown> = {};
    if (query.from && query.to) {
      where.startAt = Between(new Date(query.from), new Date(query.to));
    }
    if (query.technicianId) where.technicianId = query.technicianId;
    if (query.ticketId) where.ticketId = query.ticketId;
    const rows = await this.appointments.find({
      where,
      relations: { customer: true, technician: { user: true }, ticket: true, technicianLinks: { technician: { user: true } }, createdBy: true },
      order: { startAt: 'ASC' },
    });
    // Privacidad: los eventos privados solo se muestran a su creador. Los que no
    // tienen created_by_user_id (históricos) y son privados no se muestran a nadie
    // (no hay dueño que verificar).
    return rows.filter((a) => !a.isPrivate || (a.createdByUserId && a.createdByUserId === actor.id));
  }

  async getAppointment(id: string, actor: AuthenticatedUser): Promise<Appointment> {
    const appt = await this.appointments.findOne({
      where: { id },
      relations: { customer: true, technician: { user: true }, technicianLinks: { technician: { user: true } }, createdBy: true },
    });
    if (!appt) throw new NotFoundException('Turno no encontrado');
    // Privacidad: un evento privado no es accesible por ID para quien no lo creó.
    if (appt.isPrivate && (!appt.createdByUserId || appt.createdByUserId !== actor.id)) {
      throw new NotFoundException('Turno no encontrado');
    }
    return appt;
  }

  async createAppointment(dto: CreateAppointmentDto, actor: AuthenticatedUser) {
    const appt = this.appointments.create({
      type: dto.type,
      status: dto.status ?? AppointmentStatus.PROGRAMADO,
      technicianId: dto.technicianId ?? null,
      customerId: dto.customerId ?? null,
      ticketId: dto.ticketId ?? null,
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      subject: dto.subject ?? null,
      notes: dto.notes ?? null,
      reminderMinutes: dto.reminderMinutes ?? null,
      isPrivate: dto.isPrivate ?? false,
      createdByUserId: actor.id,
    });
    const saved = await this.appointments.save(appt);
    // Guardar la lista M:N de técnicos asignados (incl. el responsable principal).
    await this.replaceTechnicianLinks(saved.id, dto.technicianId, dto.technicianIds);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.APPOINTMENT,
      entityId: saved.id,
      newValue: { type: saved.type, startAt: saved.startAt, ticketId: saved.ticketId, isPrivate: saved.isPrivate },
    });
    return this.appointments.findOne({
      where: { id: saved.id },
      relations: { customer: true, technician: { user: true }, ticket: true, technicianLinks: { technician: { user: true } }, createdBy: true },
    });
  }

  // Reemplaza la lista de técnicos asignados a una cita (M:N). El responsable
  // principal (technicianId) se incluye siempre si no viene en technicianIds.
  private async replaceTechnicianLinks(
    appointmentId: string,
    mainTechnicianId: string | null | undefined,
    technicianIds?: string[],
  ): Promise<void> {
    await this.appointmentTechs.delete({ appointmentId });
    const ids = new Set<string>();
    if (mainTechnicianId) ids.add(mainTechnicianId);
    for (const id of technicianIds || []) if (id) ids.add(id);
    for (const id of ids) {
      await this.appointmentTechs.save(
        this.appointmentTechs.create({ appointmentId, technicianId: id }),
      );
    }
  }

  async moveAppointment(id: string, dto: MoveAppointmentDto, actor: AuthenticatedUser) {
    const appt = await this.appointments.findOne({ where: { id } });
    if (!appt) throw new NotFoundException('Turno no encontrado');
    const old = { startAt: appt.startAt, endAt: appt.endAt, technicianId: appt.technicianId };
    appt.startAt = new Date(dto.startAt);
    appt.endAt = new Date(dto.endAt);
    if (dto.technicianId !== undefined) appt.technicianId = dto.technicianId;
    const saved = await this.appointments.save(appt);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.APPOINTMENT,
      entityId: id,
      oldValue: {
        startAt: old.startAt?.toISOString(),
        endAt: old.endAt?.toISOString(),
        technicianId: old.technicianId,
      },
      newValue: {
        startAt: saved.startAt.toISOString(),
        endAt: saved.endAt.toISOString(),
        technicianId: saved.technicianId,
      },
    });
    return saved;
  }

  // Generic patch: applies only the fields present, supports drag&drop via
  // any subset of startAt/endAt/technicianId/type/subject/customerId.
  async updateAppointment(id: string, dto: UpdateAppointmentDto, actor: AuthenticatedUser) {
    const appt = await this.appointments.findOne({ where: { id } });
    if (!appt) throw new NotFoundException('Turno no encontrado');
    const old = { startAt: appt.startAt, endAt: appt.endAt, technicianId: appt.technicianId };
    if (dto.type !== undefined) appt.type = dto.type;
    if (dto.status !== undefined) appt.status = dto.status;
    if (dto.subject !== undefined) appt.subject = dto.subject;
    if (dto.notes !== undefined) appt.notes = dto.notes;
    if (dto.customerId !== undefined) appt.customerId = dto.customerId;
    if (dto.technicianId !== undefined) appt.technicianId = dto.technicianId;
    if (dto.ticketId !== undefined) appt.ticketId = dto.ticketId;
    if (dto.startAt !== undefined) appt.startAt = new Date(dto.startAt);
    if (dto.endAt !== undefined) appt.endAt = new Date(dto.endAt);
    if (dto.reminderMinutes !== undefined) appt.reminderMinutes = dto.reminderMinutes;
    if (dto.isPrivate !== undefined) appt.isPrivate = dto.isPrivate;
    const saved = await this.appointments.save(appt);
    // Si vino la lista de técnicos, reemplazarla (incluye al responsable).
    if (dto.technicianIds !== undefined) {
      const main = dto.technicianId !== undefined ? dto.technicianId : saved.technicianId;
      await this.replaceTechnicianLinks(saved.id, main, dto.technicianIds);
    }
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.APPOINTMENT,
      entityId: id,
      oldValue: {
        startAt: old.startAt?.toISOString(),
        endAt: old.endAt?.toISOString(),
        technicianId: old.technicianId,
      },
      newValue: {
        startAt: saved.startAt.toISOString(),
        endAt: saved.endAt.toISOString(),
        technicianId: saved.technicianId,
      },
    });
    return saved;
  }

  async deleteAppointment(id: string, actor: AuthenticatedUser) {
    const appt = await this.appointments.findOne({ where: { id } });
    if (!appt) throw new NotFoundException('Turno no encontrado');
    await this.appointments.remove(appt);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.APPOINTMENT,
      entityId: id,
    });
    return { ok: true };
  }

  // --- Tasks ---------------------------------------------------------------
  async getTasks(query: ListCalendarQuery, forAssigneeId?: string) {
    const qb = this.tasks
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .where('task.status IN (:...active)', {
        active: [TaskStatus.PENDIENTE, TaskStatus.EN_PROGRESO],
      })
      .orderBy('task.dueAt', 'ASC');
    if (forAssigneeId) qb.andWhere('task.assignee_id = :a', { a: forAssigneeId });
    if (query.from && query.to) {
      qb.andWhere('task.due_at BETWEEN :from AND :to', {
        from: new Date(query.from),
        to: new Date(query.to),
      });
    }
    return qb.getMany();
  }

  async createTask(dto: CreateTaskDto, actor: AuthenticatedUser) {
    const task = this.tasks.create({
      title: dto.title,
      assigneeId: dto.assigneeId ?? null,
      dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      status: dto.status ?? TaskStatus.PENDIENTE,
      priority: dto.priority ?? TicketPriority.NORMAL,
      recurrenceRule: dto.recurrenceRule ?? RecurrenceRule.NONE,
      notes: dto.notes ?? null,
      relatedEntityType: dto.relatedEntityType ?? null,
      relatedEntityId: dto.relatedEntityId ?? null,
    });
    const saved = await this.tasks.save(task);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TASK,
      entityId: saved.id,
      newValue: { title: saved.title, status: saved.status },
    });
    return saved;
  }

  async updateTask(id: string, dto: UpdateTaskDto, actor: AuthenticatedUser) {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Tarea no encontrada');

    // Recurrence: when dueDat is advanced and rule is set, we generate the next
    // occurrence rather than just moving the same row.
    const shouldRecur =
      dto.status === TaskStatus.HECHA &&
      task.recurrenceRule !== RecurrenceRule.NONE;
    if (shouldRecur) {
      const next = await this.spawnNextOccurrence(task);
      return next;
    }

    if (dto.title !== undefined) task.title = dto.title;
    if (dto.assigneeId !== undefined) task.assigneeId = dto.assigneeId;
    if (dto.dueAt !== undefined) task.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.recurrenceRule !== undefined) task.recurrenceRule = dto.recurrenceRule;
    if (dto.notes !== undefined) task.notes = dto.notes;
    const saved = await this.tasks.save(task);

    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TASK,
      entityId: id,
      oldValue: { status: task.status, priority: task.priority },
      newValue: { status: saved.status, priority: saved.priority },
    });
    return saved;
  }

  private async spawnNextOccurrence(task: Task): Promise<Task> {
    const nextDate = nextOccurrenceDate(
      task.dueAt ?? new Date(),
      task.recurrenceRule as RecurrenceRule,
    );
    // Mark current as done.
    task.status = TaskStatus.HECHA;
    await this.tasks.save(task);
    // Create next occurrence (keeps same rule).
    const next = this.tasks.create({
      title: task.title,
      assigneeId: task.assigneeId,
      dueAt: nextDate,
      status: TaskStatus.PENDIENTE,
      priority: task.priority,
      recurrenceRule: task.recurrenceRule,
      notes: task.notes,
      recurrenceParentId: task.id,
    });
    return this.tasks.save(next);
  }

  async getTask(id: string): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id }, relations: { assignee: true } });
    if (!task) throw new NotFoundException('Tarea no encontrada');
    return task;
  }

  // Overdue tasks: notify assigned user.
  async checkAndNotifyOverdue(): Promise<number> {
    const overdue = await this.tasks
      .createQueryBuilder('task')
      .where('task.status IN (:...active)', {
        active: [TaskStatus.PENDIENTE, TaskStatus.EN_PROGRESO],
      })
      .andWhere('task.due_at IS NOT NULL')
      .andWhere('task.due_at < :now', { now: new Date() })
      .getMany();
    for (const t of overdue) {
      if (t.assigneeId) {
        await this.notifications.create({
          userId: t.assigneeId,
          type: NotificationType.TAREA_ATRASADA,
          payload: { taskId: t.id, title: t.title, dueAt: t.dueAt?.toISOString() },
        });
      }
    }
    return overdue.length;
  }
}

// Compute the next occurrence date for a recurring task.
export function nextOccurrenceDate(
  reference: Date,
  rule: RecurrenceRule,
): Date {
  const d = new Date(reference);
  switch (rule) {
    case RecurrenceRule.DAILY:
      d.setDate(d.getDate() + 1);
      break;
    case RecurrenceRule.WEEKLY:
      d.setDate(d.getDate() + 7);
      break;
    case RecurrenceRule.MONTHLY:
      d.setMonth(d.getMonth() + 1);
      break;
    default:
      d.setDate(d.getDate() + 1);
  }
  return d;
}
