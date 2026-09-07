import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// Catálogo de "boxes" (grupos/bandejas de tickets). Reemplaza el uso de la
// columna `tickets.legacy_group` como texto libre suelto: cada box es una fila
// acá, editable desde el Panel de Administración. El nombre coincide con el
// valor que se guarda en `tickets.legacy_group` (se mantiene string para no
// romper todo el código que hoy filtra/cuenta por ese campo).
@Entity('ticket_groups')
// Solo puede haber un box ACTIVO por moduleKey (índice único parcial).
@Index(['moduleKey'], { unique: true, where: '"active" = true AND "module_key" IS NOT NULL' })
export class TicketGroup extends BaseEntity {
  // Nombre del box. Único. Es el string que se escribe en tickets.legacy_group.
  @Index()
  @Column({ type: 'varchar', length: 80, unique: true })
  name: string;

  // Color para diferenciar boxes visualmente en el sidebar (opcional).
  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string | null;

  // Orden de aparición en el menú lateral (menor = más arriba).
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  // Permite "ocultar" un box sin borrarlo (soft-delete). No deja tickets
  // huérfanos: al desactivar un box, tickets.legacy_group conserva el valor.
  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Módulo al que este box sirve como destino (p.ej. 'workshop'). Cuando un
  // módulo crea un ticket, busca el box activo con su moduleKey y le setea
  // tickets.legacy_group = box.name. Al desactivar el box, el moduleKey se
  // transfiere al box fallback. Solo puede haber un box ACTIVO por moduleKey
  // (índice único parcial WHERE active = true).
  @Column({ name: 'module_key', type: 'varchar', length: 40, nullable: true })
  moduleKey: string | null;
}
