import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { TicketsService } from './tickets.service';
import { TicketMergeService } from './ticket-merge.service';
import { SavedViewsService } from './saved-views.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  AddMessageDto,
  AssignTicketDto,
  BulkMoveTicketsDto,
  BulkDeleteTicketsDto,
  BulkChangeStatusTicketsDto,
  ListTicketsQuery,
} from './dto';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { IsArray, IsUUID } from 'class-validator';

class MergeDto {
  @IsArray()
  @IsUUID('4', { each: true })
  childIds: string[];
}

class ClosePrincipalDto {
  @IsArray()
  @IsUUID('4', { each: true })
  closeChildrenIds: string[];
}

@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly service: TicketsService,
    private readonly merge: TicketMergeService,
    private readonly savedViews: SavedViewsService,
  ) {}

  @Get()
  @Permissions(PERMISSIONS.TICKETS_READ)
  findAll(
    @Query() query: ListTicketsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(query, user);
  }

  @Get('attention-count')
  @Permissions(PERMISSIONS.TICKETS_READ)
  attentionCounts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.attentionCounts(user);
  }

  @Get('groups')
  @Permissions(PERMISSIONS.TICKETS_READ)
  groups(@CurrentUser() user: AuthenticatedUser) {
    return this.service.groupCounts(user);
  }

  @Get('views')
  @Permissions(PERMISSIONS.TICKETS_READ)
  views(@CurrentUser() user: AuthenticatedUser) {
    return this.savedViews.list(user);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.TICKETS_READ)
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @Permissions(PERMISSIONS.TICKETS_CREATE)
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch('bulk-move')
  @Permissions(PERMISSIONS.TICKETS_UPDATE)
  bulkMove(@Body() dto: BulkMoveTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.bulkMove(dto.ticketIds, dto.groupId, user);
  }

  // Borrado lógico (soft delete) de tickets spam/error: solo marca `deleted_at`,
  // mismo permiso que las demás acciones masivas del listado (bulk-move).
  @Delete('bulk-delete')
  @Permissions(PERMISSIONS.TICKETS_UPDATE)
  bulkDelete(@Body() dto: BulkDeleteTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.bulkSoftDelete(dto.ticketIds, user);
  }

  @Patch('bulk-status')
  @Permissions(PERMISSIONS.TICKETS_UPDATE)
  bulkChangeStatus(@Body() dto: BulkChangeStatusTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.bulkChangeStatus(dto.ticketIds, dto.status, user);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.TICKETS_UPDATE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/assign')
  @Permissions(PERMISSIONS.TICKETS_ASSIGN)
  assign(
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.assign(id, dto, user);
  }

  @Post(':id/messages')
  @Permissions(PERMISSIONS.TICKETS_UPDATE)
  addMessage(
    @Param('id') id: string,
    @Body() dto: AddMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addMessage(id, dto, user);
  }

  @Post('messages/:messageId/attachments')
  @Permissions(PERMISSIONS.TICKETS_UPDATE)
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Param('messageId') messageId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadAttachment(messageId, file);
  }

  // Descarga de un adjunto (imagen inline o attachment) servida por el backend
  // desde MinIO. Requiere autenticación (guard global).
  @Get('attachments/:attachmentId/download')
  @Permissions(PERMISSIONS.TICKETS_READ)
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    try {
      const { buffer, filename, mimeType } = await this.service.downloadAttachment(attachmentId);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename || 'adjunto')}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (e) {
      res.status(404).json({ message: (e as Error).message, ok: false });
    }
  }

  // --- P3: ticket merging (Supervisor/Coordinator only) ---
  @Post(':id/merge')
  @Permissions(PERMISSIONS.TICKETS_ASSIGN, { message: 'No tenés permiso para fusionar tickets' })
  mergeTickets(@Param('id') id: string, @Body() dto: MergeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.merge.merge(id, dto.childIds, user);
  }

  @Post(':id/merge/dissolve')
  @Permissions(PERMISSIONS.TICKETS_ASSIGN)
  dissolve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.merge.dissolve(id, user);
  }

  @Post(':id/merge/close')
  @Permissions(PERMISSIONS.TICKETS_ASSIGN)
  closePrincipal(
    @Param('id') id: string,
    @Body() dto: ClosePrincipalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.merge.closePrincipal(id, dto.closeChildrenIds, user);
  }

  @Get(':id/merge/children')
  @Permissions(PERMISSIONS.TICKETS_READ)
  children(@Param('id') id: string) {
    return this.merge.mergedChildren(id);
  }
}
