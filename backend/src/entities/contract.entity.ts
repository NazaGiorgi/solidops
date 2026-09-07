import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Customer } from './customer.entity';
import { BusinessHours } from '../common/utils/business-hours.util';

@Entity('contracts')
export class Contract extends BaseEntity {
  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.contracts)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  // Base SLA targets (used when the priority_tier doesn't override).
  @Column({ name: 'sla_first_response_minutes', type: 'int', default: 60 })
  slaFirstResponseMinutes: number;

  @Column({ name: 'sla_resolution_hours', type: 'int', default: 8 })
  slaResolutionHours: number;

  // Working coverage schedule.
  // { mon:[{start:'09:00',end:'18:00'}], ... }
  @Column({ name: 'business_hours', type: 'jsonb', default: {} })
  businessHours: BusinessHours;

  // Optional per-priority overrides of SLA targets.
  // {
  //   "baja":   {"first_response_minutes": 120, "resolution_hours": 24},
  //   "critica":{"first_response_minutes": 15,  "resolution_hours": 1}
  // }
  @Column({ name: 'priority_tier', type: 'jsonb', default: {} })
  priorityTier: Record<
    string,
    { first_response_minutes: number; resolution_hours: number }
  >;

  // Descriptive label, e.g. 'Básico', 'Premium'.
  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;
}
