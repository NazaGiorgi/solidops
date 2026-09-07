import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { WorkshopQuote } from './workshop-quote.entity';

// Línea de un presupuesto: referencia al ítem del catálogo, con snapshot de
// nombre y precio unitario (para que el documento no cambie si el catálogo se
// edita después), cantidad y total de línea.
@Entity('workshop_quote_items')
export class WorkshopQuoteItem extends BaseEntity {
  @Index()
  @Column({ name: 'quote_id', type: 'uuid' })
  quoteId: string;

  @ManyToOne(() => WorkshopQuote, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'quote_id' })
  quote: WorkshopQuote;

  @Column({ name: 'price_list_item_id', type: 'uuid', nullable: true })
  priceListItemId: string | null;

  @Column({ type: 'varchar', length: 220 })
  name: string;

  @Column({ name: 'is_labor', type: 'boolean', default: false })
  isLabor: boolean;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2, default: 0 })
  unitPrice: string;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 12, scale: 2, default: 0 })
  lineTotal: string;
}
