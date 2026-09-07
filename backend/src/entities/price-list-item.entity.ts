import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// Catálogo de ítems/servicios con precio, administrado por SolidoCS (no se
// cargan precios libres al armar un presupuesto). Un ítem puede ser mano de
// obra o material/repuesto, con precio unitario.
@Entity('price_list_items')
export class PriceListItem extends BaseEntity {
  @Index()
  @Column({ type: 'varchar', length: 220 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Mano de obra vs material/repuesto (agrupación visual en el presupuesto).
  @Column({ name: 'is_labor', type: 'boolean', default: false })
  isLabor: boolean;

  // Precio unitario en ARS. Se usa DECIMAL para evitar errores de punto flotante.
  @Index()
  @Column({ name: 'price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  price: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
