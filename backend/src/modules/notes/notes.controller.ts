import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotesService } from './notes.service';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CreateNoteDto,
  UpdateNoteDto,
  CreateBoxDto,
  UpdateBoxDto,
  CreateTagDto,
  UpdateTagDto,
  ListNotesQuery,
} from './dto';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  // --- Notas ----------------------------------------------------------------

  @Get()
  @Permissions(PERMISSIONS.NOTES_READ)
  list(@Query() query: ListNotesQuery & { tags?: string }) {
    // 'tags' llega como cadena comma-separada (ej. "urgente,importante").
    const rawTags = query.tags;
    const tags = rawTags
      ? String(rawTags)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    return this.notes.list({
      boxId: query.boxId,
      search: query.search,
      customerId: query.customerId,
      ticketId: query.ticketId,
      tags,
    });
  }

  @Get('boxes')
  @Permissions(PERMISSIONS.NOTES_READ)
  boxes() {
    return this.notes.listBoxes();
  }

  @Get('tags')
  @Permissions(PERMISSIONS.NOTES_READ)
  tags() {
    return this.notes.listTags();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.NOTES_READ)
  findOne(@Param('id') id: string) {
    return this.notes.findOne(id);
  }

  @Post()
  @Permissions(PERMISSIONS.NOTES_WRITE)
  create(@Body() dto: CreateNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.create(dto, user);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateNoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.remove(id, user);
  }

  // --- Boxes (cuadernos) ----------------------------------------------------

  @Post('boxes')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  createBox(@Body() dto: CreateBoxDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.createBox(dto, user);
  }

  @Patch('boxes/:id')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  updateBox(@Param('id') id: string, @Body() dto: UpdateBoxDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.updateBox(id, dto, user);
  }

  @Delete('boxes/:id')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  removeBox(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.removeBox(id, user);
  }

  // --- Etiquetas ------------------------------------------------------------

  @Post('tags')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  createTag(@Body() dto: CreateTagDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.createTag(dto, user);
  }

  @Patch('tags/:id')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  updateTag(@Param('id') id: string, @Body() dto: UpdateTagDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.updateTag(id, dto, user);
  }

  @Delete('tags/:id')
  @Permissions(PERMISSIONS.NOTES_WRITE)
  removeTag(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notes.removeTag(id, user);
  }
}
