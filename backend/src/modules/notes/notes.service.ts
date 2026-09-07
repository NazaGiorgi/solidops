import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { Note } from '../../entities/note.entity';
import { NoteBox } from '../../entities/note-box.entity';
import { NoteTag } from '../../entities/note-tag.entity';
import { NoteTagNote } from '../../entities/note-tag-note.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { CreateNoteDto, CreateBoxDto, CreateTagDto } from './dto';

@Injectable()
export class NotesService implements OnModuleInit {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(Note) private readonly notes: Repository<Note>,
    @InjectRepository(NoteBox) private readonly boxes: Repository<NoteBox>,
    @InjectRepository(NoteTag) private readonly tags: Repository<NoteTag>,
    @InjectRepository(NoteTagNote) private readonly tagLinks: Repository<NoteTagNote>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // FTS de notas: crea search_vector (tsvector) + GIN index + trigger sobre
  // title/body una vez al arrancar (synchronize no emite tsvector/GIN de forma
  // fiable). Mismo patrón que el módulo de documentos.
  async onModuleInit() {
    try {
      await this.dataSource.query(
        `ALTER TABLE notes ADD COLUMN IF NOT EXISTS search_vector tsvector`,
      );
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_note_search_gin ON notes USING GIN (search_vector)`,
      );
      await this.dataSource.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notes_search_vector') THEN
            CREATE TRIGGER notes_search_vector
            BEFORE INSERT OR UPDATE OF title, body ON notes
            FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger('search_vector', 'pg_catalog.spanish', 'title', 'body');
          END IF;
        END$$
      `);
      this.logger.log('FTS index/trigger de notas listos');
    } catch (e) {
      this.logger.warn(`FTS init de notas falló (no bloquea): ${(e as Error).message}`);
    }
  }

  // --- Notas: CRUD ----------------------------------------------------------

  async list(
    filters: { boxId?: string; tags?: string[]; search?: string; customerId?: string; ticketId?: string },
  ): Promise<Note[]> {
    const qb = this.notes
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.box', 'box')
      .leftJoinAndSelect('n.customer', 'customer')
      .leftJoinAndSelect('n.ticket', 'ticket')
      .leftJoinAndSelect('n.tagLinks', 'tl')
      .leftJoinAndSelect('tl.tag', 'tag')
      .leftJoinAndSelect('n.createdByUser', 'createdByUser')
      .leftJoinAndSelect('n.updatedByUser', 'updatedByUser');

    if (filters.boxId) qb.andWhere('n.box_id = :boxId', { boxId: filters.boxId });
    if (filters.customerId) qb.andWhere('n.customer_id = :customerId', { customerId: filters.customerId });
    if (filters.ticketId) qb.andWhere('n.ticket_id = :ticketId', { ticketId: filters.ticketId });
    if (filters.search) {
      qb.andWhere(
        `(n.search_vector @@ websearch_to_tsquery('spanish', :q) OR n.title ILIKE :ilike OR n.body ILIKE :ilike)`,
        { q: filters.search, ilike: `%${filters.search}%` },
      );
    }
    // Filtro por etiquetas: la nota debe tener TODAS las etiquetas pedidas (AND).
    // Se resuelve por nombre (más natural en la UI) contra la tabla join.
    if (filters.tags?.length) {
      const names = filters.tags.filter((t) => !isUUID(t));
      const ids = filters.tags.filter((t) => isUUID(t));
      const conds: string[] = [];
      const params: Record<string, unknown> = {};
      names.forEach((name, i) => {
        conds.push(`EXISTS (SELECT 1 FROM note_tag_notes ntn_${i} JOIN note_tags nt_${i} ON nt_${i}.id = ntn_${i}.tag_id WHERE ntn_${i}.note_id = n.id AND nt_${i}.name = :tagName_${i})`);
        params[`tagName_${i}`] = name;
      });
      ids.forEach((id, i) => {
        const j = names.length + i;
        conds.push(`EXISTS (SELECT 1 FROM note_tag_notes ntn_${j} WHERE ntn_${j}.note_id = n.id AND ntn_${j}.tag_id = :tagId_${j})`);
        params[`tagId_${j}`] = id;
      });
      if (conds.length) qb.andWhere(`(${conds.join(' AND ')})`, params);
    }

    return qb.orderBy('n.updatedAt', 'DESC').getMany();
  }

  async findOne(id: string): Promise<Note> {
    const note = await this.notes.findOne({
      where: { id },
      relations: ['box', 'customer', 'ticket', 'tagLinks', 'tagLinks.tag', 'createdByUser', 'updatedByUser'],
    });
    if (!note) throw new NotFoundException('Nota no encontrada');
    return note;
  }

  async create(dto: CreateNoteDto, actor: AuthenticatedUser): Promise<Note> {
    const note = this.notes.create({
      title: dto.title,
      body: dto.body ?? '',
      boxId: dto.boxId ?? null,
      customerId: dto.customerId ?? null,
      ticketId: dto.ticketId ?? null,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
    });
    const saved = await this.notes.save(note);

    if (dto.tags?.length) await this.setTags(saved.id, dto.tags);

    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.NOTE,
      entityId: saved.id,
      newValue: { title: saved.title, boxId: saved.boxId, customerId: saved.customerId, ticketId: saved.ticketId },
    });

    return this.findOne(saved.id);
  }

  async update(id: string, dto: Partial<CreateNoteDto>, actor: AuthenticatedUser): Promise<Note> {
    const note = await this.notes.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Nota no encontrada');

    const old = { title: note.title, body: note.body, boxId: note.boxId, customerId: note.customerId, ticketId: note.ticketId };

    if (dto.title !== undefined) note.title = dto.title;
    if (dto.body !== undefined) note.body = dto.body;
    if (dto.boxId !== undefined) note.boxId = dto.boxId;
    if (dto.customerId !== undefined) note.customerId = dto.customerId;
    if (dto.ticketId !== undefined) note.ticketId = dto.ticketId;
    note.updatedByUserId = actor.id;
    const saved = await this.notes.save(note);

    if (dto.tags !== undefined) await this.setTags(id, dto.tags ?? []);

    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.NOTE,
      entityId: id,
      oldValue: old,
      newValue: { title: saved.title, boxId: saved.boxId, customerId: saved.customerId, ticketId: saved.ticketId },
    });

    return this.findOne(id);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<{ ok: true }> {
    const note = await this.notes.findOne({ where: { id } });
    if (!note) throw new NotFoundException('Nota no encontrada');
    await this.notes.remove(note);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.NOTE,
      entityId: id,
      newValue: { title: note.title },
    });
    return { ok: true };
  }

  // Reemplaza el conjunto de etiquetas de una nota por las indicadas (por nombre,
  // se crean si no existen). Limpia las relaciones previas.
  private async setTags(noteId: string, tagNames: string[]) {
    await this.tagLinks.delete({ noteId });
    const unique = Array.from(new Set(tagNames.map((t) => t.trim()).filter(Boolean)));
    for (const name of unique) {
      let tag = await this.tags.findOne({ where: { name } });
      if (!tag) {
        tag = await this.tags.save(this.tags.create({ name }));
        await this.audit.log({
          user: null,
          action: AuditAction.CREATE,
          entityType: AuditEntityType.NOTE_TAG,
          entityId: tag.id,
          newValue: { name: tag.name },
        });
      }
      await this.tagLinks.save(
        this.tagLinks.create({ noteId, tagId: tag.id }),
      );
    }
  }

  // --- Boxes (cuadernos) ----------------------------------------------------

  async listBoxes(): Promise<Array<NoteBox & { noteCount: number }>> {
    const boxes = await this.boxes.find({ order: { orderIndex: 'ASC', name: 'ASC' } });
    const rows = await this.notes
      .createQueryBuilder('n')
      .select('n.box_id', 'boxId')
      .addSelect('COUNT(*)', 'cnt')
      .where('n.box_id IS NOT NULL')
      .groupBy('n.box_id')
      .getRawMany<{ boxId: string; cnt: string }>();
    const count = new Map(rows.map((r) => [r.boxId, Number(r.cnt)]));
    return boxes.map((b) => ({ ...b, noteCount: count.get(b.id) ?? 0 }));
  }

  async createBox(dto: CreateBoxDto, actor: AuthenticatedUser): Promise<NoteBox> {
    const box = this.boxes.create({ name: dto.name.trim(), orderIndex: dto.orderIndex ?? 0 });
    const saved = await this.boxes.save(box);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.NOTE_BOX,
      entityId: saved.id,
      newValue: { name: saved.name },
    });
    return saved;
  }

  async updateBox(id: string, dto: Partial<CreateBoxDto>, actor: AuthenticatedUser): Promise<NoteBox> {
    const box = await this.boxes.findOne({ where: { id } });
    if (!box) throw new NotFoundException('Box no encontrado');
    if (dto.name !== undefined) box.name = dto.name.trim();
    if (dto.orderIndex !== undefined) box.orderIndex = dto.orderIndex;
    const saved = await this.boxes.save(box);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.NOTE_BOX,
      entityId: id,
      newValue: { name: saved.name, orderIndex: saved.orderIndex },
    });
    return saved;
  }

  async removeBox(id: string, actor: AuthenticatedUser): Promise<{ ok: true }> {
    const box = await this.boxes.findOne({ where: { id } });
    if (!box) throw new NotFoundException('Box no encontrado');
    // Las notas que apuntaban a este box quedan sueltas (ON DELETE SET NULL en la FK).
    await this.boxes.remove(box);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.NOTE_BOX,
      entityId: id,
    });
    return { ok: true };
  }

  // --- Etiquetas ------------------------------------------------------------

  async listTags(): Promise<Array<NoteTag & { noteCount: number }>> {
    const tags = await this.tags.find({ order: { name: 'ASC' } });
    const rows = await this.notes
      .createQueryBuilder('n')
      .select('n.id')
      .getMany();
    const linkRows = await this.tagLinks
      .createQueryBuilder('l')
      .select('l.tag_id', 'tagId')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('l.tag_id')
      .getRawMany<{ tagId: string; cnt: string }>();
    const count = new Map(linkRows.map((r) => [r.tagId, Number(r.cnt)]));
    void rows;
    return tags.map((t) => ({ ...t, noteCount: count.get(t.id) ?? 0 }));
  }

  async createTag(dto: CreateTagDto, actor: AuthenticatedUser): Promise<NoteTag> {
    const name = dto.name.trim();
    const exists = await this.tags.findOne({ where: { name } });
    if (exists) throw new ConflictException('La etiqueta ya existe');
    const tag = await this.tags.save(this.tags.create({ name }));
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.NOTE_TAG,
      entityId: tag.id,
      newValue: { name: tag.name },
    });
    return tag;
  }

  async updateTag(id: string, dto: Partial<CreateTagDto>, actor: AuthenticatedUser): Promise<NoteTag> {
    const tag = await this.tags.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Etiqueta no encontrada');
    if (dto.name !== undefined) tag.name = dto.name.trim();
    const saved = await this.tags.save(tag);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.NOTE_TAG,
      entityId: id,
      newValue: { name: saved.name },
    });
    return saved;
  }

  async removeTag(id: string, actor: AuthenticatedUser): Promise<{ ok: true }> {
    const tag = await this.tags.findOne({ where: { id } });
    if (!tag) throw new NotFoundException('Etiqueta no encontrada');
    await this.tagLinks.delete({ tagId: id });
    await this.tags.remove(tag);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.NOTE_TAG,
      entityId: id,
    });
    return { ok: true };
  }
}

function isUUID(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
