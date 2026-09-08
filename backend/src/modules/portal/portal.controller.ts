import { Body, Controller, Get, Param, Post, Query, UseGuards, Req } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { PortalService } from './portal.service';
import { PortalGuard } from './portal.guard';
import { CurrentPortalContact, PortalContact } from './portal-contact.decorator';
import { Public } from '../../common/decorators/public.decorator';

class PortalLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

class PortalRegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

class PortalVerifyEmailDto {
  @IsString()
  token: string;
}

class PortalRefreshDto {
  @IsString()
  refreshToken: string;
}

class PortalForgotPasswordDto {
  @IsEmail()
  email: string;
}

class PortalResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

class PortalCreateTicketDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  priority?: string;
}

class PortalMessageDto {
  @IsString()
  body: string;
}

class PortalQuoteRespondDto {
  @IsIn(['aprobado', 'rechazado'])
  decision: 'aprobado' | 'rechazado';
}

@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  @Public()
  @Post('auth/login')
  login(@Req() req: Request, @Body() dto: PortalLoginDto) {
    return this.service.login(dto.email, dto.password, req.ip || '127.0.0.1');
  }

  @Public()
  @Post('auth/register')
  register(@Req() req: Request, @Body() dto: PortalRegisterDto) {
    return this.service.register(dto, req.ip || '127.0.0.1');
  }

  @Public()
  @Post('auth/verify-email')
  verifyEmail(@Req() req: Request, @Body() dto: PortalVerifyEmailDto) {
    return this.service.verifyEmail(dto.token, req.ip || '127.0.0.1');
  }

  @Public()
  @Post('auth/refresh')
  refresh(@Body() dto: PortalRefreshDto) {
    return this.service.refresh(dto.refreshToken);
  }

  @Public()
  @Post('auth/forgot-password')
  forgotPassword(@Req() req: Request, @Body() dto: PortalForgotPasswordDto) {
    return this.service.forgotPassword(dto.email, req.ip || '127.0.0.1');
  }

  @Public()
  @Post('auth/reset-password')
  resetPassword(@Body() dto: PortalResetPasswordDto) {
    return this.service.resetPassword(dto.token, dto.newPassword);
  }

  @Public()
  @Get('auth/me')
  @UseGuards(PortalGuard)
  me(@CurrentPortalContact() contact: PortalContact) {
    return this.service.me(contact.id);
  }

  @Public()
  @Get('tickets')
  @UseGuards(PortalGuard)
  list(
    @Query('status') status: string | undefined,
    @Query('search') search: string | undefined,
    @CurrentPortalContact() contact: PortalContact,
  ) {
    return this.service.listTickets(contact.customerId, status, search);
  }

  @Public()
  @Get('tickets/:id')
  @UseGuards(PortalGuard)
  detail(@Param('id') id: string, @CurrentPortalContact() contact: PortalContact) {
    return this.service.getTicket(id, contact.customerId);
  }

  @Public()
  @Get('reports')
  @UseGuards(PortalGuard)
  reports(@CurrentPortalContact() contact: PortalContact) {
    return this.service.reports(contact.customerId);
  }

  @Public()
  @Post('tickets')
  @UseGuards(PortalGuard)
  create(
    @Body() dto: PortalCreateTicketDto,
    @CurrentPortalContact() contact: PortalContact,
  ) {
    return this.service.createTicket(contact.customerId, contact.id, dto);
  }

  @Public()
  @Post('tickets/:id/messages')
  @UseGuards(PortalGuard)
  message(
    @Param('id') id: string,
    @Body() dto: PortalMessageDto,
    @CurrentPortalContact() contact: PortalContact,
  ) {
    return this.service.addMessage(id, contact.customerId, dto.body);
  }

  // --- Presupuestos de taller (portal) --------------------------------------

  @Public()
  @Get('quotes')
  @UseGuards(PortalGuard)
  quotes(@CurrentPortalContact() contact: PortalContact) {
    return this.service.quotes(contact.customerId, contact.id);
  }

  @Public()
  @Post('quotes/:id/respond')
  @UseGuards(PortalGuard)
  respondQuote(
    @Param('id') id: string,
    @Body() body: PortalQuoteRespondDto,
    @CurrentPortalContact() contact: PortalContact,
  ) {
    return this.service.respondQuote(id, body.decision, contact);
  }
}
