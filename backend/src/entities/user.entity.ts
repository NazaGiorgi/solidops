import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  RelationId,
} from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Role } from './role.entity';
import { Technician } from './technician.entity';

@Entity('users')
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 160 })
  email: string;

  // bcrypt hash of the current password. For accounts migrated from Zammad this
  // stays NULL until the first successful login (lazy Argon2->bcrypt migration),
  // at which point it is generated and legacy_argon2_hash is cleared.
  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  // Original Zammad Argon2id hash, kept until the user logs in successfully for
  // the first time (lazy migration to bcrypt). Null once migrated or if native.
  @Column({ name: 'legacy_argon2_hash', type: 'text', nullable: true, select: false })
  legacyArgon2Hash: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Index()
  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, (role) => role.users, { eager: true })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  // A user optionally maps 1:1 to a Technician profile (technicians are users
  // with a working profile). Admin/supervisor/consulta users won't have one.
  // In TypeORM the inverse side of a relation is expressed by passing the
  // inverse mapping function as the second decorator argument; the owning side
  // (Technician) holds the @JoinColumn on user_id. No `mappedBy` option exists.
  @OneToOne(() => Technician, (technician) => technician.user, {
    nullable: true,
  })
  technician: Technician | null;

  @RelationId((usr: User) => usr.technician)
  technicianId: string | null;
}
