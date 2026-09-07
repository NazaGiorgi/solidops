import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  IsBoolean,
  IsEmail,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EquipmentType, WorkshopEquipmentStatus, WorkshopQuoteStatus } from '../../common/enums';

export class CustomerContactRef {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  customerLabel?: string | null;
}

export class CreateWorkshopEquipmentDto {
  // Cliente asociado (empresa o particular: ambos son Customer).
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  customerLabel?: string | null;

  // Datos del equipo.
  @IsEnum(EquipmentType)
  equipmentType: EquipmentType;

  @IsOptional()
  @IsString()
  otherType?: string | null;

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  model?: string | null;

  @IsOptional()
  @IsString()
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  accessories?: string | null;

  @IsOptional()
  @IsString()
  physicalCondition?: string | null;

  @IsString()
  reportedFault: string;

  @IsOptional()
  @IsString()
  title?: string | null;
}

// Corrección de datos del contacto global del cliente (nombre/email/teléfono).
export class UpdateContactPatchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;
}

export class UpdateWorkshopEquipmentDto {
  @IsOptional()
  @IsString()
  otherType?: string | null;

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  model?: string | null;

  @IsOptional()
  @IsString()
  serialNumber?: string | null;

  @IsOptional()
  @IsString()
  accessories?: string | null;

  @IsOptional()
  @IsString()
  physicalCondition?: string | null;

  @IsOptional()
  @IsString()
  reportedFault?: string;

  @IsOptional()
  @IsString()
  diagnosis?: string | null;

  // Cambiar el contacto asociado al equipo (otro contacto del mismo cliente).
  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  // Corregir datos del contacto actual (nombre/email/teléfono). Se edita el
  // contacto global del cliente (misma convención que editar desde Clientes).
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateContactPatchDto)
  contactPatch?: UpdateContactPatchDto;
}

export class SetWorkshopEquipmentStatusDto {
  @IsEnum(WorkshopEquipmentStatus)
  status: WorkshopEquipmentStatus;

  @IsOptional()
  @IsString()
  note?: string | null;
}

export class CreatePriceListItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  isLabor?: boolean;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdatePriceListItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  isLabor?: boolean;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class QuoteLineDto {
  @IsOptional()
  @IsUUID()
  priceListItemId?: string | null;

  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  isLabor?: boolean;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  unitPrice: string;
}

export class CreateWorkshopQuoteDto {
  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional({ each: true })
  lines: QuoteLineDto[];
}
