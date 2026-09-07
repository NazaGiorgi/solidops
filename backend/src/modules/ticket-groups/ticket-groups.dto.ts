import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateTicketGroupDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Módulo al que el box sirve como destino (p.ej. 'workshop').
  @IsOptional()
  @IsString()
  @MaxLength(40)
  moduleKey?: string | null;
}

export class UpdateTicketGroupDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  moduleKey?: string | null;
}

// Desactivar un box requiere indicar obligatoriamente un box activo de
// "fallback" donde se mueven los tickets existentes y se reapuntan las reglas de
// mailbox que apuntaban al box que se desactiva. Se valida opcional (UUID si
// viene); la ausencia la maneja el servicio con un mensaje claro.
export class DeactivateTicketGroupDto {
  @IsOptional()
  @IsUUID()
  fallbackGroupId?: string | null;
}
