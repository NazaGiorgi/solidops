import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TicketStatus,
  TicketPriority,
  TicketChannel,
  TicketAuthorType,
} from '../../common/enums';

export class CreateTicketDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  category?: string;
}

export class UpdateTicketDto {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string | null;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class AssignTicketDto {
  @IsUUID()
  technicianId: string;
}

export class BulkMoveTicketsDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  ticketIds: string[];

  @IsUUID()
  groupId: string;
}

export class BulkDeleteTicketsDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  ticketIds: string[];
}

export class BulkChangeStatusTicketsDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  ticketIds: string[];

  @IsEnum(TicketStatus)
  status: TicketStatus;
}

export class AddMessageDto {
  @IsOptional()
  @IsUUID()
  authorUserId?: string;

  @IsEnum(TicketChannel)
  channel: TicketChannel;

  @IsEnum(TicketAuthorType)
  authorType: TicketAuthorType;

  @IsString()
  body: string;

  @IsOptional()
  @IsString()
  fromEmail?: string;
}

export class ListTicketsQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  // Filter by ticket merge state.
  //  'parents'  -> only principals that have one or more merged children.
  //  'children' -> only tickets merged into another (merged children).
  //  'exclude'  -> only tickets that never participated in a merge.
  //  absent     -> no merge filter (current behavior).
  @IsOptional()
  @IsIn(['parents', 'children', 'exclude'])
  merge?: string;

  // When provided ('true'/'false'), filters tickets by shadow mode. By default
  // (absent) shadow tickets are EXCLUDED from the operational list.
  @IsOptional()
  @IsString()
  shadow?: string;

  // "Bandeja" filter for migrated Zammad tickets:
  //  'support'  (default) -> native tickets (legacy_group NULL) OR legacy_group in (L1,L2,L3).
  //  'general'            -> legacy_group in the noise groups (Users/Backups MK/Taller/Ventas).
  //  'all'                -> no tray filter.
  //  <grupo exacto>       -> only tickets whose legacy_group equals that value.
  @IsOptional()
  @IsString()
  tray?: string;

  // id de una SavedView (vista guardada, replica de las Overviews de Zammad).
  // Aplica la condición de la vista sobre el listado (se combina con el resto).
  @IsOptional()
  @IsString()
  view?: string;

  // Paginación. `page` (1-based, default 1) y `take` (tamaño de página).
  // Si NO vienen, findAll usa un default de 100 para no traer decenas de miles
  // de filas (p.ej. bandeja "Users" = 39.057 tickets -> 48MB -> 3s). La respuesta
  // pasa a ser { items, total, page, pageSize } para permitir paginar e informar
  // cuántos hay.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;
}
