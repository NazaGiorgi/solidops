import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder, ObjectLiteral, In, DataSource } from 'typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { Contact } from '../../entities/contact.entity';
import { TicketAttachment } from '../../entities/ticket-attachment.entity';
import { Sla } from '../../entities/sla.entity';
import { Customer } from '../../entities/customer.entity';
import { Contract } from '../../entities/contract.entity';
import { Technician } from '../../entities/technician.entity';
import { User } from '../../entities/user.entity';
import { SavedViewsService } from './saved-views.service';
import { SavedView } from '../../entities/saved-view.entity';
import { WorkshopEquipment } from '../../entities/workshop-equipment.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { PARTICULARS_BUCKET_NAME } from '../workshop/workshop.service';
import {
  CreateTicketDto,
  UpdateTicketDto,
  AddMessageDto,
  AssignTicketDto,
  ListTicketsQuery,
} from './dto';
import {
  TicketStatus,
  TicketPriority,
  AuditAction,
  AuditEntityType,
  SlaStatus,
  NotificationType,
  TicketChannel,
  TicketAuthorType,
} from '../../common/enums';
import { SlaService } from './sla.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { MailService } from '../mail/mail.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { normalizeSubjectKey } from '../../common/utils/subject-key.util';
import { publicTicketNumber } from '../../common/utils/ticket-number.util';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
    @InjectRepository(TicketAttachment) private readonly attachments: Repository<TicketAttachment>,
    @InjectRepository(Sla) private readonly slas: Repository<Sla>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    @InjectRepository(Technician) private readonly technicians: Repository<Technician>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(WorkshopEquipment) private readonly workshopEq: Repository<WorkshopEquipment>,
    @InjectRepository(TicketGroup) private readonly groups: Repository<TicketGroup>,
    private readonly slaService: SlaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gateway: NotificationsGateway,
    private readonly mail: MailService,
    private readonly savedViews: SavedViewsService,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => WhatsappService)) private readonly whatsapp: WhatsappService,
  ) {}

  private listQuery() {
    return this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.customer', 'customer')
      .leftJoinAndSelect('t.contact', 'contact')
      .leftJoinAndSelect('t.site', 'site')
      .leftJoinAndSelect('t.technician', 'technician')
      .leftJoinAndSelect('technician.user', 'techUser')
      .leftJoinAndSelect('t.slaRecords', 'sla')
      .orderBy('t.createdAt', 'DESC');
  }

  // Siguiente número de ticket de la secuencia global (ticket_number_seq).
  // Usa nextval() de Postgres (a prueba de concurrencia), no máximo+1 manual.
  async nextTicketNumber(): Promise<number> {
    const [row] = await this.dataSource.query(`SELECT nextval('ticket_number_seq') AS n`);
    return Number(row.n);
  }

  // Shared row-level scoping based on role. Fase-1 requirement: ALL users can
  // see ALL tickets except read-only/Consulta users.
  //  - Supervisors/admins (has tickets:assign) see everything.
  //  - Any user WITH a technician profile sees EVERY ticket (not only theirs);
  //    their own are highlighted client-side via technicianId.
  //  - A non-technician, non-supervisor (e.g. Consulta) sees only tickets they created.
  private applyRowScope<T extends SelectQueryBuilder<ObjectLiteral>>(qb: T, actor: AuthenticatedUser) {
    if (!actor.permissions.includes('tickets:assign') && !actor.technicianId) {
      qb.andWhere('t.created_by_user_id = :uid', { uid: actor.id });
    }
  }

  async findAll(query: ListTicketsQuery, actor: AuthenticatedUser) {
    const qb = this.listQuery();
    if (query.status) qb.andWhere('t.status IN (:...statuses)', { statuses: query.status.split(',') });
    if (query.priority) qb.andWhere('t.priority = :priority', { priority: query.priority });
    if (query.customerId) qb.andWhere('t.customer_id = :customerId', { customerId: query.customerId });
    if (query.technicianId) qb.andWhere('t.technician_id = :technicianId', { technicianId: query.technicianId });
    if (query.contactId) qb.andWhere('t.contact_id = :contactId', { contactId: query.contactId });
    if (query.search) {
      qb.andWhere(
        '(t.title ILIKE :search OR t.subject_key ILIKE :search OR t.ticket_number::text ILIKE :search OR (' +
        "'TK-' || EXTRACT(YEAR FROM t.created_at)::int || '-' || t.ticket_number) ILIKE :search)",
        {
          search: `%${query.search}%`,
        },
      );
    }

    // "Bandeja" filter: by default the operational view hides the migrated noise
    // groups (Users/Backups MK/Taller/Ventas). The user can switch trays in the UI.
    // Si se pide una vista guardada (?view=<id>), la bandeja NO se aplica: la vista
    // trae su propia condición (evita la intersección vacía con el default support).
    const SUPPORT = ['L1', 'L2', 'L3'];
    const NOISE = ['Users', 'Backups MK', 'Taller', 'Ventas'];
    const tray = query.view ? 'all' : (query.tray || 'support');
    if (tray === 'support') {
      // Native tickets (no legacy_group) + the real support groups.
      qb.andWhere('(t.legacy_group IS NULL OR t.legacy_group IN (:...support))', {
        support: SUPPORT,
      });
    } else if (tray === 'general') {
      qb.andWhere('t.legacy_group IN (:...noise)', { noise: NOISE });
    } else if (tray === 'nativo') {
      // Tickets creados directamente en SolidOps (sin legacy_group).
      qb.andWhere('t.legacy_group IS NULL');
    } else if (tray !== 'all') {
      // A specific group name.
      qb.andWhere('t.legacy_group = :tray', { tray });
    }

    // Vista guardada (replica de las Overviews de Zammad): aplica su condición.
    // Se combina (AND) con el resto de filtros (status, tray, etc.).
    if (query.view) {
      const view = await this.savedViews.findOne(query.view);
      if (!view) throw new NotFoundException('Vista no encontrada');
      this.savedViews.applyCondition(qb, view, actor);
    }

    // Merge-state filter. 'parents' = principal with children (has merge group,
    // not itself a child); 'children' = merged into another; 'exclude' = never
    // merged (neither a child nor a principal).
    if (query.merge === 'parents') {
      qb.andWhere('t.merge_group_id IS NOT NULL AND t.merged_into_id IS NULL');
    } else if (query.merge === 'children') {
      qb.andWhere('t.merged_into_id IS NOT NULL');
    } else if (query.merge === 'exclude') {
      qb.andWhere('t.merge_group_id IS NULL AND t.merged_into_id IS NULL');
    }

    // Shadow-mode tickets are isolated from the operational list. Only shown
    // when explicitly requested (shadow=true), which the admin shadow view uses.
    if (query.shadow === 'true') {
      qb.andWhere('t.shadow = :sh', { sh: true });
    } else if (query.shadow === 'false') {
      qb.andWhere('t.shadow = :sh', { sh: false });
    } else {
      qb.andWhere('t.shadow = :sh', { sh: false });
    }

    // Row-level scope for non-supervisory roles: only see their own tickets,
    // unless they explicitly lack TICKETS_READ-all (supervisors/admins see all).
    this.applyRowScope(qb, actor);

    // Paginación. Default: 100 por página. Sin paginar, la bandeja "Users"
    // (39.057 tickets) devolvía ~48MB y ~3s (getMany traía TODO + 5 joins + SLA
    // en JS por fila). Con paginación el frontend trae solo una página y sabe
    // cuántos hay en total (total) para el paginador.
    const page = query.page ?? 1;
    const take = query.take ?? 100;
    const skip = (page - 1) * take;
    const total = await qb.getCount();
    const rows = await qb.skip(skip).take(take).getMany();

    // Enlace a Taller: si el ticket está vinculado a un equipo del Taller (un
    // ticket de recepción de equipo), se resuelve por lotes el id del equipo y
    // el nombre del contacto real (para el bucket de particulares).
    const workshopByTicketId = await this.workshopLinksForTickets(rows.map((t) => t.id));

    // Flatten: attach the most recent SLA status for display.
    const items = rows.map((t) => {
      const latestSla = t.slaRecords?.[0] ?? null;
      const { sla, status } = this.slaService.compute(t, null);
      void sla;
      return { ...t, slaStatus: latestSla?.status ?? status, workshop: workshopByTicketId.get(t.id) ?? null };
    });
    return { items, total, page, pageSize: take };
  }

  // Lightweight attention counters for the sidebar badge, scoped to the same
  // row-level visibility as findAll (own tickets for technicians, all for
  // supervisors/admins).
  async attentionCounts(actor: AuthenticatedUser) {
    const qb = this.tickets
      .createQueryBuilder('t')
      .where('t.shadow = :sh', { sh: false })
      .select('COUNT(*)', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE t.status IN ('nuevo','abierto','asignado','en_progreso','esperando_cliente'))`, 'open')
      .addSelect(`COUNT(*) FILTER (WHERE t.status IN ('nuevo','abierto'))`, 'new')
      .addSelect(`COUNT(*) FILTER (WHERE t.priority = 'critica' AND t.status IN ('nuevo','abierto','asignado','en_progreso','esperando_cliente'))`, 'critical');

    this.applyRowScope(qb, actor);
    const row = await qb.getRawOne<{ total: string; open: string; new: string; critical: string }>();
    return {
      open: Number(row?.open ?? 0),
      new: Number(row?.new ?? 0),
      critical: Number(row?.critical ?? 0),
      total: Number(row?.total ?? 0),
    };
  }

  // Conteo de tickets por bandeja (legacy_group + nativos), para la navegación
  // del menú lateral. Respetando la visibilidad por rol (applyRowScope) y con la
  // misma semántica de "bandeja" del filtro (tray).
  async groupCounts(actor: AuthenticatedUser): Promise<Array<{ tray: string; count: number }>> {
    const qb = this.tickets
      .createQueryBuilder('t')
      .where('t.shadow = :sh', { sh: false })
      .select('COALESCE(t.legacy_group, \'nativo\')', 'tray')
      .addSelect('COUNT(*)', 'count')
      .groupBy('COALESCE(t.legacy_group, \'nativo\')')
      .orderBy('COUNT(*)', 'DESC');

    // Misma visibilidad de fila que findAll (técnico ve solo sus tickets).
    this.applyRowScope(qb, actor);

    const rows = await qb.getRawMany<{ tray: string; count: string }>();
    return rows.map((r) => ({ tray: r.tray, count: Number(r.count) }));
  }

  async findOne(id: string, actor: AuthenticatedUser) {
    const t = await this.listQuery()
      .where('t.id = :id', { id })
      .leftJoinAndSelect('t.messages', 'messages')
      .leftJoinAndSelect('messages.attachments', 'attachments')
      .getOne();
    if (!t) throw new NotFoundException('Ticket no encontrado');

    // Row-level guard: only own tickets for non-supervisors.
    // Row-level guard: technicians/supervisors see any ticket; only a
    // non-technician, non-supervisor (Consulta) is limited to their own.
    if (!actor.permissions.includes('tickets:assign') && !actor.technicianId) {
      if (t.createdByUserId !== actor.id) {
        throw new NotFoundException('Ticket no encontrado');
      }
    }

    const contract = await this.findActiveContract(t.customerId);
    const { sla, status } = this.slaService.compute(t, contract);

    // P3: if this ticket is the principal of a merge, include its merged
    // children and their conversation so the technician sees full context in
    // one place. Histories are LINKED (not moved), so dissolving is lossless.
    let mergedChildren: Ticket[] = [];
    let mergedMessages: TicketMessage[] = [];
    if (t.mergeGroupId) {
      mergedChildren = await this.tickets.find({
        where: { mergedIntoId: t.id },
        order: { createdAt: 'ASC' },
      });
      const childIds = mergedChildren.map((c) => c.id);
      if (childIds.length) {
        mergedMessages = await this.messages
          .createQueryBuilder('m')
          .leftJoinAndSelect('m.attachments', 'attachments')
          .where('m.ticket_id IN (:...ids)', { ids: childIds })
          .orderBy('m.createdAt', 'ASC')
          .getMany();
      }
    }

    return {
      ...t,
      sla: { ...sla, status },
      mergedChildren,
      mergedMessages,
      workshop: (await this.workshopLinksForTickets([t.id])).get(t.id) ?? null,
    };
  }

  // Resuelve el enlace a Taller para un conjunto de ticket ids: devuelve por
  // cada ticket con equipo asociado `{ equipmentId, contactName }`.
  // `contactName` es el nombre del contacto del equipo, que para un cliente
  // particular (el nombre del Customer es el bucket genérico) es la persona real.
  private async workshopLinksForTickets(
    ticketIds: string[],
  ): Promise<Map<string, { equipmentId: string; contactName: string | null }>> {
    const result = new Map<string, { equipmentId: string; contactName: string | null }>();
    if (ticketIds.length === 0) return result;

    const equipments = await this.workshopEq
      .createQueryBuilder('e')
      .select(['e.id', 'e.ticketId', 'e.customerId', 'e.contactId', 'e.customerLabel'])
      .where('e.ticketId IN (:...ids)', { ids: ticketIds })
      .getMany();

    // Nombres de contacto y de cliente por lote, para decidir a quién mostrar.
    const contactIds = [...new Set(equipments.map((e) => e.contactId).filter(Boolean) as string[])];
    const customerIds = [...new Set(equipments.map((e) => e.customerId).filter(Boolean))];
    const contactNames = contactIds.length
      ? new Map<string, string>(
          (
            await this.contacts
              .createQueryBuilder('cc')
              .select(['cc.id', 'cc.name'])
              .where('cc.id IN (:...ids)', { ids: contactIds })
              .getMany()
          ).map((c) => [c.id, c.name]),
        )
      : new Map<string, string>();
    const customerNames = customerIds.length
      ? new Map<string, string>(
          (
            await this.customers
              .createQueryBuilder('cu')
              .select(['cu.id', 'cu.name'])
              .where('cu.id IN (:...ids)', { ids: customerIds })
              .getMany()
          ).map((c) => [c.id, c.name]),
        )
      : new Map<string, string>();

    for (const eq of equipments) {
      if (!eq.ticketId) continue;
      const customerName = customerNames.get(eq.customerId) || eq.customerLabel || null;
      const isParticular = customerName === PARTICULARS_BUCKET_NAME;
      const contactName =
        isParticular && eq.contactId && contactNames.has(eq.contactId)
          ? contactNames.get(eq.contactId)!
          : customerName;
      result.set(eq.ticketId, { equipmentId: eq.id, contactName });
    }
    return result;
  }

  async create(dto: CreateTicketDto, actor: AuthenticatedUser): Promise<Ticket> {
    // Validate customer + active contract for SLA.
    const customer = await this.customers.findOne({ where: { id: dto.customerId } });
    if (!customer) throw new BadRequestException('Cliente no encontrado');

    const ticket = this.tickets.create({
      customerId: dto.customerId,
      contactId: dto.contactId ?? null,
      siteId: dto.siteId ?? null,
      technicianId: dto.technicianId ?? null,
      createdByUserId: actor.id,
      title: dto.title,
      description: dto.description ?? null,
      status: dto.status ?? TicketStatus.NUEVO,
      priority: dto.priority ?? TicketPriority.NORMAL,
      category: dto.category ?? null,
      source: 'manual',
      subjectKey: normalizeSubjectKey(dto.title),
      ticketNumber: await this.nextTicketNumber(),
      firstResponseAt: null,
      resolvedAt: null,
    });
    const saved = await this.tickets.save(ticket);

    await this.emitNewTicketBroadcast(saved);

    const contract = await this.findActiveContract(dto.customerId);
    await this.refreshSla(saved, contract);

    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TICKET,
      entityId: saved.id,
      newValue: { title: saved.title, priority: saved.priority, status: saved.status },
    });

    if (dto.technicianId) {
      await this.notifyAssignee(dto.technicianId, saved.id, saved.title);
    }

    // Mail "ticket recibido" para tickets creados DE FORMA MANUAL (p.ej. un técnico
    // carga un ticket tras un llamado telefónico). Requiere contacto/cliente con
    // email; si no hay, se omite sin error.
    await this.maybeSendReceivedOnCreate(saved);

    return this.findOne(saved.id, actor);
  }

  // Envía la plantilla "recibimos tu solicitud" cuando se crea un ticket manual con
  // un contacto que tiene email. Condicionado al toggle (lo valida MailService).
  private async maybeSendReceivedOnCreate(t: Ticket): Promise<void> {
    try {
      if (!t.contactId) return;
      const contact = await this.contacts.findOne({ where: { id: t.contactId } });
      const to = contact?.email;
      if (!to) return;

      const ticketNumber = publicTicketNumber(t.ticketNumber, t.createdAt);
      const portalUrl = process.env.PORTAL_URL || 'http://localhost:3000/portal/login';

      await this.mail.sendTicketCreatedManual(to, { ticketNumber, portalUrl });
      this.logger.log(`[AUTO-RESP] Ticket recibido (manual) enviado a ${to} (ticket ${t.id})`);
    } catch (e) {
      this.logger.error(`[AUTO-RESP] Falló el envío (manual) a: ${(e as Error).message}`);
    }
  }

  async update(id: string, dto: UpdateTicketDto, actor: AuthenticatedUser): Promise<Ticket> {
    const t = await this.tickets.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket no encontrado');

    const old = {
      title: t.title,
      description: t.description,
      category: t.category,
      status: t.status,
      priority: t.priority,
      technicianId: t.technicianId,
      contactId: t.contactId,
      siteId: t.siteId,
    };

    const priorTech = t.technicianId;

    if (dto.title !== undefined) t.title = dto.title;
    if (dto.description !== undefined) t.description = dto.description;
    if (dto.category !== undefined) t.category = dto.category;
    if (dto.contactId !== undefined) t.contactId = dto.contactId;
    if (dto.siteId !== undefined) t.siteId = dto.siteId;
    if (dto.priority !== undefined) t.priority = dto.priority;
    if (dto.technicianId !== undefined) t.technicianId = dto.technicianId;
    if (dto.status !== undefined) {
      t.status = dto.status;
      if (dto.status === TicketStatus.RESUELTO || dto.status === TicketStatus.CERRADO) {
        t.resolvedAt = t.resolvedAt ?? new Date();
        if (dto.status === TicketStatus.CERRADO) t.resolvedAt = new Date();
      } else {
        t.resolvedAt = null;
      }
    }

    await this.tickets.save(t);

    // Refresh SLA & emit domain audit events for meaningful changes.
    const contract = await this.findActiveContract(t.customerId);
    const slaResult = await this.refreshSla(t, contract);

    // Unify the audit trail: emit ONE value-bearing "update" row carrying the
    // real old/new diff of every field that actually changed (title, category,
    // status, priority, technician, contact, site...). Previously the generic
    // interceptor row logged "update" with null/null and the granular
    // *_change rows duplicated the same info — inconsistent. Now: one complete,
    // value-bearing entry per edit.
    const changed: Record<string, unknown> = {};
    const oldVals: Record<string, unknown> = {};
    if (t.title !== old.title) { changed.title = t.title; oldVals.title = old.title; }
    if (t.description !== old.description) { changed.description = t.description; oldVals.description = old.description; }
    if (t.category !== old.category) { changed.category = t.category; oldVals.category = old.category; }
    if (t.status !== old.status) { changed.status = t.status; oldVals.status = old.status; }
    if (t.priority !== old.priority) { changed.priority = t.priority; oldVals.priority = old.priority; }
    if (t.technicianId !== old.technicianId) {
      changed.technicianId = t.technicianId; oldVals.technicianId = old.technicianId;
    }
    if (t.contactId !== old.contactId) { changed.contactId = t.contactId; oldVals.contactId = old.contactId; }
    if (t.siteId !== old.siteId) { changed.siteId = t.siteId; oldVals.siteId = old.siteId; }

    if (Object.keys(changed).length > 0) {
      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.TICKET,
        entityId: id,
        oldValue: oldVals,
        newValue: changed,
        meta: { changedFields: Object.keys(changed) },
      });
    }

    if (t.technicianId && priorTech !== t.technicianId) {
      await this.notifyAssignee(t.technicianId, id, t.title);
    }

    // If the SLA just flipped to red/yellow, notify assignee.
    const latestSla = await this.slas.findOne({ where: { ticketId: id } });
    if (latestSla && latestSla.status === SlaStatus.ROJO && t.technicianId) {
      await this.notifications.create({
        userId: await this.userIdOfTech(t.technicianId),
        type: NotificationType.SLA_EN_RIESGO,
        payload: { ticketId: id, title: t.title, status: latestSla.status },
      });
    }
    void slaResult;

    // Auto-respuestas al cliente por cambio de estado (si el toggle está activo).
    await this.maybeSendStatusEmail(t, old.status);

    return this.findOne(id, actor);
  }

  // Envía al cliente la plantilla correspondiente cuando el estado del ticket
  // cambia a "en proceso" (abierto/asignado/en_progreso) o a "resuelto".
  // El toggle emailAutoResponseEnabled lo valida MailService. Se envía sólo si
  // el ticket tiene contacto con email y NO está en modo sombra.
  private async maybeSendStatusEmail(t: Ticket, oldStatus: string): Promise<void> {
    try {
      if (t.shadow) return;
      if (!t.contactId) return;
      const contact = await this.contacts.findOne({ where: { id: t.contactId } });
      const to = contact?.email;
      if (!to) return;

      const ticketNumber = publicTicketNumber(t.ticketNumber, t.createdAt);

      // Transiciones relevantes: comenzar a atender (fuera de "nuevo") y resolver.
      const exitedNew = oldStatus === TicketStatus.NUEVO &&
        [TicketStatus.ABIERTO, TicketStatus.ASIGNADO, TicketStatus.EN_PROGRESO].includes(t.status as TicketStatus);
      const movedToInProgress = [TicketStatus.ABIERTO, TicketStatus.ASIGNADO, TicketStatus.EN_PROGRESO].includes(t.status as TicketStatus) &&
        ![TicketStatus.ABIERTO, TicketStatus.ASIGNADO, TicketStatus.EN_PROGRESO].includes(oldStatus as TicketStatus);

      if (t.status === TicketStatus.RESUELTO || t.status === TicketStatus.CERRADO) {
        await this.mail.sendTicketResolved(to, { ticketNumber });
        this.logger.log(`[AUTO-RESP] Ticket resuelto enviado a ${to} (ticket ${t.id})`);
      } else if (exitedNew || movedToInProgress) {
        await this.mail.sendTicketInProgress(to, { ticketNumber });
        this.logger.log(`[AUTO-RESP] Ticket en proceso enviado a ${to} (ticket ${t.id})`);
      }
    } catch (e) {
      this.logger.error(`[AUTO-RESP] Falló el envío de estado: ${(e as Error).message}`);
    }
  }

  async assign(id: string, dto: AssignTicketDto, actor: AuthenticatedUser): Promise<Ticket> {
    const t = await this.tickets.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    const prior = t.technicianId;
    t.technicianId = dto.technicianId;
    if (t.status === TicketStatus.NUEVO) t.status = TicketStatus.ASIGNADO;
    await this.tickets.save(t);

    await this.audit.log({
      user: actor,
      action: AuditAction.ASSIGNMENT_CHANGE,
      entityType: AuditEntityType.TICKET,
      entityId: id,
      oldValue: { technicianId: prior },
      newValue: { technicianId: dto.technicianId },
    });
    await this.notifyAssignee(dto.technicianId, id, t.title);
    return this.findOne(id, actor);
  }

  // Mueve un conjunto de tickets a un box del catálogo. Setea tickets.legacy_group
  // al nombre del box (validado contra ticket_groups y requiere box activo).
  // Auditoría individual por ticket. Idempotente: los tickets que ya están en el
  // box objetivo no generan movimiento.
  async bulkMove(ticketIds: string[], groupId: string, actor: AuthenticatedUser): Promise<{ moved: number; count: number }> {
    const group = await this.groups.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Box no encontrado');
    if (!group.active) throw new BadRequestException('El box destino está desactivado');
    if (!ticketIds.length) throw new BadRequestException('Seleccioná al menos un ticket');

    const rows = await this.tickets.find({ where: { id: In(ticketIds) } });
    let moved = 0;
    for (const ticket of rows) {
      if (ticket.legacyGroup === group.name) continue;
      const oldGroup = ticket.legacyGroup;
      ticket.legacyGroup = group.name;
      await this.tickets.save(ticket);
      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.TICKET,
        entityId: ticket.id,
        oldValue: { legacyGroup: oldGroup },
        newValue: { legacyGroup: group.name },
        meta: { action: 'bulk_move', groupId: group.id },
      });
      moved++;
    }
    return { moved, count: rows.length };
  }

  // Borrado lógico masivo (spam / tickets de error). No elimina filas: solo setea
  // `deleted_at = now()` (TypeORM) y persiste en auditoría. TypeORM excluye por
  // defecto los tickets con `deleted_at` de listados, contadores, búsquedas y
  // ficha (incluso portal), ya que la entity extiende SoftDeleteEntity.
  async bulkSoftDelete(ticketIds: string[], actor: AuthenticatedUser): Promise<{ deleted: number; count: number }> {
    if (!ticketIds.length) throw new BadRequestException('Seleccioná al menos un ticket');

    const rows = await this.tickets.find({ where: { id: In(ticketIds) } });
    if (!rows.length) return { deleted: 0, count: 0 };

    const result = await this.tickets.softDelete({ id: In(rows.map((r) => r.id)) });
    for (const ticket of rows) {
      await this.audit.log({
        user: actor,
        action: AuditAction.DELETE,
        entityType: AuditEntityType.TICKET,
        entityId: ticket.id,
        oldValue: { title: ticket.title, ticketNumber: ticket.ticketNumber },
        meta: { softDelete: true, action: 'bulk_delete' },
      });
    }
    return { deleted: result.affected ?? rows.length, count: rows.length };
  }

  // Cambio de estado masivo (incluye cierre de tickets). Idempotente: los
  // tickets que ya están en el estado destino no generan cambio, no fallan y
  // no se auditan. Replica la misma lógica de resolvedAt que el update
  // individual. Auditoría individual por ticket (audit_logs). A diferencia del
  // update individual, NO envía auto-emails al cliente para no generar spam al
  // cerrar/resolver en lote.
  async bulkChangeStatus(
    ticketIds: string[],
    status: TicketStatus,
    actor: AuthenticatedUser,
  ): Promise<{ changed: number; count: number }> {
    if (!ticketIds.length) throw new BadRequestException('Seleccioná al menos un ticket');
    if (!Object.values(TicketStatus).includes(status)) {
      throw new BadRequestException('Estado inválido');
    }

    const rows = await this.tickets.find({ where: { id: In(ticketIds) } });
    if (!rows.length) return { changed: 0, count: 0 };

    let changed = 0;
    for (const ticket of rows) {
      if (ticket.status === status) continue;
      const oldStatus = ticket.status;
      ticket.status = status;
      if (status === TicketStatus.RESUELTO || status === TicketStatus.CERRADO) {
        ticket.resolvedAt = ticket.resolvedAt ?? new Date();
        if (status === TicketStatus.CERRADO) ticket.resolvedAt = new Date();
      } else {
        ticket.resolvedAt = null;
      }
      await this.tickets.save(ticket);
      await this.audit.log({
        user: actor,
        action: AuditAction.STATUS_CHANGE,
        entityType: AuditEntityType.TICKET,
        entityId: ticket.id,
        oldValue: { status: oldStatus },
        newValue: { status },
        meta: { bulk: true, action: 'bulk_status_change' },
      });
      changed++;
    }
    return { changed, count: rows.length };
  }

  // Add a message; first agent-authored message resets first-response SLA.
  async addMessage(
    id: string,
    dto: AddMessageDto,
    actor: AuthenticatedUser,
  ): Promise<TicketMessage> {
    const t = await this.tickets.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket no encontrado');

    const authorUserId = dto.authorUserId ?? actor.id;
    const message = this.messages.create({
      ticketId: id,
      authorType: dto.authorType,
      channel: dto.channel,
      body: dto.body,
      fromEmail: dto.fromEmail ?? null,
    });
    const saved = await this.messages.save(message);

    // First response: first non-system, internal (tech/portal) message.
    if (
      !t.firstResponseAt &&
      dto.authorType === TicketAuthorType.TECNICO
    ) {
      t.firstResponseAt = new Date();
      await this.tickets.save(t);
      const contract = await this.findActiveContract(t.customerId);
      await this.refreshSla(t, contract);
    }

    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TICKET_MESSAGE,
      entityId: saved.id,
      newValue: { ticketId: id, body: dto.body.slice(0, 120) },
      meta: { authorType: dto.authorType },
    });
    void authorUserId;

    // Envío saliente por WhatsApp: si el ticket es de canal WhatsApp y la respuesta
    // es de un técnico, se intenta mandar real por la Cloud API. Si falla (p.ej.
    // fuera de la ventana de 24h), se agrega un mensaje de sistema al ticket para
    // que el técnico lo vea (no fallar en silencio).
    if (t.source === 'whatsapp' && dto.authorType === TicketAuthorType.TECNICO && t.contactId) {
      const contact = await this.contacts.findOne({ where: { id: t.contactId } });
      const to = contact?.whatsapp;
      if (to) {
        const send = await this.whatsapp.sendOutbound(to, dto.body);
        if (!send.ok) {
          this.logger.error(`[WA] Fallo envío de respuesta a ${to}: ${send.error}`);
          await this.messages.save(
            this.messages.create({
              ticketId: id,
              authorType: TicketAuthorType.SISTEMA,
              channel: TicketChannel.WHATSAPP,
              body: `⚠ No se pudo enviar por WhatsApp: ${send.error || 'error desconocido'}. Puede requerir una plantilla aprobada (mensaje fuera de la ventana de 24 h).`,
              fromEmail: null,
            }),
          );
        }
      } else {
        this.logger.warn(`[WA] Ticket ${id} de WhatsApp sin número en el contacto; no se envía respuesta`);
      }
    }

    // Envío saliente por email: si el ticket es de canal email y la respuesta es
    // de un técnico, se manda REAL al remitente original (hasta ahora el cliente
    // nunca recibía la respuesta por email). Mismo criterio de errores que WhatsApp:
    // si falla, mensaje de sistema visible en el ticket (no fallar en silencio).
    // Se omite en modo sombra (tickets históricos de importación, aislados).
    if (t.source === 'email' && dto.authorType === TicketAuthorType.TECNICO && !t.shadow && t.contactId) {
      const contact = await this.contacts.findOne({ where: { id: t.contactId } });
      const lastClientMsg = await this.messages.findOne({
        where: { ticketId: id, authorType: TicketAuthorType.CLIENTE },
        order: { createdAt: 'DESC' },
      });
      const to = lastClientMsg?.fromEmail || contact?.email;
      if (to) {
        const ticketNumber = publicTicketNumber(t.ticketNumber, t.createdAt);
        try {
          await this.mail.sendTicketReply(to, {
            ticketNumber,
            subject: t.title,
            body: dto.body,
            technicianName: actor.name ?? null,
          });
          this.logger.log(`[EMAIL-REPLY] Respuesta enviada a ${to} (ticket ${t.id})`);
        } catch (e) {
          this.logger.error(`[EMAIL-REPLY] Falló el envío de respuesta a ${to}: ${(e as Error).message}`);
          await this.messages.save(
            this.messages.create({
              ticketId: id,
              authorType: TicketAuthorType.SISTEMA,
              channel: TicketChannel.EMAIL,
              body: `⚠ No se pudo enviar la respuesta por email al cliente (${to}): ${(e as Error).message}.`,
              fromEmail: null,
            }),
          );
        }
      } else {
        this.logger.warn(`[EMAIL-REPLY] Ticket ${id} de email sin dirección en el contacto; no se envía respuesta`);
      }
    }

    return saved;
  }

  async uploadAttachment(
    messageId: string,
    file: Express.Multer.File,
  ): Promise<TicketAttachment> {
    const msg = await this.messages.findOne({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('Mensaje no encontrado');
    const { url, key } = await this.storage.putObject(
      file.buffer,
      file.originalname,
      file.mimetype,
      'tickets',
    );
    const attachment = this.attachments.create({
      ticketMessageId: messageId,
      fileUrl: url,
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
    void key;
    return this.attachments.save(attachment);
  }

  // Descarga un adjunto asociado a un mensaje del ticket, servido por el backend
  // desde MinIO (con Content-Disposition). Evita exponer MinIO directamente.
  async downloadAttachment(
    attachmentId: string,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const att = await this.attachments.findOne({ where: { id: attachmentId } });
    if (!att || !att.fileUrl) throw new NotFoundException('Adjunto no encontrado');
    // fileUrl guarda la referencia `minio/bucket/key` o una URL; extraemos el key.
    const key = this.attachmentObjectKey(att.fileUrl);
    const buffer = await this.storage.getObject(key);
    return { buffer, filename: att.filename, mimeType: att.mimeType };
  }

  private attachmentObjectKey(fileUrl: string): string {
    // El formato que guarda StorageService.putObject es
    // `${publicBaseUrl}/${bucket}/${key}`. Extraemos la parte tras el bucket.
    const idx = fileUrl.indexOf('/tickets/');
    if (idx >= 0) return fileUrl.slice(idx + 1);
    return fileUrl;
  }

  private async refreshSla(t: Ticket, contract: Contract | null) {
    const computed = this.slaService.compute(t, contract).sla;
    let record = await this.slas.findOne({ where: { ticketId: t.id } });
    if (!record) {
      record = this.slas.create({ ...computed, ticketId: t.id });
    } else {
      Object.assign(record, computed, { ticketId: t.id });
    }
    return this.slas.save(record);
  }

  private async findActiveContract(customerId: string | null): Promise<Contract | null> {
    if (!customerId) return null;
    return this.contracts.findOne({
      where: { customerId, active: true },
      order: { createdAt: 'DESC' },
    });
  }

  private async userIdOfTech(technicianId: string): Promise<string> {
    const tech = await this.technicians.findOne({ where: { id: technicianId } });
    return tech?.userId ?? '';
  }

  private async notifyAssignee(technicianId: string, ticketId: string, title: string) {
    const userId = await this.userIdOfTech(technicianId);
    if (!userId) return;
    await this.notifications.create({
      userId,
      type: NotificationType.TICKET_ASIGNADO,
      payload: { ticketId, title },
    });
  }

  // Notificación in-app persistente (globito/contador) cuando un email entrante
  // crea un ticket nuevo o reabre uno cerrado. Mismo criterio que el módulo
  // WhatsApp (notifyWhatsappMessage): si el ticket tiene técnico asignado se le
  // notifica solo a él; si no, a TODOS los técnicos. Complementa (no reemplaza)
  // el broadcast efímero emitNewTicketBroadcast.
  private async notifyNewEmailTicket(
    ticket: Ticket,
    contactName: string | null,
    title?: string,
  ): Promise<void> {
    try {
      const finalTitle =
        title ?? `Nuevo ticket por email de ${contactName || 'un contacto'}`;
      const recipients: string[] = [];
      if (ticket.technicianId) {
        const tech = await this.technicians.findOne({ where: { id: ticket.technicianId } });
        if (tech?.userId) recipients.push(tech.userId);
      } else {
        const all = await this.technicians.find();
        for (const t of all) if (t.userId) recipients.push(t.userId);
      }
      for (const userId of recipients) {
        await this.notifications.create({
          userId,
          type: NotificationType.EMAIL_MESSAGE,
          payload: { ticketId: ticket.id, title: finalTitle },
        });
      }
      this.logger.log(
        `[EMAIL] Notificación persistente enviada a ${recipients.length} usuario(s) (ticket ${ticket.id})`,
      );
    } catch (e) {
      this.logger.error(`[EMAIL] Fallo notificación persistente: ${(e as Error).message}`);
    }
  }

  // Habilita automáticamente el acceso al portal del contacto cuando un email
  // entrante del mismo crea o alimenta un ticket (decision: todo cliente que
  // escribe recibe acceso al portal). Solo escribe si estaba apagado. No envía
  // email: el cliente usa "¿Olvidaste tu contraseña?" para fijar la primera
  // contraseña (flujo existente de reset, funciona sin password previo).
  private async ensurePortalEnabled(contactId: string): Promise<void> {
    try {
      const contact = await this.contacts.findOne({ where: { id: contactId } });
      if (contact && !contact.portalEnabled) {
        contact.portalEnabled = true;
        await this.contacts.save(contact);
        this.logger.log(
          `[EMAIL] Portal habilitado automáticamente para contacto ${contact.email ?? contact.id}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `[EMAIL] Fallo al habilitar portal del contacto ${contactId}: ${(e as Error).message}`,
      );
    }
  }

  // Public surface for email ingestion (module 5): create/update from inbound.
  async upsertFromEmail(data: {
    fromEmail: string;
    subject: string;
    body: string | null;
    bodyHtml?: string | null;
    contactId: string;
    customerId: string;
    siteId?: string | null;
    shadow?: boolean;
    legacyGroup?: string | null;
    attachments?: Array<{ filename: string; url: string; mimeType: string; sizeBytes?: number; cid?: string | null; disposition?: 'inline' | 'attachment' }>;
  }): Promise<{ ticket: Ticket; action: 'created' | 'appended' }> {
    const subjectKey = normalizeSubjectKey(data.subject);
    const shadow = !!data.shadow;
    // Look for a recent, open ticket with the same subject from the same contact.
    let existing = await this.tickets
      .createQueryBuilder('t')
      .where('t.contact_id = :contactId', { contactId: data.contactId })
      .andWhere('t.subject_key = :subjectKey', { subjectKey })
      .andWhere('t.shadow = :shadow', { shadow })
      .andWhere(`t.status NOT IN (:...closed)`, {
        closed: [TicketStatus.RESUELTO, TicketStatus.CERRADO],
      })
      .orderBy('t.createdAt', 'DESC')
      .getOne();

    // Reapertura automática: si no hay un ticket abierto con el mismo contacto
    // y asunto, reusar el más reciente aunque esté resuelto/cerrado y volverlo
    // a "abierto" (limpiando resolvedAt). Se conserva el técnico asignado y el
    // SLA se recalcula para el nuevo estado. Deja trazabilidad en auditoría.
    if (!existing) {
      const closed = await this.tickets
        .createQueryBuilder('t')
        .where('t.contact_id = :contactId', { contactId: data.contactId })
        .andWhere('t.subject_key = :subjectKey', { subjectKey })
        .andWhere('t.shadow = :shadow', { shadow })
        .orderBy('t.createdAt', 'DESC')
        .getOne();

      if (
        closed &&
        (closed.status === TicketStatus.RESUELTO || closed.status === TicketStatus.CERRADO)
      ) {
        const prevStatus = closed.status;
        closed.status = TicketStatus.ABIERTO;
        closed.resolvedAt = null;
        await this.tickets.save(closed);
        const contract = await this.findActiveContract(closed.customerId);
        await this.refreshSla(closed, contract);
        await this.audit.log({
          user: null,
          action: AuditAction.STATUS_CHANGE,
          entityType: AuditEntityType.TICKET,
          entityId: closed.id,
          oldValue: { status: prevStatus },
          newValue: { status: TicketStatus.ABIERTO },
          meta: { automatic: true, reason: 'reopen_client_email', source: 'email' },
        });
        const recontact = await this.contacts.findOne({ where: { id: data.contactId } });
        await this.notifyNewEmailTicket(
          closed,
          recontact?.name ?? null,
          'Ticket reabierto por email de ' + (recontact?.name ?? 'un contacto'),
        );
        existing = closed;
      }
    }

    if (existing) {
      const msg = await this.messages.save(
        this.messages.create({
          ticketId: existing.id,
          authorType: TicketAuthorType.CLIENTE,
          channel: TicketChannel.EMAIL,
          body: data.body ?? '(sin contenido)',
          bodyHtml: data.bodyHtml ?? null,
          fromEmail: data.fromEmail,
        }),
      );
      await this.saveAttachments(msg.id, data.attachments);
      await this.ensurePortalEnabled(data.contactId);
      return { ticket: existing, action: 'appended' };
    }

    const ticket = await this.tickets.save(
      this.tickets.create({
        customerId: data.customerId,
        contactId: data.contactId,
        siteId: data.siteId ?? null,
        title: data.subject,
        source: 'email',
        shadow,
        status: TicketStatus.NUEVO,
        priority: TicketPriority.NORMAL,
        subjectKey,
        description: data.body,
        legacyGroup: data.legacyGroup ?? null,
        ticketNumber: await this.nextTicketNumber(),
        firstResponseAt: null,
        resolvedAt: null,
      }),
    );
    const msg = await this.messages.save(
      this.messages.create({
        ticketId: ticket.id,
        authorType: TicketAuthorType.CLIENTE,
        channel: TicketChannel.EMAIL,
        body: data.body ?? '(sin contenido)',
        bodyHtml: data.bodyHtml ?? null,
        fromEmail: data.fromEmail,
      }),
    );
    await this.saveAttachments(msg.id, data.attachments);
    const contract = await this.findActiveContract(data.customerId);
    await this.refreshSla(ticket, contract);
    await this.emitNewTicketBroadcast(ticket);
    const contact = await this.contacts.findOne({ where: { id: data.contactId } });
    await this.notifyNewEmailTicket(ticket, contact?.name ?? null);
    await this.ensurePortalEnabled(data.contactId);
    return { ticket, action: 'created' };
  }

  // Ticket de WhatsApp abierto para un contacto (source='whatsapp', estado no
  // resuelto/cerrado). Lo usa el módulo whatsapp para decidir si inicia chatbot
  // o agrega un mensaje al hilo existente.
  findOpenWhatsappTicket(contactId: string): Promise<Ticket | null> {
    return this.tickets
      .createQueryBuilder('t')
      .where('t.contact_id = :contactId', { contactId })
      .andWhere('t.source = :src', { src: 'whatsapp' })
      .andWhere(`t.status NOT IN (:...closed)`, {
        closed: [TicketStatus.RESUELTO, TicketStatus.CERRADO],
      })
      .orderBy('t.createdAt', 'DESC')
      .getOne();
  }

  // Public surface for WhatsApp ingestion (module whatsapp): crea un ticket de
  // canal WhatsApp o agrega mensajes a uno abierto existente para el contacto.
  async upsertFromWhatsapp(data: {
    contactId: string;
    customerId: string;
    title: string;
    category?: string | null;
    legacyGroup?: string | null;
    priority?: TicketPriority;
    description?: string | null;
    messages: Array<{
      author: 'cliente' | 'bot' | 'tecnico';
      body: string;
      attachments?: Array<{ filename: string; url: string; mimeType: string; sizeBytes?: number }>;
    }>;
  }): Promise<{ ticket: Ticket; action: 'created' | 'appended' }> {
    const authorFor = (a: 'cliente' | 'bot' | 'tecnico') =>
      a === 'bot' ? TicketAuthorType.SISTEMA : a === 'tecnico' ? TicketAuthorType.TECNICO : TicketAuthorType.CLIENTE;

    const open = await this.tickets
      .createQueryBuilder('t')
      .where('t.contact_id = :contactId', { contactId: data.contactId })
      .andWhere('t.source = :src', { src: 'whatsapp' })
      .andWhere(`t.status NOT IN (:...closed)`, {
        closed: [TicketStatus.RESUELTO, TicketStatus.CERRADO],
      })
      .orderBy('t.createdAt', 'DESC')
      .getOne();

    if (open) {
      for (const m of data.messages) {
        const saved = await this.messages.save(
          this.messages.create({
            ticketId: open.id,
            authorType: authorFor(m.author),
            channel: TicketChannel.WHATSAPP,
            body: m.body,
            fromEmail: null,
          }),
        );
        await this.saveAttachments(saved.id, m.attachments);
      }
      return { ticket: open, action: 'appended' };
    }

    const ticket = await this.tickets.save(
      this.tickets.create({
        customerId: data.customerId,
        contactId: data.contactId,
        title: data.title.slice(0, 500),
        source: 'whatsapp',
        shadow: false,
        status: TicketStatus.NUEVO,
        priority: data.priority ?? TicketPriority.NORMAL,
        category: data.category ?? null,
        legacyGroup: data.legacyGroup ?? null,
        subjectKey: normalizeSubjectKey(data.title),
        description: data.description ?? null,
        ticketNumber: await this.nextTicketNumber(),
        firstResponseAt: null,
        resolvedAt: null,
      }),
    );
    for (const m of data.messages) {
      const saved = await this.messages.save(
        this.messages.create({
          ticketId: ticket.id,
          authorType: authorFor(m.author),
          channel: TicketChannel.WHATSAPP,
          body: m.body,
          fromEmail: null,
        }),
      );
      await this.saveAttachments(saved.id, m.attachments);
    }
    const contract = await this.findActiveContract(data.customerId);
    await this.refreshSla(ticket, contract);
    await this.emitNewTicketBroadcast(ticket);
    return { ticket, action: 'created' };
  }

  // Persiste metadata de adjuntos asociados a un mensaje (imágenes inline y
  // adjuntos reales ya subidos a MinIO por el worker).
  private async saveAttachments(
    messageId: string,
    attachments?: Array<{ filename: string; url: string; mimeType: string; sizeBytes?: number; cid?: string | null; disposition?: 'inline' | 'attachment' }>,
  ): Promise<void> {
    if (!attachments?.length) return;
    for (const a of attachments) {
      await this.attachments.save(
        this.attachments.create({
          ticketMessageId: messageId,
          fileUrl: a.url,
          filename: a.filename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes ?? 0,
        }),
      );
    }
  }

  // Notifica a TODOS los usuarios conectados (broadcast) que llegó un ticket
  // nuevo, para que el frontend muestre una notificación flotante estilo Zammad.
  // Se emite para CUALQUIER ticket nuevo (manual o por email), sin filtro de
  // bandeja — decisión del usuario (notificar todos, evitar spam se descartó).
  private async emitNewTicketBroadcast(ticket: Ticket): Promise<void> {
    try {
      const customer = ticket.customerId
        ? await this.customers.findOne({ where: { id: ticket.customerId } })
        : null;
      const tech = ticket.technicianId
        ? await this.technicians.findOne({ where: { id: ticket.technicianId }, relations: ['user'] })
        : null;
      this.gateway.broadcast('ticket:new', {
        id: ticket.id,
        title: ticket.title,
        customerName: customer?.name ?? null,
        technicianName: (tech as unknown as { user?: { name?: string } } | null)?.user?.name ?? null,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
      });
    } catch {
      // El broadcast es best-effort: no debe romper la creación del ticket.
    }
  }
}
