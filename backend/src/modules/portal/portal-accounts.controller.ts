import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString } from 'class-validator';
import { PortalService } from './portal.service';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Bandeja de staff para los usuarios del portal que se registraron y aún no
// tienen empresa (dominio personal, o asociación pendiente). Rutas de staff:
// requieren token jwt (staff) + permiso customers:update.
class AssignOrphanDto {
  @IsString()
  customerId: string;
}

@Controller('portal-accounts')
export class PortalAccountsController {
  constructor(private readonly service: PortalService) {}

  @Get('orphans')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  orphans() {
    return this.service.orphans();
  }

  @Post('orphans/:id/assign')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  assign(@Param('id') id: string, @Body() dto: AssignOrphanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.assignOrphan(id, dto.customerId, user);
  }

  @Post('orphans/:id/reject')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  reject(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.rejectOrphan(id, user);
  }
}