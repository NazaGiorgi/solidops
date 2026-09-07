import { Body, Controller, Get, Param, Patch, Put, UseGuards } from '@nestjs/common';
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsObject, Min } from 'class-validator';
import { AdminService } from './admin.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RoleName } from '../../common/enums';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

class UpdateRolePermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, Array<{ start: string; end: string }>>;

  @IsOptional()
  @IsInt()
  @Min(1)
  slaFirstResponseMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  slaResolutionHours?: number;

  @IsOptional()
  @IsString()
  contactEmail?: string | null;

  @IsOptional()
  @IsBoolean()
  emailAutoResponseEnabled?: boolean;

  @IsOptional()
  @IsString()
  emailSender?: string | null;
}

// Panel de Administración: editor de roles y permisos + configuración general.
// Solo el rol Administrador puede gestionar estos. Los endpoints devuelven
// respuestas al catálogo/estado de permisos leídas desde la base (una sola
// fuente de verdad: role.permissions jsonb).
@Controller('admin')
@UseGuards(RolesGuard)
@Roles(RoleName.ADMINISTRADOR)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // Permissions available to assign (the real catalog from code).
  @Get('permissions')
  permissions() {
    return this.admin.permissionCatalog();
  }

  // List roles with their current permission sets / matrix from DB.
  @Get('roles')
  roles() {
    return this.admin.listRoles();
  }

  @Patch('roles/:id/permissions')
  updateRolePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.updatePermissions(id, dto.permissions, user);
  }

  @Get('settings')
  settings() {
    return this.admin.getSettings();
  }

  @Put('settings')
  updateSettings(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.updateSettings(dto, user);
  }
}
