import { DeleteDateColumn, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

// Soft-delete entity for tables where operating history must never be
// physically erased (Ticket, Customer, Contact).
// Adds a `deleted_at` column used by TypeORM's `@DeleteDateColumn` soft-delete.
export abstract class SoftDeleteEntity extends BaseEntity {
  @Index()
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
