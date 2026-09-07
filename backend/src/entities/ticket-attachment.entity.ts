import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { TicketMessage } from './ticket-message.entity';

@Entity('ticket_attachments')
export class TicketAttachment extends BaseEntity {
  @Index()
  @Column({ name: 'ticket_message_id', type: 'uuid' })
  ticketMessageId: string;

  @ManyToOne(() => TicketMessage, (message) => message.attachments)
  @JoinColumn({ name: 'ticket_message_id' })
  message: TicketMessage;

  // MinIO/S3 object URL or key.
  @Column({ name: 'file_url', type: 'varchar', length: 600 })
  fileUrl: string;

  // Nombres de archivo reales de Zammad pueden ser largos (con espacios,
  // paréntesis, prefijos "[EXT]... [Ticket#...]" o URL-encoding). varch(500)
  // da margen amplio sin llegar a ser excesivo. Ver migración
  // WidenTicketAttachmentFilename.
  @Column({ type: 'varchar', length: 500 })
  filename: string;

  // La mime_type de Zammad suele incluir el parámetro `; name="..."` con el
  // nombre original del archivo, de modo que fácilmente supera 120 chars
  // (p.ej. `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;
  // name="Bs. As- Mercedes (Giorgi) facturacion agosto.xlsx"` = 123 chars). Eso
  // rompía el insert con "value too long for varchar(120)". varch(500) da margen.
  // Ver migración WidenTicketAttachmentFilename.
  @Column({ name: 'mime_type', type: 'varchar', length: 500 })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'int', default: 0 })
  sizeBytes: number;
}
