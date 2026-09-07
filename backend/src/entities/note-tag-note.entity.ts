import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Note } from './note.entity';
import { NoteTag } from './note-tag.entity';

// Relación N:N entre notas y etiquetas. Tabla join explícita (con FKs y cascade)
// para que al borrar una nota o etiqueta se limpien las relaciones.
@Entity('note_tag_notes')
export class NoteTagNote {
  @PrimaryColumn({ name: 'note_id', type: 'uuid' })
  noteId: string;

  @ManyToOne(() => Note, (n) => n.tagLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'note_id' })
  note: Note;

  @PrimaryColumn({ name: 'tag_id', type: 'uuid' })
  tagId: string;

  @ManyToOne(() => NoteTag, (t) => t.noteLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag: NoteTag;
}
