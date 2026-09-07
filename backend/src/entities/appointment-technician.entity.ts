import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Appointment } from './appointment.entity';
import { Technician } from './technician.entity';

// Relación N:N entre citas de agenda y técnicos asignados. Permite que una cita
// (ej. visita técnica) tenga MÁS de un técnico presente. El técnico "responsable
// principal" sigue siendo Appointment.technicianId (para compatibilidad), pero
// también se incluye en esta lista junto con el resto.
@Entity('appointment_technicians')
export class AppointmentTechnician {
  @PrimaryColumn({ name: 'appointment_id', type: 'uuid' })
  appointmentId: string;

  @ManyToOne(() => Appointment, (a) => a.technicianLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment;

  @PrimaryColumn({ name: 'technician_id', type: 'uuid' })
  technicianId: string;

  @ManyToOne(() => Technician, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'technician_id' })
  technician: Technician;
}
