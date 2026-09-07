import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';
import { SoftDeleteEntity } from '../common/entities/soft-delete.entity';
import { Ticket } from './ticket.entity';
import { EquipmentType, WorkshopEquipmentStatus } from '../common/enums';

export interface StatusHistoryEntry {
  status: WorkshopEquipmentStatus;
  at: string;
  byUserId: string | null;
}

// Recepción de un equipo en el taller. Cada ticket de Taller corresponde a un
// único equipo (decisión de producto: 1 ticket = 1 equipo), pero un cliente
// puede tener varios equipos/tickets. Los datos de cliente se denormalizan del
// ticket para consulta cómoda, pero la fuente de verdad del cliente es el Ticket.
@Entity('workshop_equipments')
export class WorkshopEquipment extends SoftDeleteEntity {
  @Index()
  @Column({ name: 'ticket_id', type: 'uuid', unique: true, nullable: true })
  ticketId: string | null;

  @OneToOne(() => Ticket, { nullable: true })
  @JoinColumn({ name: 'ticket_id' })
  ticket: Ticket | null;

  // Cliente (denormalizado del ticket). Puede ser una empresa o un particular:
  // ambos son `Customer` en el modelo actual (la distinción es implícita por
  // nombre, ej. "Clientes particulares"). No se asume empresa.
  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @Column({ name: 'customer_label', type: 'varchar', length: 220, nullable: true })
  customerLabel: string | null;

  // Datos del equipo.
  @Index()
  @Column({ name: 'equipment_type', type: 'varchar', length: 30 })
  equipmentType: EquipmentType;

  @Column({ name: 'other_type', type: 'varchar', length: 80, nullable: true })
  otherType: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  brand: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  model: string | null;

  @Column({ name: 'serial_number', type: 'varchar', length: 120, nullable: true })
  serialNumber: string | null;

  // Accesorios recibidos junto al equipo (texto libre / checklist simple).
  @Column({ type: 'text', nullable: true })
  accessories: string | null;

  // Estado físico / observaciones visuales al recibir.
  @Column({ name: 'physical_condition', type: 'text', nullable: true })
  physicalCondition: string | null;

  // Falla reportada por el cliente (obligatoria).
  @Column({ name: 'reported_fault', type: 'text' })
  reportedFault: string;

  // Diagnóstico técnico (se completa en la etapa "Diagnosticado"; vacío al ingresar).
  @Column({ type: 'text', nullable: true })
  diagnosis: string | null;

  @Index()
  @Column({ type: 'varchar', length: 24, default: WorkshopEquipmentStatus.RECIBIDO })
  status: WorkshopEquipmentStatus;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ name: 'status_history', type: 'jsonb', default: [] })
  statusHistory: StatusHistoryEntry[];

  constructor() {
    super();
    this.statusHistory = [];
  }
}
