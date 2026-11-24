import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ReplyDraftDto } from './ai-tickets.dto';
import { AiTicketsService } from './ai-tickets.service';

// Controlador separado del Laboratorio: AiController tiene @Roles(Administrador)
// a nivel de clase y acá deben entrar también Supervisor, Coordinador y Técnico.
@Controller('ai/tickets')
@UseGuards(RolesGuard)
@Permissions(PERMISSIONS.AI_TICKET, {
  message: 'No tenés permiso para usar el asistente IA en tickets',
})
export class AiTicketsController {
  constructor(private readonly asistente: AiTicketsService) {}

  private asegurarAcceso(user: AuthenticatedUser): void {
    this.asistente.ensureTicketsEnabled();
    // @Permissions es OR: requerimos además el permiso de ver tickets, que es
    // lo que habilita TicketsController.GET :id y su scope por cliente/creador.
    if (!user.permissions?.includes(PERMISSIONS.TICKETS_READ)) {
      throw new ForbiddenException('No tenés permiso para ver tickets');
    }
  }

  @Post(':id/summary')
  summary(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.asegurarAcceso(user);
    return this.asistente.summary(id, user);
  }

  @Post(':id/classify')
  classify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.asegurarAcceso(user);
    return this.asistente.classify(id, user);
  }

  @Post(':id/reply-draft')
  replyDraft(
    @Param('id') id: string,
    @Body() dto: ReplyDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.asegurarAcceso(user);
    return this.asistente.reply(id, user, { tono: dto.tono, borrador: dto.borrador });
  }

  @Get(':id/related')
  related(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.asegurarAcceso(user);
    return this.asistente.related(id, user);
  }

  // IA 04. Sólo propone pasos citando tickets cerrados: no guarda ni envía.
  @Post(':id/solution')
  solution(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    this.asegurarAcceso(user);
    return this.asistente.solution(id, user);
  }
}
