import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, IsUUID } from 'class-validator';
import { MailboxRulesService } from './mailbox-rules.service';
import { CreateMailboxRuleDto, UpdateMailboxRuleDto } from './mailbox-rules.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RoleName } from '../../common/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

class PreviewMailboxRuleDto {
  @IsOptional()
  @IsString()
  senderPattern?: string;

  @IsOptional()
  @IsString()
  subjectPattern?: string;

  @IsOptional()
  @IsIn(['ticket', 'document', 'discard'])
  destination?: string;

  @IsOptional()
  @IsUUID()
  targetGroupId?: string | null;
}

// Admin/Supervisor-only management of routing rules ("cajones").
@Controller('mailbox-rules')
@Roles(RoleName.ADMINISTRADOR, RoleName.SUPERVISOR)
@UseGuards(RolesGuard)
export class MailboxRulesController {
  constructor(private readonly service: MailboxRulesService) {}

  @Get()
  list(@Query('mailbox') mailboxEmail: string) {
    return this.service.listForMailbox(mailboxEmail);
  }

  @Get('unrouted')
  unrouted(@Query('mailbox') mailboxEmail: string, @Query('limit') limit?: string) {
    return this.service.listUnrouted(mailboxEmail, limit ? parseInt(limit, 10) : 50);
  }

  @Post('preview')
  preview(@Query('mailbox') mailboxEmail: string, @Body() dto: PreviewMailboxRuleDto) {
    return this.service.preview(mailboxEmail, dto);
  }

  @Post()
  create(@Body() dto: CreateMailboxRuleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMailboxRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.remove(id, user);
  }
}
