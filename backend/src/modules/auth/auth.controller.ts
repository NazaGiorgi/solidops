import { Body, Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  // Opcional: 'admin' -> genera un accessToken con duración extendida (solo para
  // roles administrador, usado por scripts administrativos / migraciones).
  @IsOptional()
  @IsString()
  purpose?: string;
}

class RefreshDto {
  @IsString()
  refreshToken: string;
}

class ChangePasswordDto {
  @IsString()
  current: string;

  @IsString()
  @MinLength(8)
  next: string;
}

class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

@Controller('auth')
@UseGuards(RolesGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password, dto.purpose);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  // Devuelve el usuario actual con sus permisos recién leídos de la BD (el
  // JWT.strategy los carga frescos en cada request). El cliente lo usa en el
  // bootstrap para sincronizar la sesión cacheada cuando cambian los permisos del
  // rol (ej. al dar de alta el módulo Taller, sin obligar logout/login).
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    // user ya es un AuthenticatedUser con permissions frescos de la BD
    // (resueltos por JwtStrategy.validate en cada request).
    return user;
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    await this.auth.changePassword(user.id, dto.current, dto.next);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  async forgotPassword(@Req() req: Request, @Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email, req.ip || '127.0.0.1');
  }

  @Public()
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { ok: true };
  }
}
