import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WorkshopEquipment, StatusHistoryEntry } from '../../entities/workshop-equipment.entity';
import { PriceListItem } from '../../entities/price-list-item.entity';
import { WorkshopQuote } from '../../entities/workshop-quote.entity';
import { WorkshopQuoteItem } from '../../entities/workshop-quote-item.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Customer } from '../../entities/customer.entity';
import { Contact } from '../../entities/contact.entity';
import { Site } from '../../entities/site.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  EquipmentType,
  WorkshopEquipmentStatus,
  WorkshopQuoteStatus,
  AuditAction,
  AuditEntityType,
  TicketStatus,
  TicketPriority,
} from '../../common/enums';
import { buildReceptionPdf, buildQuotePdf } from './pdf.util';

const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  [EquipmentType.PC]: 'PC',
  [EquipmentType.NOTEBOOK]: 'Notebook',
  [EquipmentType.IMPRESORA]: 'Impresora',
  [EquipmentType.ROUTER]: 'Router',
  [EquipmentType.RELOJ_FICHADOR]: 'Reloj fichador',
  [EquipmentType.DVR]: 'DVR',
  [EquipmentType.OTRO]: 'Otro',
};

const STATUS_ORDER: WorkshopEquipmentStatus[] = [
  WorkshopEquipmentStatus.RECIBIDO,
  WorkshopEquipmentStatus.EN_DIAGNOSTICO,
  WorkshopEquipmentStatus.DIAGNOSTICADO,
  WorkshopEquipmentStatus.EN_REPARACION,
  WorkshopEquipmentStatus.LISTO_PARA_RETIRAR,
  WorkshopEquipmentStatus.ENTREGADO,
];

// El bucket genérico donde se agrupan los clientes particulares (el nombre en
// CustomCustomer). Cada persona real es un Contact distinto dentro de ese bucket.
// Coincide con la convención usada en el resto del sistema (alta de equipo en el
// frontend e importación Zammad). Al mostrar el listado, para estos clientes se
// prefiere el nombre del Contact (la persona real) en vez del nombre del bucket.
export const PARTICULARS_BUCKET_NAME = 'Clientes particulares';

@Injectable()
export class WorkshopService {
  private readonly logger = new Logger(WorkshopService.name);

  constructor(
    @InjectRepository(WorkshopEquipment) private readonly eqRepo: Repository<WorkshopEquipment>,
    @InjectRepository(PriceListItem) private readonly catRepo: Repository<PriceListItem>,
    @InjectRepository(WorkshopQuote) private readonly quoteRepo: Repository<WorkshopQuote>,
    @InjectRepository(WorkshopQuoteItem) private readonly itemRepo: Repository<WorkshopQuoteItem>,
    @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Contact) private readonly contactRepo: Repository<Contact>,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(TicketGroup) private readonly groupRepo: Repository<TicketGroup>,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly dataSource: DataSource,
  ) {}

  // --------------------------------------------------------------------------
  // Equipos
  // --------------------------------------------------------------------------

  async list(filter: { customerId?: string; status?: string; search?: string } = {}) {
    // Se adjunta el ticket vinculado (para su id/número de orden). El nombre real
    // del cliente se resuelve por lotes abajo (no hay relación declarada).
    const qb = this.eqRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.ticket', 'tk')
      .addSelect(['tk.id'])
      .orderBy('e.receivedAt', 'DESC');
    if (filter.customerId) qb.andWhere('e.customerId = :cid', { cid: filter.customerId });
    if (filter.status) qb.andWhere('e.status = :st', { st: filter.status });
    if (filter.search) {
      // Se incluye el nombre real del cliente/Customer (puede diferir de
      // customerLabel) y, para el bucket de particulares, el nombre del Contact
      // (la persona real), para que buscar por nombre de la persona encuentre el equipo.
      qb.andWhere(
        '(e.brand ILIKE :s OR e.model ILIKE :s OR e.serialNumber ILIKE :s OR e.reportedFault ILIKE :s OR e.customerLabel ILIKE :s OR EXISTS (SELECT 1 FROM customers c WHERE c.id = e.customer_id AND c.name ILIKE :s) OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.id = e.contact_id AND ct.name ILIKE :s))',
        { s: `%${filter.search}%` },
      );
    }
    const rows = await qb.getMany();

    // Se carga el nombre del cliente (Customer) y, además, los contactos de los
    // equipos: para el bucket de particulares el nombre a mostrar es el del
    // Contact (la persona real cargada), no el del Customer genérico.
    const customerIds = [...new Set(rows.map((r) => r.customerId))];
    const customers =
      customerIds.length === 0
        ? []
        : await this.customerRepo
            .createQueryBuilder('c')
            .select(['c.id', 'c.name'])
            .where('c.id IN (:...ids)', { ids: customerIds })
            .getMany();
    const nameById = new Map(customers.map((c) => [c.id, c.name]));

    const contactIds = [...new Set(rows.map((r) => r.contactId).filter(Boolean) as string[])];
    const contacts =
      contactIds.length === 0
        ? []
        : await this.contactRepo
            .createQueryBuilder('cc')
            .select(['cc.id', 'cc.name'])
            .where('cc.id IN (:...ids)', { ids: contactIds })
            .getMany();
    const contactNameById = new Map(contacts.map((cc) => [cc.id, cc.name]));

    return rows.map((r) => {
      const decorated = this.decorate(r);
      const customerName = nameById.get(r.customerId) || r.customerLabel || null;
      const isParticular = customerName === PARTICULARS_BUCKET_NAME;
      // Para particulares se muestra el nombre del Contact real (persona).
      const displayName =
        isParticular && r.contactId && contactNameById.has(r.contactId)
          ? contactNameById.get(r.contactId)!
          : customerName;
      return {
        ...decorated,
        customerName: displayName,
        customerLabel: r.customerLabel,
        ticketNumber: r.ticket ? `#${r.ticket.id.slice(0, 8)}` : null,
      };
    });
  }

  async findOne(id: string) {
    const eq = await this.eqRepo.findOne({
      where: { id },
      relations: { ticket: true },
    });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const { items, quote } = await this.getActiveQuote(id);
    const customer = eq.customerId ? await this.customerRepo.findOne({ where: { id: eq.customerId } }) : null;
    const contact = eq.contactId ? await this.contactRepo.findOne({ where: { id: eq.contactId } }) : null;
    const site = eq.ticketId
      ? (await this.ticketRepo.findOne({ where: { id: eq.ticketId } }))?.siteId
      : null;
    const siteRow = site ? await this.siteRepo.findOne({ where: { id: site } }) : null;
    return {
      ...this.decorate(eq),
      ticket: eq.ticket,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      contact: contact ? { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone } : null,
      site: siteRow ? { id: siteRow.id, name: siteRow.name, address: siteRow.address } : null,
      quote,
      quoteItems: items,
    };
  }

  async createEquipment(input: {
    customerId: string;
    contactId?: string | null;
    customerLabel?: string | null;
    equipmentType: EquipmentType;
    otherType?: string | null;
    brand?: string | null;
    model?: string | null;
    serialNumber?: string | null;
    accessories?: string | null;
    physicalCondition?: string | null;
    reportedFault: string;
    title?: string | null;
  }, user: AuthenticatedUser) {
    // Crea el ticket de Taller asociado.
    const defaultTitle =
      (input.title && input.title.trim()) ||
      `Equipo: ${EQUIPMENT_TYPE_LABELS[input.equipmentType]}${input.brand ? ' ' + input.brand : ''}${input.model ? ' ' + input.model : ''}`;
    // Box de destino configurado para el módulo Taller (moduleKey='workshop').
    // Si hay un box activo con ese moduleKey, el ticket cae en ese box
    // (tickets.legacy_group = box.name). Si no, queda en "Nativos" como antes.
    const workshopBox = await this.groupRepo.findOne({ where: { moduleKey: 'workshop', active: true } });
    const [numRow] = await this.dataSource.query(`SELECT nextval('ticket_number_seq') AS n`);
    const ticket = this.ticketRepo.create({
      customerId: input.customerId,
      contactId: input.contactId ?? null,
      title: defaultTitle.slice(0, 500),
      status: TicketStatus.ABIERTO,
      priority: TicketPriority.NORMAL,
      category: 'Taller',
      legacyGroup: workshopBox?.name ?? null,
      ticketNumber: Number(numRow.n),
      source: 'manual',
      description: input.reportedFault,
    });
    await this.ticketRepo.save(ticket);
    await this.audit.log({
      user,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.TICKET,
      entityId: ticket.id,
      newValue: { title: ticket.title, category: 'Taller' },
    });

    const eq = this.eqRepo.create({
      ticketId: ticket.id,
      customerId: input.customerId,
      contactId: input.contactId ?? null,
      customerLabel: input.customerLabel ?? null,
      equipmentType: input.equipmentType,
      otherType: input.otherType ?? null,
      brand: input.brand ?? null,
      model: input.model ?? null,
      serialNumber: input.serialNumber ?? null,
      accessories: input.accessories ?? null,
      physicalCondition: input.physicalCondition ?? null,
      reportedFault: input.reportedFault,
      status: WorkshopEquipmentStatus.RECIBIDO,
      receivedAt: new Date(),
      statusHistory: [{ status: WorkshopEquipmentStatus.RECIBIDO, at: new Date().toISOString(), byUserId: user.id }],
    });
    await this.eqRepo.save(eq);
    await this.audit.log({
      user,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.WORKSHOP_EQUIPMENT,
      entityId: eq.id,
      newValue: { ticketId: ticket.id, type: input.equipmentType },
    });
    // Best-effort: el equipo quedó RECIBIDO; se envía el comprobante de recepción.
    await this.notifyStatusChange(eq.id, WorkshopEquipmentStatus.RECIBIDO, WorkshopEquipmentStatus.RECIBIDO);
    return this.findOne(eq.id);
  }

  async updateEquipment(
    id: string,
    input: Partial<{
      otherType: string | null;
      brand: string | null;
      model: string | null;
      serialNumber: string | null;
      accessories: string | null;
      physicalCondition: string | null;
      reportedFault: string;
      diagnosis: string | null;
      contactId: string | null;
      contactPatch?: { name?: string; email?: string | null; phone?: string | null };
    }>,
    user: AuthenticatedUser,
  ) {
    const eq = await this.eqRepo.findOne({ where: { id } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const snapshot = { ...eq } as Record<string, unknown>;

    // Cambiar el contacto del equipo: debe pertenecer al mismo cliente.
    if (input.contactId !== undefined && input.contactId !== eq.contactId) {
      if (input.contactId) {
        const contact = await this.contactRepo.findOne({ where: { id: input.contactId, customerId: eq.customerId } });
        if (!contact) {
          throw new BadRequestException('El contacto seleccionado no pertenece al cliente del equipo.');
        }
      }
      eq.contactId = input.contactId;
    }

    // Corregir los datos del contacto global del cliente (nombre/email/teléfono),
    // aplicando la misma convención que editar el contacto desde Clientes.
    const { contactPatch, contactId: _ignored, ...equipmentFields } = input;
    if (contactPatch && eq.contactId) {
      const contact = await this.contactRepo.findOne({ where: { id: eq.contactId, customerId: eq.customerId } });
      if (!contact) throw new NotFoundException('Contacto del equipo no encontrado');
      const oldContact = { name: contact.name, email: contact.email, phone: contact.phone };
      Object.assign(contact, contactPatch);
      await this.contactRepo.save(contact);
      await this.audit.log({
        user,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.CONTACT,
        entityId: contact.id,
        oldValue: oldContact,
        newValue: { ...contactPatch, customerId: eq.customerId },
      });
    }

    Object.assign(eq, equipmentFields);
    await this.eqRepo.save(eq);
    await this.audit.log({
      user,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.WORKSHOP_EQUIPMENT,
      entityId: eq.id,
      oldValue: snapshot,
      newValue: {
        ...equipmentFields,
        ...(input.contactId !== undefined ? { contactId: eq.contactId } : {}),
        ...(contactPatch ? { contactPatch } : {}),
      },
    });
    return this.findOne(id);
  }

  async setStatus(id: string, status: WorkshopEquipmentStatus, user: AuthenticatedUser) {
    const eq = await this.eqRepo.findOne({ where: { id } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');

    if (status === eq.status) return this.findOne(id);

    const nextIdx = STATUS_ORDER.indexOf(status);
    if (nextIdx < 0) throw new BadRequestException('Estado inválido');

    // Bloqueo duro: no se puede pasar a "En reparación" sin presupuesto aprobado.
    if (status === WorkshopEquipmentStatus.EN_REPARACION) {
      const { quote } = await this.getActiveQuote(id);
      if (!quote || quote.status !== WorkshopQuoteStatus.APROBADO) {
        throw new BadRequestException(
          'No se puede pasar a "En reparación" sin un presupuesto aprobado por el cliente.',
        );
      }
    }

    const oldStatus = eq.status;
    eq.status = status;
    if (status === WorkshopEquipmentStatus.ENTREGADO) {
      eq.deliveredAt = new Date();
    }
    const history: StatusHistoryEntry[] = [
      ...(eq.statusHistory || []),
      { status, at: new Date().toISOString(), byUserId: user.id },
    ];
    eq.statusHistory = history;
    await this.eqRepo.save(eq);
    await this.audit.log({
      user,
      action: AuditAction.STATUS_CHANGE,
      entityType: AuditEntityType.WORKSHOP_EQUIPMENT,
      entityId: eq.id,
      oldValue: { status: oldStatus },
      newValue: { status },
    });
    // Refleja el estado en el ticket vinculado.
    if (eq.ticketId) {
      const ticket = await this.ticketRepo.findOne({ where: { id: eq.ticketId } });
      if (ticket) {
        const mapped: Record<WorkshopEquipmentStatus, TicketStatus> = {
          [WorkshopEquipmentStatus.RECIBIDO]: TicketStatus.ABIERTO,
          [WorkshopEquipmentStatus.EN_DIAGNOSTICO]: TicketStatus.EN_PROGRESO,
          [WorkshopEquipmentStatus.DIAGNOSTICADO]: TicketStatus.EN_PROGRESO,
          [WorkshopEquipmentStatus.EN_REPARACION]: TicketStatus.EN_PROGRESO,
          [WorkshopEquipmentStatus.LISTO_PARA_RETIRAR]: TicketStatus.ESPERANDO_CLIENTE,
          [WorkshopEquipmentStatus.ENTREGADO]: TicketStatus.RESUELTO,
        };
        ticket.status = mapped[status];
        await this.ticketRepo.save(ticket);
      }
    }
    // Best-effort: notifica al contacto por email el cambio de estado. Nunca debe
    // hacer fallar la operación si el mail falla.
    await this.notifyStatusChange(eq.id, status, oldStatus);
    return this.findOne(id);
  }

  // --------------------------------------------------------------------------
  // Catálogo de precios
  // --------------------------------------------------------------------------

  async listCatalog(onlyActive = false) {
    const qb = this.catRepo.createQueryBuilder('c').orderBy('c.isLabor', 'DESC').addOrderBy('c.name', 'ASC');
    if (onlyActive) qb.where('c.active = true');
    const rows = await qb.getMany();
    return rows.map((r) => ({ ...r, price: Number(r.price) }));
  }

  async createCatalogItem(input: { name: string; active?: boolean; isLabor?: boolean; price?: string; description?: string | null }, user: AuthenticatedUser) {
    const item = this.catRepo.create({
      name: input.name,
      active: input.active ?? true,
      isLabor: input.isLabor ?? false,
      price: input.price ?? '0',
      description: input.description ?? null,
    });
    await this.catRepo.save(item);
    await this.audit.log({
      user,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.PRICE_LIST_ITEM,
      entityId: item.id,
      newValue: { name: item.name, price: Number(item.price) },
    });
    return { ...item, price: Number(item.price) };
  }

  async updateCatalogItem(id: string, input: Partial<{ name: string; active: boolean; isLabor: boolean; price: string; description: string | null }>, user: AuthenticatedUser) {
    const item = await this.catRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Ítem no encontrado');
    const snapshot = { ...item } as Record<string, unknown>;
    Object.assign(item, input);
    await this.catRepo.save(item);
    await this.audit.log({
      user,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.PRICE_LIST_ITEM,
      entityId: item.id,
      oldValue: snapshot,
      newValue: input as Record<string, unknown>,
    });
    return { ...item, price: Number(item.price) };
  }

  // --------------------------------------------------------------------------
  // Presupuestos
  // --------------------------------------------------------------------------

  private async getActiveQuote(equipmentId: string) {
    const quote = await this.quoteRepo.findOne({
      where: { equipmentId },
      order: { createdAt: 'DESC' },
    });
    if (!quote) return { quote: null, items: [] as WorkshopQuoteItem[] };
    const items = await this.itemRepo.find({ where: { quoteId: quote.id } });
    return { quote, items };
  }

  private async quoteNumber(): Promise<string> {
    const now = new Date();
    const y = now.getFullYear();
    const count = await this.quoteRepo
      .createQueryBuilder('q')
      .where(`EXTRACT(YEAR FROM q."created_at") = :y`, { y })
      .getCount();
    return `WK-${y}-${String(count + 1).padStart(5, '0')}`;
  }

  async listQuotes(equipmentId: string) {
    const eq = await this.eqRepo.findOne({ where: { id: equipmentId } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const quotes = await this.quoteRepo.find({ where: { equipmentId }, order: { createdAt: 'DESC' } });
    const withLines = await Promise.all(
      quotes.map(async (q) => ({
        ...q,
        subtotal: Number(q.subtotal),
        total: Number(q.total),
        items: await this.itemRepo.find({ where: { quoteId: q.id } }),
      })),
    );
    return withLines;
  }

  // Arma el presupuesto a partir de ítems del catálogo (no precios libres).
  async createQuote(
    equipmentId: string,
    input: { lines: Array<{ priceListItemId?: string | null; name: string; isLabor?: boolean; quantity: number; unitPrice: string }>; notes?: string | null },
    user: AuthenticatedUser,
  ) {
    const eq = await this.eqRepo.findOne({ where: { id: equipmentId } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');

    if (!input.lines || input.lines.length === 0) {
      throw new BadRequestException('El presupuesto debe incluir al menos un ítem.');
    }

    const items = input.lines.map((l) => {
      // El precio debe venir del catálogo activo: verificar si el ítem existe y es activo.
      const qty = Math.max(1, l.quantity || 1);
      const unit = Number(l.unitPrice || 0);
      const lineTotal = Math.round(unit * qty * 100) / 100;
      return {
        priceListItemId: l.priceListItemId ?? null,
        name: l.name,
        isLabor: l.isLabor ?? false,
        quantity: qty,
        unitPrice: (Math.round(unit * 100) / 100).toFixed(2),
        lineTotal: lineTotal.toFixed(2),
      };
    });

    const subtotal = items.reduce((a, i) => a + Number(i.lineTotal), 0);
    const number = await this.quoteNumber();

    const quote = this.quoteRepo.create({
      equipmentId,
      number,
      status: WorkshopQuoteStatus.PENDIENTE,
      notes: input.notes ?? null,
      subtotal: subtotal.toFixed(2),
      total: subtotal.toFixed(2),
      createdById: user.id,
      sentAt: null,
    });
    await this.quoteRepo.save(quote);

    // Crea las líneas (snapshot de nombre y precio).
    const lines = items.map((i) =>
      this.itemRepo.create({ ...i, quoteId: quote.id }),
    );
    await this.itemRepo.save(lines);

    await this.audit.log({
      user,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.WORKSHOP_QUOTE,
      entityId: quote.id,
      newValue: { number: quote.number, total: quote.total },
    });

    return this.findOne(eq.id);
  }

  // Envía el presupuesto al cliente (marca sentAt y queda visible en el portal).
  async sendQuote(equipmentId: string, quoteId: string, user: AuthenticatedUser) {
    const eq = await this.eqRepo.findOne({ where: { id: equipmentId } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const quote = await this.quoteRepo.findOne({ where: { id: quoteId, equipmentId } });
    if (!quote) throw new NotFoundException('Presupuesto no encontrado');
    if (quote.status !== WorkshopQuoteStatus.PENDIENTE) {
      throw new BadRequestException('El presupuesto ya no está pendiente.');
    }
    quote.sentAt = new Date();
    await this.quoteRepo.save(quote);
    await this.audit.log({
      user,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.WORKSHOP_QUOTE,
      entityId: quote.id,
      newValue: { sentAt: quote.sentAt },
    });
    return this.findOne(eq.id);
  }

  // Aprobación/rechazo (staff).
  async respondQuote(equipmentId: string, quoteId: string, decision: 'aprobado' | 'rechazado', user: AuthenticatedUser) {
    const eq = await this.eqRepo.findOne({ where: { id: equipmentId } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const quote = await this.quoteRepo.findOne({ where: { id: quoteId, equipmentId } });
    if (!quote) throw new NotFoundException('Presupuesto no encontrado');
    if (quote.status !== WorkshopQuoteStatus.PENDIENTE) {
      throw new BadRequestException('El presupuesto ya fue respondido.');
    }
    const prev = quote.status;
    quote.status = decision as WorkshopQuoteStatus;
    quote.respondedAt = new Date();
    quote.respondedById = user.id;
    await this.quoteRepo.save(quote);
    await this.audit.log({
      user,
      action: AuditAction.STATUS_CHANGE,
      entityType: AuditEntityType.WORKSHOP_QUOTE,
      entityId: quote.id,
      oldValue: { status: prev },
      newValue: { status: decision },
      meta: { via: 'staff' },
    });
    return this.findOne(eq.id);
  }

  // Comprobante de recepción PDF.
  async receptionPdf(id: string) {
    const eq = await this.eqRepo.findOne({ where: { id } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const customer = eq.customerId ? await this.customerRepo.findOne({ where: { id: eq.customerId } }) : null;
    const contact = eq.contactId ? await this.contactRepo.findOne({ where: { id: eq.contactId } }) : null;
    const ticket = eq.ticketId ? await this.ticketRepo.findOne({ where: { id: eq.ticketId } }) : null;
    const site = eq.ticketId && ticket?.siteId ? await this.siteRepo.findOne({ where: { id: ticket.siteId } }) : null;

    const buffer = await buildReceptionPdf({
      customer: {
        name: contact?.name || customer?.name || eq.customerLabel,
        phone: contact?.phone || null,
        email: contact?.email || null,
        address: site?.address || null,
      },
      equipment: {
        typeLabel: EQUIPMENT_TYPE_LABELS[eq.equipmentType],
        otherType: eq.otherType,
        brand: eq.brand,
        model: eq.model,
        serialNumber: eq.serialNumber,
        accessories: eq.accessories,
        physicalCondition: eq.physicalCondition,
        reportedFault: eq.reportedFault,
        ticketNumber: `E-${eq.id.slice(0, 8).toUpperCase()}`,
        receivedAt: eq.receivedAt,
      },
    });
    return {
      buffer,
      filename: `comprobante-taller-${eq.id.slice(0, 8)}.pdf`,
      mime: 'application/pdf',
    };
  }

  async quotePdf(equipmentId: string, quoteId: string) {
    const eq = await this.eqRepo.findOne({ where: { id: equipmentId } });
    if (!eq) throw new NotFoundException('Equipo no encontrado');
    const quote = await this.quoteRepo.findOne({ where: { id: quoteId, equipmentId } });
    if (!quote) throw new NotFoundException('Presupuesto no encontrado');
    const items = await this.itemRepo.find({ where: { quoteId: quote.id } });
    const customer = eq.customerId ? await this.customerRepo.findOne({ where: { id: eq.customerId } }) : null;
    const contact = eq.contactId ? await this.contactRepo.findOne({ where: { id: eq.contactId } }) : null;

    const buffer = await buildQuotePdf({
      customer: {
        name: contact?.name || customer?.name || eq.customerLabel,
        phone: contact?.phone || null,
        email: contact?.email || null,
      },
      equipment: {
        typeLabel: EQUIPMENT_TYPE_LABELS[eq.equipmentType],
        brand: eq.brand,
        model: eq.model,
        serialNumber: eq.serialNumber,
      },
      quoteNumber: quote.number,
      notes: quote.notes,
      lines: items.map((i) => ({
        name: i.name,
        isLabor: i.isLabor,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: quote.subtotal,
      total: quote.total,
      issuedAt: quote.sentAt || quote.createdAt,
    });
    return {
      buffer,
      filename: `presupuesto-${quote.number}.pdf`,
      mime: 'application/pdf',
    };
  }

  // --------------------------------------------------------------------------
  // Portal (presupuestos del cliente)
  // --------------------------------------------------------------------------

  // Presupuestos pendientes de los equipos del cliente (scope por customerId).
  async portalQuotes(customerId: string, _contactId?: string) {
    const eqs = await this.eqRepo.find({ where: { customerId } });
    if (eqs.length === 0) return [];
    const ids = eqs.map((e) => e.id);
    const quotes = await this.quoteRepo
      .createQueryBuilder('q')
      .where('q.equipmentId IN (:...ids)', { ids })
      .andWhere('q.status = :st', { st: WorkshopQuoteStatus.PENDIENTE })
      .andWhere('q.sentAt IS NOT NULL')
      .orderBy('q.createdAt', 'DESC')
      .getMany();
    const eqById = new Map(eqs.map((e) => [e.id, e]));
    return Promise.all(
      quotes.map(async (q) => ({
        id: q.id,
        number: q.number,
        total: Number(q.total),
        notes: q.notes,
        sentAt: q.sentAt,
        status: q.status,
        equipmentId: q.equipmentId,
        equipment: {
          id: eqById.get(q.equipmentId)!.id,
          typeLabel: this.equipmentTypeLabel(eqById.get(q.equipmentId)!.equipmentType),
          brand: eqById.get(q.equipmentId)!.brand,
          model: eqById.get(q.equipmentId)!.model,
        },
        items: (await this.itemRepo.find({ where: { quoteId: q.id } })).map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: Number(i.unitPrice),
          lineTotal: Number(i.lineTotal),
        })),
      })),
    );
  }

  async portalRespondQuote(quoteId: string, decision: 'aprobado' | 'rechazado', contact: { id: string; customerId: string; email: string; name: string }) {
    const quote = await this.quoteRepo.findOne({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException('Presupuesto no encontrado');
    const eq = await this.eqRepo.findOne({ where: { id: quote.equipmentId } });
    if (!eq || eq.customerId !== contact.customerId) {
      throw new NotFoundException('Presupuesto no encontrado para este cliente');
    }
    if (quote.status !== WorkshopQuoteStatus.PENDIENTE) {
      throw new BadRequestException('El presupuesto ya fue respondido.');
    }
    const prev = quote.status;
    quote.status = decision as WorkshopQuoteStatus;
    quote.respondedAt = new Date();
    quote.respondedById = null;
    await this.quoteRepo.save(quote);
    await this.audit.log({
      user: null,
      action: AuditAction.STATUS_CHANGE,
      entityType: AuditEntityType.WORKSHOP_QUOTE,
      entityId: quote.id,
      oldValue: { status: prev },
      newValue: { status: decision },
      meta: { via: 'portal', contactId: contact.id },
    });
    return { id: quote.id, status: quote.status };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  // Envía (best-effort) el email de notificación por cambio de estado. Si el
  // equipo no tiene contacto/email, loguea WARN y no envía. Nunca lanza (el
  // cambio de estado es la operación crítica; el mail es best-effort).
  private async notifyStatusChange(id: string, status: WorkshopEquipmentStatus, _oldStatus: WorkshopEquipmentStatus): Promise<void> {
    try {
      const eq = await this.eqRepo.findOne({ where: { id } });
      if (!eq) return;
      const contact = eq.contactId ? await this.contactRepo.findOne({ where: { id: eq.contactId } }) : null;
      const customer = eq.customerId ? await this.customerRepo.findOne({ where: { id: eq.customerId } }) : null;
      const to = contact?.email;
      if (!to) {
        this.logger.warn(`[WorkshopMail] equipo ${id}: sin contacto/email, email de estado ${status} omitido`);
        return;
      }

      const contactName = contact?.name || customer?.name || null;
      const comprobanteNumber = `E-${id.slice(0, 8).toUpperCase()}`;
      let attachment: { filename: string; content: Buffer; contentType?: string } | null = null;

      if (status === WorkshopEquipmentStatus.RECIBIDO) {
        // Comprobante de recepción.
        const pdf = await this.receptionPdf(id);
        attachment = { filename: pdf.filename, content: pdf.buffer, contentType: pdf.mime };
      } else if (status === WorkshopEquipmentStatus.DIAGNOSTICADO) {
        // Presupuesto activo, si existe.
        const { quote } = await this.getActiveQuote(id);
        if (quote) {
          try {
            const pdf = await this.quotePdf(id, quote.id);
            attachment = { filename: pdf.filename, content: pdf.buffer, contentType: pdf.mime };
          } catch {
            attachment = null;
          }
        }
      }

      this.logger.log(`[WorkshopMail] Enviando email de estado ${status} a ${to} para equipo ${id}`);
      await this.mail.sendWorkshopStatus({
        status,
        to,
        contactName,
        comprobanteNumber,
        attachment,
      });
      this.logger.log(`[WorkshopMail] Email de estado ${status} enviado a ${to} (equipo ${id})`);
    } catch (e) {
      this.logger.error(`[WorkshopMail] Fallo al enviar email de estado ${status} para equipo ${id}: ${(e as Error).message}`);
    }
  }

  private equipmentTypeLabel(t: EquipmentType): string {
    return EQUIPMENT_TYPE_LABELS[t];
  }

  private statusLabel(s: WorkshopEquipmentStatus): string {
    const labels: Record<WorkshopEquipmentStatus, string> = {
      [WorkshopEquipmentStatus.RECIBIDO]: 'Recibido',
      [WorkshopEquipmentStatus.EN_DIAGNOSTICO]: 'En diagnóstico',
      [WorkshopEquipmentStatus.DIAGNOSTICADO]: 'Diagnosticado',
      [WorkshopEquipmentStatus.EN_REPARACION]: 'En reparación',
      [WorkshopEquipmentStatus.LISTO_PARA_RETIRAR]: 'Listo para retirar',
      [WorkshopEquipmentStatus.ENTREGADO]: 'Entregado',
    };
    return labels[s];
  }

  private decorate(eq: WorkshopEquipment) {
    return {
      ...eq,
      statusLabel: this.statusLabel(eq.status),
      equipmentTypeLabel: EQUIPMENT_TYPE_LABELS[eq.equipmentType],
    };
  }
}
