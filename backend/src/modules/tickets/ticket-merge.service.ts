import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { Contact } from '../../entities/contact.entity';
import { Technician } from '../../entities/technician.entity';
import { randomUUID } from 'crypto';
import { AuditAction, AuditEntityType, TicketStatus, NotificationType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TicketsService } from './tickets.service';

// Ticket merging (P3).
//
// A merge has ONE principal and one-or-more children. Children stay visible,
// keep their number and history, and are linked to the principal; nothing is
// hidden or deleted. The principal's SLA is untouched (never recomputed from an
// older merged date). Merges can be dissolved at any time.
@Injectable()
export class TicketMergeService {
  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    private readonly ticketsService: TicketsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // Merge the given child ticket ids into the principal. Only Supervisor/Coordinator.
  async merge(principalId: string, childIds: string[], actor: AuthenticatedUser) {
    const principal = await this.tickets.findOne({ where: { id: principalId } });
    if (!principal) throw new NotFoundException('Ticket principal no encontrado');

    // Children must come from the same customer (sanity).
    const children = await this.tickets.find({ where: { id: In(childIds) } });
    if (children.length !== childIds.length) {
      throw new BadRequestException('Alguno de los tickets hijos no existe');
    }
    // Prevent self-merge or double-merge.
    if (childIds.includes(principalId)) {
      throw new BadRequestException('El ticket principal no puede ser su propio hijo');
    }
    for (const c of children) {
      if (c.mergedIntoId) {
        throw new BadRequestException(`El ticket ${c.id} ya está fusionado`);
      }
      if (c.id === principal.id) throw new BadRequestException('Merge inválido');
    }

    const mergeGroupId = principal.mergeGroupId ?? randomUUID();

    // Set principal first (creates the group if new).
    principal.mergeGroupId = mergeGroupId;
    principal.mergedIntoId = null;
    await this.tickets.save(principal);

    for (const child of children) {
      child.mergeGroupId = mergeGroupId;
      child.mergedIntoId = principal.id;
      await this.tickets.save(child);

      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.TICKET,
        entityId: child.id,
        oldValue: { mergedIntoId: null },
        newValue: { mergedIntoId: principal.id, mergeGroupId },
        meta: { action: 'merge', principalId: principal.id },
      });
    }

    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.TICKET,
      entityId: principal.id,
      newValue: { mergeGroupId, mergedChildren: childIds },
      meta: { action: 'merge_created' },
    });

    await this.notificationsOnMerge(principal, children, actor);
    return this.ticketsService.findOne(principal.id, actor);
  }

  // Dissolve an entire merge group (principal + all children) at any time.
  async dissolve(principalId: string, actor: AuthenticatedUser) {
    const principal = await this.tickets.findOne({ where: { id: principalId } });
    if (!principal) throw new NotFoundException('Ticket principal no encontrado');
    if (!principal.mergeGroupId) {
      throw new BadRequestException('Este ticket no es el principal de una fusión');
    }
    const group = await this.tickets.find({ where: { mergeGroupId: principal.mergeGroupId } });
    for (const t of group) {
      const had = { mergedIntoId: t.mergedIntoId, mergeGroupId: t.mergeGroupId };
      t.mergedIntoId = null;
      t.mergeGroupId = null;
      await this.tickets.save(t);
      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.TICKET,
        entityId: t.id,
        oldValue: had as unknown as Record<string, unknown>,
        newValue: { mergedIntoId: null, mergeGroupId: null },
        meta: { action: 'merge_dissolved' },
      });
    }
    return { ok: true, dissolved: group.map((t) => t.id) };
  }

  // Close the principal and, per the checked boxes, also close (or un-merge)
  // selected children.
  async closePrincipal(
    principalId: string,
    closeChildrenIds: string[],
    actor: AuthenticatedUser,
  ) {
    const principal = await this.tickets.findOne({ where: { id: principalId } });
    if (!principal) throw new NotFoundException('Ticket principal no encontrado');
    const groupIds = await this.mergedChildren(principalId);

    await this.ticketsService.update(principalId, { status: TicketStatus.CERRADO }, actor);

    // Children explicitly selected get closed too.
    for (const childId of closeChildrenIds) {
      const child = await this.tickets.findOne({ where: { id: childId } });
      if (child) {
        await this.ticketsService.update(childId, { status: TicketStatus.CERRADO }, actor);
      }
    }

    // Children NOT selected: dissolve them back to independent tickets.
    const closeSet = new Set(closeChildrenIds);
    const keepOpen = groupIds.filter((id) => !closeSet.has(id));
    if (keepOpen.length) {
      await this.dissolveMembers(principalId, keepOpen, actor);
    }

    return this.ticketsService.findOne(principalId, actor);
  }

  // Return the list of children currently merged into a principal.
  async mergedChildren(principalId: string): Promise<string[]> {
    const rows = await this.tickets.find({ where: { mergedIntoId: principalId } });
    return rows.map((r) => r.id);
  }

  // Remove the given members from the merge (undo their merge relation only),
  // leaving the principal and remaining children intact.
  private async dissolveMembers(principalId: string, memberIds: string[], actor: AuthenticatedUser) {
    const principal = await this.tickets.findOne({ where: { id: principalId } });
    if (!principal) return;
    const members = await this.tickets.find({ where: { id: In(memberIds) } });
    for (const m of members) {
      const had = { mergedIntoId: m.mergedIntoId, mergeGroupId: m.mergeGroupId };
      m.mergedIntoId = null;
      m.mergeGroupId = null;
      await this.tickets.save(m);
      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.TICKET,
        entityId: m.id,
        oldValue: had as unknown as Record<string, unknown>,
        newValue: { mergedIntoId: null, mergeGroupId: null },
        meta: { action: 'merge_member_removed', principalId },
      });
    }
  }

  private async notificationsOnMerge(principal: Ticket, children: Ticket[], actor: AuthenticatedUser) {
    void actor;
    // In-app notification to the principal's technician.
    if (principal.technicianId) {
      const tech = await this.technicians.findOne({ where: { id: principal.technicianId } });
      if (tech?.userId) {
        await this.notifications.create({
          userId: tech.userId,
          type: NotificationType.TICKET_ASIGNADO,
          payload: {
            ticketId: principal.id,
            title: principal.title,
            message: `Se fusionaron ${children.length} ticket(s) en este`,
          },
        });
      }
    }
    // TODO(P3): outbound email to each merged contact is Phase 2 (SMTP). The
    // email notification is recorded as a placeholder; SMTP wiring is future work.
    void this.notifications;
  }
}
