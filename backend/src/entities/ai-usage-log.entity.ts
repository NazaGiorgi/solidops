import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// Registro de uso de IA. NUNCA guarda prompts ni respuestas: sólo métricas.
// createdAt (de BaseEntity) es la "fecha" del evento.
@Entity('ai_usage_log')
@Index(['createdAt'])
@Index(['userId'])
@Index(['feature'])
export class AiUsageLog extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ type: 'varchar', length: 60 })
  feature: string;

  @Column({ type: 'varchar', length: 20 })
  provider: string;

  @Column({ type: 'varchar', length: 120 })
  model: string;

  @Column({ name: 'tokens_in', type: 'int', default: 0 })
  tokensIn: number;

  @Column({ name: 'tokens_out', type: 'int', default: 0 })
  tokensOut: number;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @Column({
    name: 'tokens_per_second',
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
  })
  tokensPerSecond: number | null;

  @Column({ type: 'boolean', default: true })
  ok: boolean;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;
}
