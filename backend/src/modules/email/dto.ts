import { IsArray, IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';

export class InboundEmailDto {
  @IsEmail()
  fromEmail: string;

  @IsString()
  subject: string;

  @IsOptional()
  @IsString()
  body?: string;

  // HTML sanitizado (si el email traía text/html), para mostrar en el frontend.
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  // Optional inbound message-id header used for thread matching.
  @IsOptional()
  @IsString()
  messageId?: string;

  // Shadow-mode ticket (from a mailbox in shadow_mode). Isolated from the
  // operational flow and carries a "no responder" warning.
  @IsOptional()
  shadow?: boolean;

  // Optional explicit overrides (e.g. a known dispatch mailbox). If omitted,
  // the sender is resolved against Contacts.
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  // Box destino del ticket (ticket_groups.name). Si viene (definido por una
  // regla de mailbox que apunta a un box), se escribe en tickets.legacy_group.
  @IsOptional()
  @IsString()
  legacyGroup?: string;

  // Optional attachment references (real mail parsing wired).
  @IsOptional()
  @IsArray()
  attachments?: Array<{
    filename: string;
    url: string;
    mimeType: string;
    sizeBytes?: number;
    cid?: string | null;
    disposition?: 'inline' | 'attachment';
  }>;
}
