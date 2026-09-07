import { Column, Entity, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Note } from './note.entity';

// Cuaderno de notas (carpeta). Una nota va en un solo box. Lista plana (sin
// boxes anidados) — decisión confirmada por el usuario.
@Entity('note_boxes')
export class NoteBox extends BaseEntity {
  @Column({ type: 'varchar', length: 120 })
  name: string;

  // Orden de visualización en el panel lateral de boxes.
  @Column({ name: 'order_index', type: 'int', default: 0 })
  orderIndex: number;

  @OneToMany(() => Note, (n) => n.box)
  notes: Note[];
}
