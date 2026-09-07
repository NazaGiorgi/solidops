import { Column, Entity, OneToMany, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { User } from './user.entity';

@Entity('roles')
export class Role extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 60 })
  name: string;

  // Distinct permission codes assigned to this role, e.g. ['tickets:read', ...].
  @Column({ type: 'jsonb', default: [] })
  permissions: string[];

  @OneToMany(() => User, (user) => user.role)
  users: User[];
}
