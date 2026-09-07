import { Body, Controller, Param, Post } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { LinkToContactDto } from './dto';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly service: CustomersService) {}

  // Vincula el número de WhatsApp de un contacto genérico "Cliente WA {n}" (que
  // llega como :id) a un contacto/cliente real ya existente (dto.contactId).
  // Reasigna los tickets del genérico al real y marca el genérico como fusionado
  // (soft-delete), todo en una transacción.
  @Post(':id/link-to')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  linkTo(
    @Param('id') id: string,
    @Body() dto: LinkToContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.linkToContact(id, dto.contactId, user);
  }
}