import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  BeforeInsert,
} from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { User } from './user.entity';
import { TechnicianLevel, TechnicianStatus } from '../common/enums';

@Entity('technicians')
export class Technician extends BaseEntity {
  // `unique: true` already creates a unique index on user_id. Adding a separate
  // @Index() here would make TypeORM emit TWO CREATE INDEX for the same column
  // during synchronize, causing "relation ... already exists". Keep only the
  // unique index (a PostgreSQL unique index also serves as a regular index).
  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @OneToOne(() => User, (user) => user.technician, {
    eager: false,
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Profile photo URL (MinIO). Nullable until uploaded.
  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  // Specialisations, e.g. ['redes', 'servidores', 'soporte-aplicaciones'].
  @Column({ type: 'jsonb', default: [] })
  specialties: string[];

  @Column({ type: 'varchar', length: 20, default: TechnicianLevel.MID })
  level: TechnicianLevel;

  // Working schedule. Same business-hours shape as Contract.business_hours.
  @Column({ type: 'jsonb', default: {} })
  schedule: Record<string, unknown>;

  // Presence/availability state, manually toggled or derived by the app.
  @Index()
  @Column({ type: 'varchar', length: 24, default: TechnicianStatus.DISPONIBLE })
  status: TechnicianStatus;

  // Optional free-text bio / notes about what this tech covers.
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // WhatsApp (solo dígitos, ej. '5491172450095') para enviar recordatorios de
  // turnos al técnico. Se guarda en el perfil de técnico (no en User) porque es
  // un dato operativo de despacho — igual que Contact.whatsapp del lado cliente.
  @Column({ name: 'whatsapp_phone', type: 'varchar', length: 40, nullable: true })
  whatsappPhone: string | null;

  @BeforeInsert()
  ensureStatus() {
    if (!this.status) this.status = TechnicianStatus.DISPONIBLE;
  }
}
