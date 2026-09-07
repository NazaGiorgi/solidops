import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { TicketGroupsService } from './ticket-groups.service';
import { CreateTicketGroupDto, UpdateTicketGroupDto, DeactivateTicketGroupDto } from './ticket-groups.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { RoleName } from '../../common/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Catálogo de "boxes" (grupos de tickets).
// - Leer (GET): cualquier usuario con tickets:read (el sidebar/catálogo lo
//   necesita, y el menú lateral lo ven todos los que operan tickets).
// - Mutar (POST/PATCH/DELETE): solo Admin/Supervisor (acceso al Panel de Admin).
@Controller('ticket-groups')
export class TicketGroupsController {
  constructor(private readonly service: TicketGroupsService) {}

  @Get()
  @Permissions(PERMISSIONS.TICKETS_READ)
  list() {
    return this.service.listWithCounts();
  }

  @Get(':id')
  @Permissions(PERMISSIONS.TICKETS_READ)
  findOne(@Param('id') id: string) {
    return this.service.findOneWithCounts(id);
  }

  @Post()
  @Roles(RoleName.ADMINISTRADOR, RoleName.SUPERVISOR)
  create(@Body() dto: CreateTicketGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @Roles(RoleName.ADMINISTRADOR, RoleName.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: UpdateTicketGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @Roles(RoleName.ADMINISTRADOR, RoleName.SUPERVISOR)
  deactivate(@Param('id') id: string, @Body() dto: DeactivateTicketGroupDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deactivate(id, dto, user);
  }
}
