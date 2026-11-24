import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';
import { Technician } from './technician.entity';

// Colaboradores de un ticket. El responsable sigue siendo Ticket.technicianId
// (SLA, alertas, carga y reportes existentes no cambian); esta tabla sólo suma
// técnicos que también trabajan el ticket. El responsable NUNCA se guarda acá.
@Entity('ticket_technicians')
export class TicketTechnician {
  @PrimaryColumn({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @ManyToOne(() => Ticket, (ticket) => ticket.collaboratorLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket;

  @PrimaryColumn({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @ManyToOne(() => Technician, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'technician_id' })
  technician: Technician;

  // Quién agregó al colaborador. Null si el usuario ya no existe.
  @Column({ name: 'added_by_user_id', type: 'uuid', nullable: true })
  addedByUserId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
