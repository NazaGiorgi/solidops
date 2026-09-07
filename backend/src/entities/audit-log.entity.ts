import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { User } from './user.entity';
import { AuditAction } from '../common/enums';

@Entity('audit_logs')
@Index(['entityType', 'entityId'])
@Index(['userId'])
@Index(['createdAt'])
export class AuditLog extends BaseEntity {
  // userId and entityType are indexed via the class-level @Index() decorators.
  // Do NOT also @Index() these columns (duplicate CREATE INDEX would fail).
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  // Snapshot of the acting user's name & role for auditability even if deleted.
  @Column({ name: 'user_email', type: 'varchar', length: 160, nullable: true })
  userEmail: string | null;

  @Column({ type: 'varchar', length: 40 })
  action: AuditAction;

  @Column({ name: 'entity_type', type: 'varchar', length: 40 })
  entityType: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue: Record<string, unknown> | null;

  // Extra context (route, request id, etc.).
  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;
}
