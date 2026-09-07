import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { TechnicianLevel, TechnicianStatus } from '../../common/enums';

export class CreateTechnicianDto {
  @IsString()
  userId: string;

  @IsOptional()
  avatarUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialties?: string[];

  @IsOptional()
  @IsEnum(TechnicianLevel)
  level?: TechnicianLevel;

  @IsOptional()
  @IsString()
  schedule?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(TechnicianStatus)
  status?: TechnicianStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  // Teléfono de WhatsApp (solo dígitos, ej. '5491172450095'). Nullable = el
  // técnico no recibe recordatorios por WhatsApp (igual recibe email).
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'whatsappPhone debe contener solo dígitos' })
  whatsappPhone?: string;
}

export class UpdateTechnicianDto {
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  specialties?: string[];

  @IsOptional()
  @IsEnum(TechnicianLevel)
  level?: TechnicianLevel;

  @IsOptional()
  @IsString()
  schedule?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(TechnicianStatus)
  status?: TechnicianStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'whatsappPhone debe contener solo dígitos' })
  whatsappPhone?: string;
}

export class UpdatePresenceDto {
  @IsEnum(TechnicianStatus)
  status: TechnicianStatus;
}
