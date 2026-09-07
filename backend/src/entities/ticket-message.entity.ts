import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Ticket } from './ticket.entity';
import { TicketAuthorType, TicketChannel } from '../common/enums';
import { TicketAttachment } from './ticket-attachment.entity';

@Entity('ticket_messages')
export class TicketMessage extends BaseEntity {
  @Index()
  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @ManyToOne(() => Ticket, (ticket) => ticket.messages)
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @Column({
    name: 'author_type',
    type: 'varchar',
    length: 20,
    default: TicketAuthorType.TECNICO,
  })
  authorType: TicketAuthorType;

  @Column({ type: 'varchar', length: 20, default: TicketChannel.PORTAL })
  channel: TicketChannel;

  @Column({ type: 'text' })
  body: string;

  // HTML sanitizado del email entrante (si venía text/html). Se guarda por
  // separado del `body` (texto plano) para mostrarlo con formato en el frontend.
  @Column({ name: 'body_html', type: 'text', nullable: true })
  bodyHtml: string | null;

  // Optional original sender address for email-originated messages.
  @Column({ type: 'varchar', length: 160, nullable: true })
  fromEmail: string | null;

  @OneToMany(() => TicketAttachment, (attachment) => attachment.message)
  attachments: TicketAttachment[];
}
