import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { SoftDeleteEntity } from '../common/entities/soft-delete.entity';
import { Customer } from './customer.entity';
import { Contact } from './contact.entity';
import { Site } from './site.entity';
import { Technician } from './technician.entity';
import { User } from './user.entity';
import { TicketStatus, TicketPriority } from '../common/enums';
import { TicketMessage } from './ticket-message.entity';
import { Sla } from './sla.entity';

@Entity('tickets')
@Index(['customerId'])
@Index(['technicianId'])
@Index(['status'])
@Index(['priority'])
export class Ticket extends SoftDeleteEntity {
  // customerId, technicianId, status and priority are indexed via the
  // class-level @Index() decorators. Do NOT also @Index() those columns here,
  // or synchronize would emit duplicate CREATE INDEX and fail.
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Index()
  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @ManyToOne(() => Contact, { nullable: true })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact | null;

  @Index()
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  @ManyToOne(() => Site, { nullable: true })
  @JoinColumn({ name: 'site_id' })
  site: Site | null;

  @Column({ name: 'technician_id', type: 'uuid', nullable: true })
  technicianId: string | null;

  @ManyToOne(() => Technician, { nullable: true })
  @JoinColumn({ name: 'technician_id' })
  technician: Technician | null;

  // Reference to the internal user who opened/assigned the ticket (nullable for
  // email-auto-created tickets without a user).
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User | null;

  @Column({ type: 'varchar', length: 500 })
  title: string;

  @Column({ type: 'varchar', length: 24, default: TicketStatus.NUEVO })
  status: TicketStatus;

  @Column({ type: 'varchar', length: 20, default: TicketPriority.NORMAL })
  priority: TicketPriority;

  @Column({ type: 'varchar', length: 80, nullable: true })
  category: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Número de ticket humano-legible (TK-{año}-{número}). Es el contador global
  // secuencial (Postgres sequence `ticket_number_seq`), único y que nunca se
  // reinicia. El prefijo TK-{año} se arma en el frontend a partir de created_at.
  @Index({ unique: true })
  @Column({ name: 'ticket_number', type: 'int', nullable: false })
  ticketNumber: number;

  // Normalised version of the inbound email subject used to match threads.
  @Column({ name: 'subject_key', type: 'varchar', length: 400, nullable: true })
  subjectKey: string | null;

  // Origin of the ticket: 'manual' | 'email' | 'portal'.
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  source: string;

  // Shadow mode: created from a mailbox in shadow_mode (Zammad still owns the
  // mailbox). These tickets are isolated from the operational flow (dashboard,
  // "Mi día", counters) and carry a visible "no responder" warning.
  @Column({ type: 'boolean', default: false })
  shadow: boolean;

  // Original Zammad ticket id, for traceability of migrated records. Null for
  // tickets created natively in SolidOps.
  @Index()
  @Column({ name: 'legacy_zammad_id', type: 'varchar', length: 40, nullable: true })
  legacyZammadId: string | null;

  // Original Zammad group name (e.g. 'L1', 'L2', 'L3', 'Users', 'Backups MK',
  // 'Taller', 'Ventas'). Used to filter by "bandeja": the operational view (by
  // default) only shows legacy_group in (L1,L2,L3) or native tickets (NULL).
  // Migrated noise groups are hidden but still queryable when needed.
  @Index()
  @Column({ name: 'legacy_group', type: 'varchar', length: 80, nullable: true })
  legacyGroup: string | null;

  // Timestamps relevant to SLA.
  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  // --- Ticket merging (P3) ---
  // If this ticket was merged, `merged_into_id` points to the principal ticket.
  // The principal has `merged_into_id = null`.
  @Index()
  @Column({ name: 'merged_into_id', type: 'uuid', nullable: true })
  mergedIntoId: string | null;

  // Group identifier shared by every ticket in the same merge (principal + all
  // children). Used to dissolve the whole merge and to link histories.
  @Index()
  @Column({ name: 'merge_group_id', type: 'uuid', nullable: true })
  mergeGroupId: string | null;

  @OneToMany(() => TicketMessage, (message) => message.ticket)
  messages: TicketMessage[];

  @OneToMany(() => Sla, (sla) => sla.ticket)
  slaRecords: Sla[];
}
