import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { User } from './user.entity';
import { NotificationType } from '../common/enums';

@Entity('notifications')
@Index(['userId'])
export class Notification extends BaseEntity {
  // userId is indexed via the class-level @Index() above. Do NOT @Index() the
  // column too (would emit a duplicate CREATE INDEX during synchronize).
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'varchar', length: 40 })
  type: NotificationType;

  // Payload with contextual IDs and free text, e.g.
  // { ticketId, technicianName, message }.
  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  // When the user read it (null = unread).
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}
