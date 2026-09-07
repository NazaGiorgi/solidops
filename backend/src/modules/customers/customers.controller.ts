import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CreateContactDto,
  UpdateContactDto,
  UpdateContactPortalDto,
  SetContactPortalPasswordDto,
  CreateSiteDto,
  UpdateSiteDto,
  CreateContractDto,
  UpdateContractDto,
} from './dto';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

@Controller('customers')
export class CustomersController {
  constructor(private readonly service: CustomersService) {}

  @Get()
  @Permissions(PERMISSIONS.CUSTOMERS_READ)
  findAll(@Query('search') search?: string) {
    return this.service.findAllCustomers(search);
  }

  // Antes de @Get(':id') para que 'suggest-by-domain' no se interprete como id.
  @Get('suggest-by-domain')
  @Permissions(PERMISSIONS.CUSTOMERS_CREATE)
  suggestByDomain(
    @Query('email') email: string,
    @Query('excludeCustomerId') excludeCustomerId?: string,
  ) {
    return this.service.suggestByDomain(email, excludeCustomerId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.CUSTOMERS_READ)
  findOne(@Param('id') id: string) {
    return this.service.findCustomer(id);
  }

  @Post()
  @Permissions(PERMISSIONS.CUSTOMERS_CREATE)
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createCustomer(dto, user);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateCustomer(id, dto, user);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.CUSTOMERS_DELETE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.softDeleteCustomer(id, user);
  }

  // --- Contacts (nested) ---
  @Get(':id/contacts')
  @Permissions(PERMISSIONS.CUSTOMERS_READ)
  findContacts(@Param('id') id: string) {
    return this.service.findContacts(id);
  }

  @Post(':id/contacts')
  @Permissions(PERMISSIONS.CUSTOMERS_CREATE)
  createContact(
    @Param('id') id: string,
    @Body() dto: CreateContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createContact(id, dto, user);
  }

  @Patch(':id/contacts/:contactId')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  updateContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateContact(id, contactId, dto, user);
  }

  @Delete(':id/contacts/:contactId')
  @Permissions(PERMISSIONS.CUSTOMERS_DELETE)
  removeContact(@Param('contactId') contactId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.softDeleteContact(contactId, user);
  }

  @Patch(':id/contacts/:contactId/portal')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  updateContactPortal(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactPortalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateContactPortal(id, contactId, dto, user);
  }

  @Post(':id/contacts/:contactId/portal/password')
  @Permissions(PERMISSIONS.CUSTOMERS_UPDATE)
  setPortalPassword(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() dto: SetContactPortalPasswordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setContactPortalPassword(id, contactId, dto, user);
  }

  // --- Sites (nested) ---
  @Get(':id/sites')
  @Permissions(PERMISSIONS.CUSTOMERS_READ)
  findSites(@Param('id') id: string) {
    return this.service.findSites(id);
  }

  @Post(':id/sites')
  @Permissions(PERMISSIONS.CUSTOMERS_CREATE)
  createSite(
    @Param('id') id: string,
    @Body() dto: CreateSiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createSite(id, dto, user);
  }

  // --- Contracts (nested) ---
  @Get(':id/contracts')
  @Permissions(PERMISSIONS.CONTRACTS_READ)
  findContracts(@Param('id') id: string) {
    return this.service.findContracts(id);
  }

  @Post(':id/contracts')
  @Permissions(PERMISSIONS.CONTRACTS_UPDATE)
  createContract(
    @Param('id') id: string,
    @Body() dto: CreateContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.createContract(id, dto, user);
  }

  @Patch(':id/contracts/:contractId')
  @Permissions(PERMISSIONS.CONTRACTS_UPDATE)
  updateContract(
    @Param('id') id: string,
    @Param('contractId') contractId: string,
    @Body() dto: UpdateContractDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.updateContract(id, contractId, dto, user);
  }
}
