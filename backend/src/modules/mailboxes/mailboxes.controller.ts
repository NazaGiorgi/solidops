import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { MailboxesService } from './mailboxes.service';
import { CreateMailboxDto, UpdateMailboxDto, TestMailboxDto, TestSmtpDto } from './dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RoleName } from '../../common/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Admin/Supervisor-only management of email mailboxes (channels).
@Controller('mailboxes')
@Roles(RoleName.ADMINISTRADOR, RoleName.SUPERVISOR)
@UseGuards(RolesGuard)
export class MailboxesController {
  constructor(private readonly service: MailboxesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateMailboxDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMailboxDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deactivate(id, user);
  }

  @Post('test-connection')
  testConnection(@Body() dto: TestMailboxDto) {
    return this.service.testConnection(dto);
  }

  @Post('test-smtp')
  testSmtp(@Body() dto: TestSmtpDto) {
    return this.service.testSmtp(dto);
  }
}
