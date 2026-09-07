import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Technician } from './technician.entity';
import { Customer } from './customer.entity';
import { Ticket } from './ticket.entity';
import { User } from './user.entity';
import { AppointmentTechnician } from './appointment-technician.entity';
import { AppointmentType, AppointmentStatus } from '../common/enums';

@Entity('appointments')
@Index(['technicianId'])
@Index(['startAt'])
export class Appointment extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 20, default: AppointmentType.REUNION })
  type: AppointmentType;

  @Index()
  @Column({ type: 'varchar', length: 20, default: AppointmentStatus.PROGRAMADO })
  status: AppointmentStatus;

  // technicianId and startAt are indexed via the class-level @Index() above.
  // Do NOT also @Index() them here (duplicate CREATE INDEX would fail).
  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  @ManyToOne(() => Technician, { nullable: true })
  @JoinColumn({ name: 'technician_id' })
  technician: Technician | null;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  // Vínculo opcional a un ticket de soporte (una cita puede existir sin ticket;
  // así no se rompe el uso actual de Agenda).
  @Index()
  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId: string | null;

  @ManyToOne(() => Ticket, { nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket | null;

  @OneToMany(() => AppointmentTechnician, (link) => link.appointment, { cascade: true })
  technicianLinks: AppointmentTechnician[];

  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Optional title/summary for the calendar entry.
  @Column({ name: 'subject', type: 'varchar', length: 200, nullable: true })
  subject: string | null;

  // Minutes before start_at that a reminder should fire (null = no reminder).
  @Column({ name: 'reminder_minutes', type: 'int', nullable: true })
  reminderMinutes: number | null;

  // Cuándo se envió (o se intentó enviar) el recordatorio por email. Se marca
  // tras el intento para que el cron no vuelva a enviarlo en la siguiente corrida.
  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt: Date | null;

  // Control INDEPENDIENTE del recordatorio por WhatsApp. Se marca tras el intento
  // (aunque falle) igual que reminder_sent_at, pero por separado: si el email ya
  // se mandó y WhatsApp falló (plantilla sin aprobar / sin whatsapp_phone), en el
  // siguiente ciclo el cron reintenta solo el de WhatsApp, sin re-mandar el email.
  @Column({ name: 'whatsapp_reminder_sent_at', type: 'timestamptz', nullable: true })
  whatsappReminderSentAt: Date | null;

  // Evento privado: solo lo ve quien lo creó (created_by_user_id). Ningún otro
  // rol tiene excepción. Default false (visible para todos, comportamiento actual).
  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  // Usuario autenticado que creó el turno. Null para registros históricos
  // (migrados antes de este cambio, no se puede saber retroactivamente).
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdBy: User | null;
}
