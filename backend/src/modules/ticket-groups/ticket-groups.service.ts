import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { Ticket } from '../../entities/ticket.entity';
import { MailboxRule } from '../../entities/mailbox-rule.entity';
import { CreateTicketGroupDto, UpdateTicketGroupDto, DeactivateTicketGroupDto } from './ticket-groups.dto';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

// CRUD del catálogo de "boxes" (grupos de tickets). Un box es la fila de
// catálogo; el valor de tickets.legacy_group es el string que coincide con
// box.name.
//
// moduleKey: un box puede ser el destino de un módulo (p.ej. 'workshop'). Cuando
// un módulo crea un ticket, busca el box activo con su moduleKey y le setea
// tickets.legacy_group = box.name. Solo puede haber un box ACTIVO por moduleKey
// (índice único parcial en la BD + validación acá con mensaje claro).
@Injectable()
export class TicketGroupsService {
  constructor(
    @InjectRepository(TicketGroup) private readonly groups: Repository<TicketGroup>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(MailboxRule) private readonly mailboxRules: Repository<MailboxRule>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<TicketGroup[]> {
    return this.groups.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  findOne(id: string): Promise<TicketGroup | null> {
    return this.groups.findOne({ where: { id } });
  }

  // Box activo que sirve de destino a un módulo. Lo usan los módulos que crean
  // tickets (p.ej. Taller) para setear tickets.legacy_group = box.name.
  findActiveByModuleKey(moduleKey: string): Promise<TicketGroup | null> {
    return this.groups.findOne({ where: { moduleKey, active: true } });
  }

  // Valida que ningún OTRO box activo tenga ya el moduleKey (además del índice
  // único parcial de la BD). Devuelve el box que lo tiene, si existe.
  private async moduleKeyConflict(moduleKey: string | null | undefined, exceptId?: string): Promise<TicketGroup | null> {
    if (!moduleKey) return null;
    const existing = await this.groups.findOne({ where: { moduleKey, active: true } });
    if (existing && existing.id !== exceptId) return existing;
    return null;
  }

  // Conteo de tickets y de reglas de mailbox por box, para que el panel de admin
  // muestre el impacto al desactivar. ticketCount = tickets cuyo legacy_group
  // coincide con box.name; ruleCount = reglas de mailbox con target_group_id = box.id.
  private async counts(group: TicketGroup): Promise<{ ticketCount: number; ruleCount: number }> {
    const [ticketCount, ruleCount] = await Promise.all([
      this.tickets.count({ where: { legacyGroup: group.name } }),
      this.mailboxRules.count({ where: { targetGroupId: group.id } }),
    ]);
    return { ticketCount, ruleCount };
  }

  async listWithCounts(): Promise<Array<TicketGroup & { ticketCount: number; ruleCount: number }>> {
    const groups = await this.groups.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    return Promise.all(groups.map(async (g) => ({ ...g, ...(await this.counts(g)) })));
  }

  async findOneWithCounts(id: string): Promise<(TicketGroup & { ticketCount: number; ruleCount: number }) | null> {
    const g = await this.groups.findOne({ where: { id } });
    if (!g) return null;
    return { ...g, ...(await this.counts(g)) };
  }

  async create(dto: CreateTicketGroupDto, actor: AuthenticatedUser): Promise<TicketGroup> {
    const name = (dto.name || '').trim();
    if (!name) throw new BadRequestException('El nombre del box es obligatorio');
    const dup = await this.groups.findOne({ where: { name } });
    if (dup) throw new BadRequestException(`Ya existe un box llamado "${name}"`);
    const conflict = await this.moduleKeyConflict(dto.moduleKey);
    if (conflict) {
      throw new BadRequestException(`El módulo ya está asignado al box "${conflict.name}".`);
    }
    const saved = await this.groups.save(
      this.groups.create({
        name,
        color: dto.color ?? null,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        moduleKey: dto.moduleKey ?? null,
      }),
    );
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TICKET_GROUP,
      entityId: saved.id,
      newValue: { name: saved.name, sortOrder: saved.sortOrder, moduleKey: saved.moduleKey },
    });
    return saved;
  }

  async update(id: string, dto: UpdateTicketGroupDto, actor: AuthenticatedUser): Promise<TicketGroup> {
    const group = await this.groups.findOne({ where: { id } });
    if (!group) throw new NotFoundException('Box no encontrado');
    const old = { name: group.name, color: group.color, sortOrder: group.sortOrder, active: group.active, moduleKey: group.moduleKey };
    if (dto.name !== undefined) {
      const name = (dto.name || '').trim();
      if (!name) throw new BadRequestException('El nombre del box es obligatorio');
      const dup = await this.groups.findOne({ where: { name } });
      if (dup && dup.id !== id) throw new BadRequestException(`Ya existe un box llamado "${name}"`);
      group.name = name;
    }
    if (dto.color !== undefined) group.color = dto.color ?? null;
    if (dto.sortOrder !== undefined) group.sortOrder = dto.sortOrder;
    if (dto.active !== undefined) group.active = dto.active;
    if (dto.moduleKey !== undefined) {
      const conflict = await this.moduleKeyConflict(dto.moduleKey, id);
      if (conflict) {
        throw new BadRequestException(`El módulo ya está asignado al box "${conflict.name}".`);
      }
      group.moduleKey = dto.moduleKey ?? null;
    }
    const saved = await this.groups.save(group);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TICKET_GROUP,
      entityId: id,
      oldValue: old,
      newValue: { name: saved.name, color: saved.color, sortOrder: saved.sortOrder, active: saved.active, moduleKey: saved.moduleKey },
    });
    return saved;
  }

  // Soft-delete con fallback obligatorio. Desactiva el box (no borra la fila),
  // pero antes mueve todos sus tickets al box fallback elegido y reapunta las
  // reglas de mailbox que apuntaban a este box. Todo dentro de una transacción
  // para que el box no quede desactivado a medias si algo falla.
  async deactivate(id: string, dto: DeactivateTicketGroupDto, actor: AuthenticatedUser): Promise<{ ok: true; movedTickets: number; reroutedRules: number; moduleKeyTransferred?: string | null }> {
    if (!dto?.fallbackGroupId) {
      throw new BadRequestException('Se requiere un box de destino (fallback) para los tickets existentes.');
    }
    const group = await this.groups.findOne({ where: { id } });
    if (!group) throw new NotFoundException('Box no encontrado');
    if (dto.fallbackGroupId === id) {
      throw new BadRequestException('El box de destino debe ser distinto del box que se está desactivando.');
    }
    const fallback = await this.groups.findOne({ where: { id: dto.fallbackGroupId } });
    if (!fallback) throw new NotFoundException('Box de destino no encontrado');
    if (!fallback.active) throw new BadRequestException('El box de destino está desactivado.');

    // Si el box a desactivar tiene moduleKey, el fallback no debe tener otro
    // moduleKey distinto (solo puede haber un box activo por moduleKey).
    if (group.moduleKey && fallback.moduleKey && fallback.moduleKey !== group.moduleKey) {
      throw new BadRequestException(
        `El box de destino "${fallback.name}" ya tiene el módulo "${fallback.moduleKey}" asignado; elegí un fallback sin módulo en conflicto.`,
      );
    }

    // Ejecuta el movimiento en transacción: tickets + reglas + moduleKey + desactivar.
    return this.dataSource.transaction(async (mgr) => {
      const groupRepo = mgr.getRepository(TicketGroup);

      // 1) Tickets del box a desactivar -> box fallback.
      const ticketRepo = mgr.getRepository(Ticket);
      const ticketsInGroup = await ticketRepo.find({ where: { legacyGroup: group.name } });
      let movedTickets = 0;
      for (const ticket of ticketsInGroup) {
        if (ticket.legacyGroup === fallback.name) continue;
        const oldGroup = ticket.legacyGroup;
        ticket.legacyGroup = fallback.name;
        await ticketRepo.save(ticket);
        movedTickets++;
        await this.audit.log({
          user: actor,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TICKET,
          entityId: ticket.id,
          oldValue: { legacyGroup: oldGroup },
          newValue: { legacyGroup: fallback.name },
          meta: {
            action: 'bulk_move',
            reason: 'box_deactivated',
            fromGroupId: group.id,
            fromGroupName: group.name,
            toGroupId: fallback.id,
            toGroupName: fallback.name,
          },
        });
      }

      // 2) Reglas de mailbox que apuntaban al box a desactivar -> box fallback.
      const ruleRepo = mgr.getRepository(MailboxRule);
      const rulesToReroute = await ruleRepo.find({ where: { targetGroupId: id } });
      let reroutedRules = 0;
      for (const rule of rulesToReroute) {
        rule.targetGroupId = fallback.id;
        await ruleRepo.save(rule);
        reroutedRules++;
        await this.audit.log({
          user: actor,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.MAILBOX_RULE,
          entityId: rule.id,
          oldValue: { targetGroupId: id, targetGroupName: group.name },
          newValue: { targetGroupId: fallback.id, targetGroupName: fallback.name },
          meta: { reason: 'box_deactivated', fromGroupId: group.id, toGroupId: fallback.id },
        });
      }

      // 3) Transferir el moduleKey del box a desactivar al fallback (si lo tiene).
      //    Primero se limpia en el origen para no violar el índice único parcial
      //    (mientras ambos estén activos). Luego se asigna al fallback.
      let moduleKeyTransferred: string | null = null;
      if (group.moduleKey) {
        const mk = group.moduleKey;
        group.moduleKey = null;
        await groupRepo.save(group);
        fallback.moduleKey = mk;
        await groupRepo.save(fallback);
        moduleKeyTransferred = mk;
        await this.audit.log({
          user: actor,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TICKET_GROUP,
          entityId: fallback.id,
          oldValue: { moduleKey: null },
          newValue: { moduleKey: mk },
          meta: { reason: 'module_key_transferred_on_deactivate', fromGroupId: group.id, fromGroupName: group.name },
        });
      }

      // 4) Desactivar el box original (recién después de mover todo).
      group.active = false;
      await groupRepo.save(group);
      await this.audit.log({
        user: actor,
        action: AuditAction.DELETE,
        entityType: AuditEntityType.TICKET_GROUP,
        entityId: id,
        oldValue: { active: true },
        newValue: { active: false },
        meta: {
          softDelete: true,
          fallbackGroupId: fallback.id,
          fallbackGroupName: fallback.name,
          movedTickets,
          reroutedRules,
          moduleKeyTransferred,
        },
      });

      return { ok: true, movedTickets, reroutedRules, moduleKeyTransferred };
    });
  }
}
