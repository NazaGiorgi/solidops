import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { NoteTagNote } from './note-tag-note.entity';

// Etiqueta de nota (catálogo). Una nota puede tener varias etiquetas, y una
// etiqueta puede estar en varias notas.
@Entity('note_tags')
export class NoteTag extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @OneToMany(() => NoteTagNote, (rel) => rel.tag)
  noteLinks: NoteTagNote[];
}
