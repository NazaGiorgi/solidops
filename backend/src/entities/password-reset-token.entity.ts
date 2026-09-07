import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// One-time password reset token. Only a SHA-256 hash is persisted (same rule as
// passwords); the raw token travels only in the reset email. `usedAt` marks the
// token as consumed so it can never be reused (single-use + short expiry).
export type ResetTokenOwnerType = 'user' | 'contact';

@Entity('password_reset_tokens')
@Index(['ownerType', 'ownerId'])
@Index(['expiresAt'])
export class PasswordResetToken extends BaseEntity {
  // 'user' = staff portal-independent account, 'contact' = client portal.
  @Column({ name: 'owner_type', type: 'varchar', length: 16 })
  ownerType: ResetTokenOwnerType;

  // Id of the owning account (User or Contact). Polymorphic, no FK.
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  // SHA-256 hex of the raw token. Never the token itself.
  // unique via the @Index(unique) below (a unique index IS the constraint).
  @Index({ unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  // expiresAt is indexed via the class-level @Index(['expiresAt']).
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
