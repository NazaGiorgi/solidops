import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  AppointmentType,
  AppointmentStatus,
  TaskStatus,
  TicketPriority,
  RecurrenceRule,
} from '../../common/enums';

export class CreateAppointmentDto {
  @IsEnum(AppointmentType)
  type: AppointmentType;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  ticketId?: string;

  // Técnicos asignados a la cita (varios). El responsable principal
  // (technicianId) se añade automáticamente a esta lista si no viene.
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  technicianIds?: string[];

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  reminderMinutes?: number;

  // Evento privado: solo lo ve quien lo creó.
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsUUID()
  technicianId?: string | null;

  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsUUID()
  ticketId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  technicianIds?: string[];

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  reminderMinutes?: number | null;

  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

// Drag & drop move/reschedule payload.
export class MoveAppointmentDto {
  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string | null;
}

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(RecurrenceRule)
  recurrenceRule?: RecurrenceRule;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['ticket', 'customer'])
  relatedEntityType?: 'ticket' | 'customer';

  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsEnum(RecurrenceRule)
  recurrenceRule?: RecurrenceRule;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(['ticket', 'customer'])
  relatedEntityType?: 'ticket' | 'customer';

  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;
}

export class ListCalendarQuery {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsBoolean()
  mine?: boolean;

  // Vista de equipo de la Agenda: todas las tareas pendientes + sin asignar.
  @IsOptional()
  @IsBoolean()
  team?: boolean;

  // 'pendiente,en_progreso' (por defecto), un estado concreto o 'all'.
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsIn(['ticket', 'customer'])
  relatedEntityType?: 'ticket' | 'customer';

  @IsOptional()
  @IsUUID()
  relatedEntityId?: string;

  @IsOptional()
  @IsBoolean()
  overdue?: boolean;

  // Las vistas de pendientes incluyen vencidas y sin vencimiento por defecto.
  @IsOptional()
  @IsBoolean()
  includeOverdue?: boolean;
}
