import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsNumber,
  IsArray,
  ValidateNested,
  IsIn,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContactPreferredChannel, TicketPriority } from '../../common/enums';
import { BusinessHours, TimeInterval } from '../../common/utils/business-hours.util';

export class CreateCustomerDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateContactDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsEnum(ContactPreferredChannel)
  preferredChannel?: ContactPreferredChannel;
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsOptional()
  @IsEnum(ContactPreferredChannel)
  preferredChannel?: ContactPreferredChannel;
}

// Vincular un contacto genérico "Cliente WA {n}" a un contacto/cliente real:
// recibe el ID del contacto destino ya existente (que pasa a tener el número).
export class LinkToContactDto {
  @IsUUID()
  contactId: string;
}

export class CreateSiteDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateSiteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

class IntervalDto {
  @IsString()
  start: string;

  @IsString()
  end: string;
}

class PriorityTierDto {
  @IsNumber()
  first_response_minutes: number;

  @IsNumber()
  resolution_hours: number;
}

export class CreateContractDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsNumber()
  slaFirstResponseMinutes: number;

  @IsNumber()
  slaResolutionHours: number;

  @IsObject()
  businessHours: {
    [weekday: string]: IntervalDto[];
  };

  @IsOptional()
  @IsObject()
  priorityTier?: Record<string, PriorityTierDto>;
}

export class UpdateContractDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  slaFirstResponseMinutes?: number;

  @IsOptional()
  @IsNumber()
  slaResolutionHours?: number;

  @IsOptional()
  @IsObject()
  businessHours?: {
    [weekday: string]: IntervalDto[];
  };

  @IsOptional()
  @IsObject()
  priorityTier?: Record<string, PriorityTierDto>;
}

export class UpdateContactPortalDto {
  @IsBoolean()
  enabled: boolean;
}

// Fijar manualmente la contraseña de portal de un contacto desde el staff.
// Solo recibe la contraseña en claro; el servicio la hashea (bcrypt) y nunca la
// loguea ni la devuelve. No toca portal_enabled.
export class SetContactPortalPasswordDto {
  @IsString()
  @MinLength(8)
  password: string;
}
