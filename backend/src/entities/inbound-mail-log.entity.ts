import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// Audit trail of every inbound email the worker sees. Powers the
// "correos recientes sin regla" admin view and the "crear regla para este
// remitente" shortcut. `routed` = whether a rule matched / was applied.
@Entity('inbound_mail_log')
export class InboundMailLog extends BaseEntity {
  @Index()
  @Column({ name: 'mailbox_email', type: 'varchar', length: 160 })
  mailboxEmail: string;

  @Column({ name: 'from_email', type: 'varchar', length: 160, nullable: true })
  fromEmail: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  subject: string | null;

  @Column({ name: 'imap_uid', type: 'int', nullable: true })
  imapUid: number | null;

  // Original Message-ID header, used as the de-duplication key so the worker
  // never creates duplicate tickets/documents across polling cycles.
  @Column({ name: 'message_id', type: 'varchar', length: 400, nullable: true })
  messageId: string | null;

  // destination decided: 'ticket' | 'document' | 'discard' | null (no rule).
  @Column({ type: 'varchar', length: 20, nullable: true })
  destination: string | null;

  // True when a rule matched (routed); false when no rule matched (unsorted).
  @Column({ type: 'boolean', default: false })
  routed: boolean;

  // Reference to the created entity (ticket/document id), if any.
  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId: string | null;

  @Column({ name: 'received_at', type: 'timestamptz', default: () => 'now()' })
  receivedAt: Date;
}
