import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Ticket } from './ticket.entity';
import { SlaStatus } from '../common/enums';

@Entity('sla')
@Index(['ticketId'])
@Index(['status'])
export class Sla extends BaseEntity {
  // ticketId and status are indexed via the class-level @Index() decorators
  // above. Do NOT also decorate the columns with @Index(), otherwise TypeORM
  // would emit two CREATE INDEX for the same columns and synchronize fails.
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @ManyToOne(() => Ticket, (ticket) => ticket.slaRecords)
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({ name: 'first_response_due_at', type: 'timestamptz', nullable: true })
  firstResponseDueAt: Date | null;

  @Column({ name: 'resolution_due_at', type: 'timestamptz', nullable: true })
  resolutionDueAt: Date | null;

  // When the first agent (or system) response landed.
  @Column({ name: 'first_response_at', type: 'timestamptz', nullable: true })
  firstResponseAt: Date | null;

  // When the ticket reached a resolved/closed state.
  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: SlaStatus.VERDE })
  status: SlaStatus;

  // Snapshot of the targets used to compute this SLA (for audits/history).
  @Column({ name: 'target_first_response_minutes', type: 'int', nullable: true })
  targetFirstResponseMinutes: number | null;

  @Column({ name: 'target_resolution_hours', type: 'int', nullable: true })
  targetResolutionHours: number | null;
}
