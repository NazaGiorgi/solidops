import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Customer } from './customer.entity';
import { Ticket } from './ticket.entity';
import { User } from './user.entity';
import { NoteBox } from './note-box.entity';
import { NoteTagNote } from './note-tag-note.entity';

// Nota tipo Evernote: información libre de los técnicos, compartida por todo el
// equipo (no privada por usuario). Organización doble: un "box" (cuaderno, una
// nota va en un solo box) + etiquetas (N a una nota, filtra transversalmente).
// El vínculo a Customer/Ticket es OPCIONAL: una nota puede existir totalmente
// suelta (sin box, sin cliente, sin ticket).
@Entity('notes')
export class Note extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  title: string;

  // Contenido en Markdown (se guarda el código crudo; se renderiza en el front).
  @Column({ type: 'text', default: '' })
  body: string;

  // Cuaderno (opcional). Una nota va en un solo box.
  @Index()
  @Column({ name: 'box_id', type: 'uuid', nullable: true })
  boxId: string | null;

  @ManyToOne(() => NoteBox, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'box_id' })
  box: NoteBox | null;

  // Vínculo opcional a un cliente.
  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  // Vínculo opcional a un ticket.
  @Index()
  @Column({ name: 'ticket_id', type: 'uuid', nullable: true })
  ticketId: string | null;

  @ManyToOne(() => Ticket, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser: User | null;

  // Quién editó por última vez (se actualiza en cada update).
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedByUser: User | null;

  // Full Text Search (tsvector) sobre title + body, mantenido por trigger.
  @Column({ name: 'search_vector', type: 'tsvector', nullable: true, select: false })
  searchVector: unknown;

  @OneToMany(() => NoteTagNote, (rel) => rel.note, { cascade: true })
  tagLinks: NoteTagNote[];
}
