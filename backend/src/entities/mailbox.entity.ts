import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// An email account the platform reads from (IMAP) / optionally sends from (SMTP).
// Passwords are stored ENCRYPTED (CryptoService) and never returned in plain text.
@Entity('mailboxes')
export class Mailbox extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160 })
  email: string;

  @Column({ name: 'imap_host', type: 'varchar', length: 255 })
  imapHost: string;

  @Column({ name: 'imap_port', type: 'int' })
  imapPort: number;

  @Column({ name: 'imap_user', type: 'varchar', length: 255 })
  imapUser: string;

  // Encrypted (AES-256-GCM) via CryptoService. Never returned by the API.
  @Column({ name: 'imap_password', type: 'text' })
  imapPassword: string;

  @Column({ name: 'imap_ssl', type: 'boolean', default: true })
  imapSsl: boolean;

  @Column({ name: 'smtp_host', type: 'varchar', length: 255, nullable: true })
  smtpHost: string | null;

  @Column({ name: 'smtp_port', type: 'int', nullable: true })
  smtpPort: number | null;

  @Column({ name: 'smtp_user', type: 'varchar', length: 255, nullable: true })
  smtpUser: string | null;

  @Column({ name: 'smtp_password', type: 'text', nullable: true })
  smtpPassword: string | null;

  // SMTP transport security. 'implicit' = SSL/TLS from connect (465);
  // 'starttls' = plain then STARTTLS upgrade (587). Distinct from IMAP's
  // imapSsl boolean because the two protocols negotiate TLS differently.
  @Column({ name: 'smtp_security', type: 'varchar', length: 12, nullable: true })
  smtpSecurity: string | null;

  @Column({ name: 'smtp_ssl', type: 'boolean', default: true })
  smtpSsl: boolean;

  // Keep a copy of the mail on the server after reading.
  @Column({ name: 'keep_on_server', type: 'boolean', default: true })
  keepOnServer: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Shadow mode = read-only observation: the platform reads but never marks as
  // read/seen, never deletes, never auto-replies. Used while Zammad still owns
  // the mailbox. Disabling shadow mode switches to real processing.
  @Column({ name: 'shadow_mode', type: 'boolean', default: false })
  shadowMode: boolean;

  // Catch-all destination for emails that match NO specific rule: where they go
  // by default. Editable from the UI (default '' = legacy 'ticket' behavior).
  @Column({ name: 'default_destination', type: 'varchar', length: 20, default: '' })
  defaultDestination: string;

  // UID-tracking sync state: the sync does NOT depend on the \Seen flag (so
  // SolidOps and Zammad can both read the same mailbox). We record the last UID
  // processed and the UIDVALIDITY it was valid under; if UIDVALIDITY changes the
  // mailbox was re-indexed, so the cursor is reset from a cutoff date.
  @Column({ name: 'last_processed_uid', type: 'int', nullable: true })
  lastProcessedUid: number | null;

  @Column({ name: 'sync_uid_validity', type: 'bigint', nullable: true })
  syncUidValidity: string | null;

  @Column({ name: 'last_checked_at', type: 'timestamptz', nullable: true })
  lastCheckedAt: Date | null;

  // Message of the last connection error, for the UI. Null when healthy.
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;
}
