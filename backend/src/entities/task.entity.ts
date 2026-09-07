import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { User } from './user.entity';
import { TaskStatus, TicketPriority, RecurrenceRule } from '../common/enums';

@Entity('tasks')
@Index(['assigneeId'])
@Index(['status'])
export class Task extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  title: string;

  // assigneeId and status are indexed via the class-level @Index() decorators.
  // Do NOT decorate these columns with @Index() too, or synchronize emits two
  // CREATE INDEX for the same columns and fails with "already exists".
  @Column({ name: 'assignee_id', type: 'uuid', nullable: true })
  assigneeId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'assignee_id' })
  assignee: User | null;

  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ type: 'varchar', length: 24, default: TaskStatus.PENDIENTE })
  status: TaskStatus;

  @Column({ type: 'varchar', length: 20, default: TicketPriority.NORMAL })
  priority: TicketPriority;

  // Recurrence: none | daily | weekly | monthly.
  @Column({ name: 'recurrence_rule', type: 'varchar', length: 20, default: RecurrenceRule.NONE })
  recurrenceRule: RecurrenceRule;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // Polymorphic relation reference (e.g. 'ticket' -> ticket id, 'customer' -> customer id).
  @Column({ name: 'related_entity_type', type: 'varchar', length: 40, nullable: true })
  relatedEntityType: string | null;

  @Column({ name: 'related_entity_id', type: 'uuid', nullable: true })
  relatedEntityId: string | null;

  // When a recurring task generated this occurrence (null for the template).
  @Column({ name: 'recurrence_parent_id', type: 'uuid', nullable: true })
  recurrenceParentId: string | null;
}
