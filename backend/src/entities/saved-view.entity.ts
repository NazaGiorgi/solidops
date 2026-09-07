import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';

// Condición estructurada de una vista guardada (SavedView). Todos los campos son
// opcionales y se combinan con AND cuando están presentes:
//  - statusIn:              estado(s) válido(s) del ticket.
//  - senderContains:        el remitente del PRIMER mensaje contiene el texto
//                           (equivalente a article.from / sender en Zammad).
//  - titleContains:         el asunto/título contiene el texto.
//  - titleNotContains:      el asunto/título NO contiene el texto (inverso).
//  - ownerIsNull:           ticket sin técnico asignado.
//  - ownerIsCurrentUser:    ticket asignado al técnico logueado (vista userScoped).
// NOTA: las etiquetas (`tags`) no existen aún en SolidOps, por lo que las vistas
// que dependen de ellas (ej. "EN ESPERA") no se implementan todavía.
export interface SavedViewCondition {
  statusIn?: string[];
  senderContains?: string;
  titleContains?: string;
  titleNotContains?: string;
  ownerIsNull?: boolean;
  ownerIsCurrentUser?: boolean;
  // Grupo legacy (migración Zammad). Si hay senderContains además, ambos se
  // combinan con OR (la vista se cumple con cualquiera de los dos criterios).
  legacyGroupIn?: string[];
}

@Entity('saved_views')
export class SavedView extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name: string;

  // Orden/prioridad de la vista en el sidebar.
  @Column({ type: 'int', default: 999 })
  prio: number;

  // Condición de filtro (JSONB).
  @Column({ name: 'condition', type: 'jsonb', default: {} })
  condition: SavedViewCondition;

  // Vista que depende del usuario logueado (Grupo B): 'Mis tickets asignados',
  // pendientes, etc. Se evalúa con el actor actual, no con una condición fija.
  @Index()
  @Column({ name: 'user_scoped', type: 'boolean', default: false })
  userScoped: boolean;

  // Vista del sistema (sembrada) vs creada a mano. Las del sistema no se borran.
  @Index()
  @Column({ type: 'boolean', default: true })
  builtin: boolean;
}
