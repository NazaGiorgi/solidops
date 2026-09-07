import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Customer } from './customer.entity';
import { Site } from './site.entity';

// Minimal Asset entity — just enough for the email-routing `document` destination
// to associate an inbound email's subject with a known piece of equipment
// (e.g. a router name). Not the full asset-management module (Fase 2+).
@Entity('assets')
export class Asset extends BaseEntity {
  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Index()
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  @ManyToOne(() => Site, { nullable: true })
  @JoinColumn({ name: 'site_id' })
  site: Site | null;

  @Column({ type: 'varchar', length: 180 })
  name: string;

  @Column({ type: 'varchar', length: 60, nullable: true })
  type: string | null;
}
