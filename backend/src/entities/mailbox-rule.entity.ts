import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Customer } from './customer.entity';
import { TicketGroup } from './ticket-group.entity';

// Routing rules ("cajones") evaluated in priority order when an email arrives
// on a mailbox. The first active matching rule decides the destination.
// destination: 'ticket' | 'document' | 'discard'
// target_customer_strategy: 'auto_match_asset' | 'fixed_customer_id' | null
// Cuando destination='ticket' y target_group_id está seteado, el ticket creado
// cae en ese box (se escribe tickets.legacy_group = ticket_groups.name).
@Entity('mailbox_rules')
export class MailboxRule extends BaseEntity {
  @Index()
  @Column({ name: 'mailbox_email', type: 'varchar', length: 160 })
  mailboxEmail: string;

  // Optional sender pattern (regex or plain text). Matched case-insensitively
  // against the sender email/address.
  @Column({ name: 'sender_pattern', type: 'varchar', length: 255, nullable: true })
  senderPattern: string | null;

  // Optional subject pattern (regex or plain text).
  @Column({ name: 'subject_pattern', type: 'varchar', length: 255, nullable: true })
  subjectPattern: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ticket' })
  destination: string;

  @Column({ name: 'target_customer_strategy', type: 'varchar', length: 30, nullable: true })
  targetCustomerStrategy: string | null;

  @Index()
  @Column({ name: 'target_group_id', type: 'uuid', nullable: true })
  targetGroupId: string | null;

  @ManyToOne(() => TicketGroup, { nullable: true })
  @JoinColumn({ name: 'target_group_id' })
  targetGroup: TicketGroup | null;

  @Index()
  @Column({ name: 'fixed_customer_id', type: 'uuid', nullable: true })
  fixedCustomerId: string | null;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'fixed_customer_id' })
  fixedCustomer: Customer | null;

  // Lower number = evaluated first.
  @Column({ type: 'int', default: 100 })
  priority: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}
