import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { AppointmentTechnician } from '../../entities/appointment-technician.entity';
import { Task } from '../../entities/task.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Customer } from '../../entities/customer.entity';
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
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getAppointments(query: ListCalendarQuery, actor: AuthenticatedUser) {
    // El filtro por técnico incluye tanto al respons principal (technician_id)
    // como a los técnicos de appointment_technicians. distinct evita duplicar
    // una cita cuando el técnico appearing en ambos lados.
    const qb = this.appointments
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.customer', 'customer')
      .leftJoinAndSelect('a.technician', 'technician')
      .leftJoinAndSelect('technician.user', 'techUser')
      .leftJoinAndSelect('a.ticket', 'ticket')
      .leftJoinAndSelect('a.technicianLinks', 'techLinks')
      .leftJoinAndSelect('techLinks.technician', 'linkTech')
      .leftJoinAndSelect('linkTech.user', 'linkUser')
      .leftJoinAndSelect('a.createdBy', 'createdBy')
      .distinct(true);
    if (query.from && query.to) {
      qb.andWhere('a.startAt BETWEEN :from AND :to', {
        from: new Date(query.from),
        to: new Date(query.to),
      });
    }
    if (query.technicianId) {
      // Filtrar con `techLinks.technicianId` recortaría el leftJoinAndSelect a
      // SOLO el técnico buscado. EXISTS decide qué citas califican sin tocar
      // los joins: la cita se devuelve con TODOS sus technicianLinks.
      qb.andWhere(
        '(a.technicianId = :techId OR EXISTS (' +
        'SELECT 1 FROM appointment_technicians atl ' +
        'WHERE atl.appointment_id = a.id AND atl.technician_id = :techId))',
        { techId: query.technicianId },
      );
    }
    if (query.ticketId) qb.andWhere('a.ticketId = :ticketId', { ticketId: query.ticketId });
    const rows = await qb.orderBy('a.startAt', 'ASC').getMany();
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

  // Reasignar cambia el técnico principal SIN borrar a los secundarios: se saca
  // el link del responsable anterior y se asegura el del nuevo.
  private async syncMainTechnicianLink(
    appointmentId: string,
    oldMain: string | null | undefined,
    newMain: string | null | undefined,
  ): Promise<void> {
    if (oldMain && oldMain !== newMain) {
      await this.appointmentTechs.delete({ appointmentId, technicianId: oldMain });
    }
    if (newMain) {
      await this.appointmentTechs.save(
        this.appointmentTechs.create({ appointmentId, technicianId: newMain }),
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
    if (dto.technicianId !== undefined && old.technicianId !== saved.technicianId) {
      await this.syncMainTechnicianLink(saved.id, old.technicianId, saved.technicianId);
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
    } else if (dto.technicianId !== undefined && old.technicianId !== saved.technicianId) {
      await this.syncMainTechnicianLink(saved.id, old.technicianId, saved.technicianId);
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
  private taskSnapshot(task: Task) {
    return {
      title: task.title,
      assigneeId: task.assigneeId,
      dueAt: task.dueAt ? new Date(task.dueAt) : null,
      status: task.status,
      priority: task.priority,
      recurrenceRule: task.recurrenceRule,
      notes: task.notes,
      relatedEntityType: task.relatedEntityType,
      relatedEntityId: task.relatedEntityId,
    };
  }

  private parseStatusFilter(status?: string): TaskStatus[] | 'all' {
    if (!status || status === 'all') return status === 'all' ? 'all' : [
      TaskStatus.PENDIENTE,
      TaskStatus.EN_PROGRESO,
    ];
    const values = status.split(',').map((s) => s.trim()).filter(Boolean);
    const allowed = Object.values(TaskStatus) as string[];
    const invalid = values.filter((v) => !allowed.includes(v));
    if (invalid.length) {
      throw new BadRequestException(`Estado de tarea inválido: ${invalid.join(', ')}`);
    }
    return values as TaskStatus[];
  }

  private async validateAssignee(assigneeId?: string | null): Promise<void> {
    if (!assigneeId) return;
    const user = await this.users.findOne({ where: { id: assigneeId, active: true } });
    if (!user) throw new BadRequestException('El responsable debe ser un usuario interno activo');
  }

  private async validateRelatedEntity(
    relatedEntityType?: string | null,
    relatedEntityId?: string | null,
  ): Promise<void> {
    if (!relatedEntityType && !relatedEntityId) return;
    if (!relatedEntityType || !relatedEntityId) {
      throw new BadRequestException('La tarea vinculada necesita tipo e identificador');
    }
    if (!['ticket', 'customer'].includes(relatedEntityType)) {
      throw new BadRequestException('Sólo se puede vincular a un ticket o a un cliente');
    }
    const exists = relatedEntityType === 'ticket'
      ? await this.tickets.findOne({ where: { id: relatedEntityId } })
      : await this.customers.findOne({ where: { id: relatedEntityId } });
    if (!exists) throw new BadRequestException('El ticket o cliente vinculado no existe');
  }

  private async notifyAssignee(
    task: Task,
    actor: AuthenticatedUser,
  ): Promise<void> {
    if (!task.assigneeId || task.assigneeId === actor.id) return;
    const due = task.dueAt
      ? new Intl.DateTimeFormat('es-AR', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          timeZone: 'America/Argentina/Buenos_Aires',
        }).format(new Date(task.dueAt))
      : 'sin fecha';
    await this.notifications.create({
      userId: task.assigneeId,
      type: NotificationType.TAREA_ASIGNADA,
      payload: {
        taskId: task.id,
        title: task.title,
        dueAt: task.dueAt?.toISOString() ?? null,
        message: `Te asignaron la tarea: ${task.title} (vence ${due})`,
      },
    });
  }

  async getTasks(query: ListCalendarQuery, currentUserId?: string) {
    const qb = this.tasks
      .createQueryBuilder('task')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .orderBy('task.dueAt', 'ASC', 'NULLS LAST');

    // Sin filtros explícitos sobre la tarea, el listado es el de "mis tareas".
    const hasExplicitTaskFilter =
      query.assigneeId !== undefined ||
      query.mine !== undefined ||
      query.team === true ||
      query.relatedEntityType !== undefined ||
      query.relatedEntityId !== undefined;
    const assigneeId = query.mine ? currentUserId : query.assigneeId;
    if (assigneeId) qb.andWhere('task.assignee_id = :a', { a: assigneeId });
    else if (!hasExplicitTaskFilter && currentUserId && query.overdue !== true) {
      qb.andWhere('task.assignee_id = :a', { a: currentUserId });
    }

    const statuses = this.parseStatusFilter(query.status);
    if (statuses !== 'all') {
      qb.andWhere('task.status IN (:...statuses)', { statuses });
    }
    if (query.relatedEntityType) {
      qb.andWhere('task.related_entity_type = :type', { type: query.relatedEntityType });
    }
    if (query.relatedEntityId) {
      qb.andWhere('task.related_entity_id = :relatedId', { relatedId: query.relatedEntityId });
    }
    if (query.overdue) {
      qb.andWhere('task.due_at IS NOT NULL').andWhere('task.due_at < :now', { now: new Date() });
    }
    if (query.from && query.to) {
      const range = 'task.due_at BETWEEN :from AND :to';
      if (query.includeOverdue === false) {
        qb.andWhere(range, { from: new Date(query.from), to: new Date(query.to) });
      } else {
        // Las vistas de pendientes incluyen vencidas y sin vencimiento.
        qb.andWhere(
          `(${range} OR task.due_at IS NULL OR task.due_at < :from)`,
          { from: new Date(query.from), to: new Date(query.to) },
        );
      }
    }
    return qb.getMany();
  }

  async createTask(dto: CreateTaskDto, actor: AuthenticatedUser) {
    await this.validateAssignee(dto.assigneeId);
    await this.validateRelatedEntity(dto.relatedEntityType, dto.relatedEntityId);
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
      newValue: this.taskSnapshot(saved),
    });
    await this.notifyAssignee(saved, actor);
    return saved;
  }

  async updateTask(id: string, dto: UpdateTaskDto, actor: AuthenticatedUser) {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException('Tarea no encontrada');

    // Copiar ANTES de mutar: la auditoría necesita los valores reales previos.
    const old = this.taskSnapshot(task);
    const nextAssignee = dto.assigneeId !== undefined ? dto.assigneeId : task.assigneeId;
    const nextType = dto.relatedEntityType !== undefined ? dto.relatedEntityType : task.relatedEntityType;
    const nextRelatedId = dto.relatedEntityId !== undefined ? dto.relatedEntityId : task.relatedEntityId;
    await this.validateAssignee(nextAssignee);
    await this.validateRelatedEntity(nextType, nextRelatedId);

    const recurrenceBase = task.dueAt ? new Date(task.dueAt) : new Date();
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.assigneeId !== undefined) task.assigneeId = dto.assigneeId;
    if (dto.dueAt !== undefined) task.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.priority !== undefined) task.priority = dto.priority;
    if (dto.recurrenceRule !== undefined) task.recurrenceRule = dto.recurrenceRule;
    if (dto.notes !== undefined) task.notes = dto.notes;
    if (dto.relatedEntityType !== undefined) task.relatedEntityType = dto.relatedEntityType;
    if (dto.relatedEntityId !== undefined) task.relatedEntityId = dto.relatedEntityId;

    const shouldRecur =
      task.status === TaskStatus.HECHA &&
      task.recurrenceRule !== RecurrenceRule.NONE;
    if (shouldRecur) {
      return this.spawnNextOccurrence(task, old, recurrenceBase, actor);
    }

    const saved = await this.tasks.save(task);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TASK,
      entityId: id,
      oldValue: old,
      newValue: this.taskSnapshot(saved),
    });
    if (nextAssignee && nextAssignee !== old.assigneeId) await this.notifyAssignee(saved, actor);
    return saved;
  }

  private async spawnNextOccurrence(
    task: Task,
    old: ReturnType<CalendarService['taskSnapshot']>,
    recurrenceBase: Date,
    actor: AuthenticatedUser,
  ): Promise<{ done: Task; next: Task }> {
    const nextDate = nextOccurrenceDate(recurrenceBase, task.recurrenceRule as RecurrenceRule);
    task.status = TaskStatus.HECHA;
    const done = await this.tasks.save(task);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TASK,
      entityId: done.id,
      oldValue: old,
      newValue: this.taskSnapshot(done),
    });

    // La próxima conserva vínculo, responsable y el resto de cambios del PATCH.
    const next = this.tasks.create({
      title: task.title,
      assigneeId: task.assigneeId,
      dueAt: nextDate,
      status: TaskStatus.PENDIENTE,
      priority: task.priority,
      recurrenceRule: task.recurrenceRule,
      notes: task.notes,
      relatedEntityType: task.relatedEntityType,
      relatedEntityId: task.relatedEntityId,
      recurrenceParentId: task.id,
    });
    const savedNext = await this.tasks.save(next);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TASK,
      entityId: savedNext.id,
      newValue: this.taskSnapshot(savedNext),
    });
    await this.notifyAssignee(savedNext, actor);
    return { done, next: savedNext };
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
