import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { SavedView, SavedViewCondition } from '../../entities/saved-view.entity';
import { Ticket } from '../../entities/ticket.entity';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// Vistas de Zammad replicadas en SolidOps.
//
// Grupo A (fijas, sin depender del usuario): condición guardada.
// Grupo B (userScoped): se evalúan con el técnico logueado.
//
// NOTA sobre estados: Zammad usa 'open'/'closed'/'new'/'pending reminder'/
// 'pending close'/'id 6'. En SolidOps la migración mapeó pending -> esperando_cliente,
// closed -> cerrado, open -> abierto, new -> nuevo, y los desconocidos a nuevo.
// No existen estados "id 6" ni "pending_reminder"/"pending_close" como distintos,
// así que las vistas usan los estados reales de SolidOps (ver helper maps).
const ST_OPEN = 'abierto';
const ST_NEW = 'nuevo';
const ST_CLOSED = 'cerrado';
const ST_PENDING = 'esperando_cliente'; // Zammad 'pending reminder'/'pending close'
const ST_RESOLVED = 'resuelto';
const ST_ASSIGNED = 'asignado';
const ST_IN_PROGRESS = 'en_progreso';

// "Estados abiertos" (sin cerrado) para vistas de trabajo en curso.
const OPENISH = [ST_OPEN, ST_NEW, ST_PENDING, ST_RESOLVED];
// Estados de las vistas "de contenido" (remitente/asunto): Zammad usa
// [open, new, closed, pending reminder, pending close]. En SolidOps closed ->
// cerrado, pending -> esperando_cliente. Incluye cerrado (el grueso del historial).
const CONTENT_STATUSES = [ST_OPEN, ST_NEW, ST_CLOSED, ST_PENDING, ST_RESOLVED];
// Estados de la vista "Todos los tickets" (Zammad incluye TODO pese al nombre).
const ALL = [ST_OPEN, ST_NEW, ST_CLOSED, ST_PENDING, ST_RESOLVED, ST_ASSIGNED, ST_IN_PROGRESS];

// Definición semilla de las vistas. `userScoped` marca las que dependen del usuario.
const SEED: Array<{ name: string; prio: number; userScoped?: boolean; condition: SavedViewCondition }> = [
  // Grupo A — fijas.
  {
    name: 'Ordenes de Servicio',
    prio: 10,
    condition: { statusIn: CONTENT_STATUSES, senderContains: 'ordendetrabajosolidocs', titleContains: 'NUEVA ORDEN DE SERVICIO CREADA' },
  },
  {
    name: 'Ordenes de Trabajo',
    prio: 20,
    condition: { statusIn: CONTENT_STATUSES, senderContains: 'ordendetrabajosolidocs', titleContains: 'NUEVA PC TALLER' },
  },
  {
    name: 'Backups MK',
    prio: 30,
    // Unificación de la bandeja "Backups MK": captura por remitente (mkbackups@,
    // tickets nuevos) O por grupo legacy (tickets migrados de Zammad con
    // legacy_group='Backups MK'). Cualquier criterio basta → no se pierde ningún
    // ticket de los 727 migrados ni los nuevos que llegan por email.
    condition: { statusIn: CONTENT_STATUSES, senderContains: 'mkbackups', legacyGroupIn: ['Backups MK'] },
  },
  {
    name: 'Notificaciones de RED',
    prio: 40,
    condition: { statusIn: CONTENT_STATUSES, senderContains: 'mkbackups', titleContains: 'notificación' },
  },
  {
    name: 'CORRECTO - backup clientes',
    prio: 50,
    condition: { statusIn: CONTENT_STATUSES, senderContains: 'backup.clientes', titleContains: 'correcto:' },
  },
  {
    name: 'INCORRECTO - backup clientes',
    prio: 60,
    condition: { statusIn: CONTENT_STATUSES, senderContains: 'backup.clientes', titleContains: 'incorrecto:' },
  },
  {
    name: 'Tickets no asignados y abiertos',
    prio: 70,
    condition: { statusIn: [ST_OPEN, ST_NEW, ST_PENDING], ownerIsNull: true },
  },
  {
    name: 'Todos los tickets',
    prio: 80,
    condition: { statusIn: ALL },
  },
  // Grupo B — dependen del usuario logueado.
  {
    name: 'Mis tickets asignados',
    prio: 90,
    userScoped: true,
    condition: { statusIn: [ST_OPEN, ST_NEW, ST_PENDING, ST_ASSIGNED, ST_IN_PROGRESS], ownerIsCurrentUser: true },
  },
  {
    name: 'Mis tickets pendientes',
    prio: 95,
    userScoped: true,
    condition: { statusIn: [ST_PENDING], ownerIsCurrentUser: true },
  },
];

// Vistas de Zammad que NO se implementan (documentadas, ver docs/ZAMMAD-MIGRATION.md):
//  - "EN ESPERA" -> depende de etiquetas manuales (tags), feature inexistente.
//  - "Mis tickets suscritos" -> no existe concepto de suscripción/mención.
//  - "Tickets escalados" / "Pending Reached" -> motor de escalamiento de Zammad distinto.
//  - "My Replacement Tickets" / "My Organization Tickets" -> features no migradas.

export interface SavedViewWithCount {
  id: string;
  name: string;
  prio: number;
  userScoped: boolean;
  count: number;
}

@Injectable()
export class SavedViewsService {
  private readonly logger = new Logger(SavedViewsService.name);

  constructor(
    @InjectRepository(SavedView) private readonly views: Repository<SavedView>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
  ) {}

  // Asegura que las vistas del sistema existan (upsert por nombre: si ya existe,
  // actualiza prio/condición para reflejar cambios del seed).
  async ensureSeed(): Promise<void> {
    for (const s of SEED) {
      const exists = await this.views.findOne({ where: { name: s.name } });
      if (!exists) {
        await this.views.save(
          this.views.create({
            name: s.name,
            prio: s.prio,
            condition: s.condition,
            userScoped: !!s.userScoped,
            builtin: true,
          }),
        );
      } else {
        // Actualizar si cambió la condición (idempotente, refleja el seed actual).
        const changed =
          exists.prio !== s.prio ||
          exists.userScoped !== !!s.userScoped ||
          JSON.stringify(exists.condition || {}) !== JSON.stringify(s.condition);
        if (changed) {
          exists.prio = s.prio;
          exists.userScoped = !!s.userScoped;
          exists.condition = s.condition;
          await this.views.save(exists);
        }
      }
    }
  }

  async list(actor: AuthenticatedUser): Promise<SavedViewWithCount[]> {
    await this.ensureSeed();
    const views = await this.views.find({ order: { prio: 'ASC', name: 'ASC' } });
    // Conteos por vista (respetando si es userScoped -> técnico actual).
    const result: SavedViewWithCount[] = [];
    for (const v of views) {
      result.push({
        id: v.id,
        name: v.name,
        prio: v.prio,
        userScoped: v.userScoped,
        count: await this.countTickets(v, actor),
      });
    }
    return result;
  }

  // Devuelve la vista por id, o null.
  async findOne(id: string): Promise<SavedView | null> {
    await this.ensureSeed();
    return this.views.findOne({ where: { id } });
  }

  // Aplica la condición de una vista a un QueryBuilder de tickets (compatible con
  // el que usa TicketsService.findAll). Devuelve el mismo qb para encadenar.
  applyCondition<T extends SelectQueryBuilder<ObjectLiteral>>(
    qb: T,
    view: SavedView,
    actor: AuthenticatedUser,
  ): T {
    const c: SavedViewCondition = view.condition || {};
    if (c.statusIn?.length) {
      qb.andWhere('t.status IN (:...vStatus)', { vStatus: c.statusIn });
    }
    if (c.ownerIsNull) {
      qb.andWhere('t.technician_id IS NULL');
    }
    if (c.ownerIsCurrentUser) {
      // "asignado a mí": se compara contra el perfil de técnico del usuario. Si el
      // usuario no es técnico (no tiene technicianId) -> no matchea nada.
      qb.andWhere(c.statusIn?.length ? 't.technician_id = :vOwner' : 't.technician_id = :vOwner', {
        vOwner: actor.technicianId || null,
      });
      if (!actor.technicianId) {
        // No-técnico: forzar 0 resultados.
        qb.andWhere('1 = 0');
      }
    }
    if (c.senderContains) {
      // Remitente: existe un mensaje del ticket cuyo fromEmail contiene el texto
      // (equivale a article.from en Zammad). Se combina en OR con legacyGroupIn
      // (si ambos están definidos) para que la vista capture por remitente O por
      // grupo legacy. Así se unifica la bandeja "Backups MK" sin perder los
      // tickets migrados de Zammad que no tienen mensaje de mkbackups@.
      const senderCond = `EXISTS (
        SELECT 1 FROM ticket_messages fm
        WHERE fm.ticket_id = t.id
          AND fm."fromEmail" ILIKE :vSender
      )`;
      if (c.legacyGroupIn?.length) {
        qb.andWhere(`(${senderCond} OR t.legacy_group IN (:...vLegacy))`, {
          vSender: `%${c.senderContains}%`,
          vLegacy: c.legacyGroupIn,
        });
      } else {
        qb.andWhere(senderCond, { vSender: `%${c.senderContains}%` });
      }
    } else if (c.legacyGroupIn?.length) {
      qb.andWhere('t.legacy_group IN (:...vLegacy)', { vLegacy: c.legacyGroupIn });
    }
    if (c.titleContains) {
      qb.andWhere('(t.title ILIKE :vTitle OR t.subject_key ILIKE :vTitle)', {
        vTitle: `%${c.titleContains}%`,
      });
    }
    if (c.titleNotContains) {
      qb.andWhere('(t.title NOT ILIKE :vNotTitle OR t.subject_key NOT ILIKE :vNotTitle)', {
        vNotTitle: `%${c.titleNotContains}%`,
      });
    }
    return qb;
  }

  private async countTickets(view: SavedView, actor: AuthenticatedUser): Promise<number> {
    const qb = this.tickets.createQueryBuilder('t');
    this.applyCondition(qb, view, actor);
    qb.andWhere('t.shadow = :sh', { sh: false });
    return qb.getCount();
  }
}

