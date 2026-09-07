import { IsArray, IsOptional, IsString, IsUUID, IsInt } from 'class-validator';

// Crear/editar una nota. Todos los vínculos (box, cliente, ticket, etiquetas) son
// OPCIONALES: una nota puede existir totalmente suelta.
export class CreateNoteDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsUUID()
  @IsOptional()
  boxId?: string | null;

  @IsUUID()
  @IsOptional()
  customerId?: string | null;

  @IsUUID()
  @IsOptional()
  ticketId?: string | null;

  // Nombres de etiquetas asociadas a la nota (se crean si no existen).
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

// Update de nota: todos los campos opcionales (patch parcial).
export class UpdateNoteDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  body?: string;

  @IsUUID()
  @IsOptional()
  boxId?: string | null;

  @IsUUID()
  @IsOptional()
  customerId?: string | null;

  @IsUUID()
  @IsOptional()
  ticketId?: string | null;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];
}

// Crear/editar un box (cuaderno).
export class CreateBoxDto {
  @IsString()
  name: string;

  @IsInt()
  @IsOptional()
  orderIndex?: number;
}

export class UpdateBoxDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsInt()
  @IsOptional()
  orderIndex?: number;
}

// Crear/renombrar una etiqueta.
export class CreateTagDto {
  @IsString()
  name: string;
}

export class UpdateTagDto {
  @IsString()
  @IsOptional()
  name?: string;
}

// Filtros de listado de notas: combinables entre sí.
export class ListNotesQuery {
  @IsUUID()
  @IsOptional()
  boxId?: string;

  // Una o varias etiquetas (por nombre o id). Se combinan con AND (la nota debe
  // tener todas).
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  // Texto libre (FTS sobre título + contenido).
  @IsString()
  @IsOptional()
  search?: string;

  @IsUUID()
  @IsOptional()
  customerId?: string;

  @IsUUID()
  @IsOptional()
  ticketId?: string;
}
