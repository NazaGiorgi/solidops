import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { WorkshopService } from './workshop.service';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  CreateWorkshopEquipmentDto,
  UpdateWorkshopEquipmentDto,
  SetWorkshopEquipmentStatusDto,
  CreatePriceListItemDto,
  UpdatePriceListItemDto,
  CreateWorkshopQuoteDto,
} from './dto';

@Controller('workshop')
export class WorkshopController {
  constructor(private readonly service: WorkshopService) {}

  // --- Equipos --------------------------------------------------------------

  @Get('equipments')
  @Permissions(PERMISSIONS.WORKSHOP_READ)
  list(@Query('customerId') customerId?: string, @Query('status') status?: string, @Query('search') search?: string) {
    return this.service.list({ customerId, status, search });
  }

  @Post('equipments')
  @Permissions(PERMISSIONS.WORKSHOP_WRITE)
  create(@Body() dto: CreateWorkshopEquipmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createEquipment(dto, user);
  }

  @Get('equipments/:id')
  @Permissions(PERMISSIONS.WORKSHOP_READ)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch('equipments/:id')
  @Permissions(PERMISSIONS.WORKSHOP_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateWorkshopEquipmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateEquipment(id, dto, user);
  }

  @Post('equipments/:id/status')
  @Permissions(PERMISSIONS.WORKSHOP_WRITE)
  status(@Param('id') id: string, @Body() dto: SetWorkshopEquipmentStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.setStatus(id, dto.status, user);
  }

  @Get('equipments/:id/reception.pdf')
  @Permissions(PERMISSIONS.WORKSHOP_READ)
  async receptionPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename, mime } = await this.service.receptionPdf(id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  // --- Presupuestos ---------------------------------------------------------

  @Get('equipments/:id/quotes')
  @Permissions(PERMISSIONS.WORKSHOP_READ)
  quotes(@Param('id') id: string) {
    return this.service.listQuotes(id);
  }

  @Post('equipments/:id/quotes')
  @Permissions(PERMISSIONS.WORKSHOP_QUOTES)
  createQuote(@Param('id') id: string, @Body() dto: CreateWorkshopQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createQuote(id, dto, user);
  }

  @Post('equipments/:id/quotes/:quoteId/send')
  @Permissions(PERMISSIONS.WORKSHOP_QUOTES)
  sendQuote(@Param('id') id: string, @Param('quoteId') quoteId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.sendQuote(id, quoteId, user);
  }

  @Post('equipments/:id/quotes/:quoteId/respond')
  @Permissions(PERMISSIONS.WORKSHOP_QUOTES)
  respond(
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Body() body: { decision: 'aprobado' | 'rechazado' },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.respondQuote(id, quoteId, body.decision, user);
  }

  @Get('equipments/:id/quotes/:quoteId.pdf')
  @Permissions(PERMISSIONS.WORKSHOP_READ)
  async quotePdf(@Param('id') id: string, @Param('quoteId') quoteId: string, @Res() res: Response) {
    const { buffer, filename, mime } = await this.service.quotePdf(id, quoteId);
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  // --- Catálogo de precios --------------------------------------------------

  @Get('catalog')
  @Permissions(PERMISSIONS.WORKSHOP_READ)
  catalog(@Query('onlyActive') onlyActive?: string) {
    return this.service.listCatalog(onlyActive === 'true');
  }

  @Post('catalog')
  @Permissions(PERMISSIONS.WORKSHOP_CATALOG)
  createCatalog(@Body() dto: CreatePriceListItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createCatalogItem(dto, user);
  }

  @Patch('catalog/:id')
  @Permissions(PERMISSIONS.WORKSHOP_CATALOG)
  updateCatalog(@Param('id') id: string, @Body() dto: UpdatePriceListItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateCatalogItem(id, dto, user);
  }
}
