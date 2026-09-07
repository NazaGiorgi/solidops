import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Note } from '../../entities/note.entity';
import { NoteBox } from '../../entities/note-box.entity';
import { NoteTag } from '../../entities/note-tag.entity';
import { NoteTagNote } from '../../entities/note-tag-note.entity';
import { NotesService } from './notes.service';
import { NotesController } from './notes.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Note, NoteBox, NoteTag, NoteTagNote])],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
