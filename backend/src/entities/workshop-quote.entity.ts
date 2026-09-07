import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { WorkshopEquipment } from './workshop-equipment.entity';
import { User } from './user.entity';
import { WorkshopQuoteStatus } from '../common/enums';

// Presupuesto para la reparación de un equipo de taller. El técnico lo arma
// seleccionando ítems del catálogo (PriceListItem); el estado lo aprueba o
// rechaza el cliente desde el portal. No se puede pasar a "En reparación" sin
// un presupuesto aprobado (validación dura).
@Entity('workshop_quotes')
export class WorkshopQuote extends BaseEntity {
  @Index()
  @Column({ name: 'equipment_id', type: 'uuid' })
  equipmentId: string;

  @ManyToOne(() => WorkshopEquipment, { nullable: false })
  @JoinColumn({ name: 'equipment_id' })
  equipment: WorkshopEquipment;

  @Index()
  @Column({ type: 'varchar', length: 12, default: WorkshopQuoteStatus.PENDIENTE })
  status: WorkshopQuoteStatus;

  @Column({ name: 'number', type: 'varchar', length: 40 })
  number: string;

  // Texto/imagen descriptiva opcional del trabajo (por qué se cobra).
  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'subtotal', type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: string;

  @Column({ name: 'total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: string;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'responded_at', type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ name: 'responded_by_id', type: 'uuid', nullable: true })
  respondedById: string | null;
}
