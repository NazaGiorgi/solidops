import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Customer } from '../../entities/customer.entity';
import { Contact } from '../../entities/contact.entity';
import { Site } from '../../entities/site.entity';
import { Contract } from '../../entities/contract.entity';
import { Ticket } from '../../entities/ticket.entity';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  CreateContactDto,
  UpdateContactDto,
  CreateSiteDto,
  UpdateSiteDto,
  CreateContractDto,
  UpdateContractDto,
  UpdateContactPortalDto,
  SetContactPortalPasswordDto,
} from './dto';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import {
  extractEmailDomain,
  isPersonalEmailDomain,
} from '../../common/utils/email-domain';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Site) private readonly sites: Repository<Site>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // --- Customer ------------------------------------------------------------
  // Lista clientes con búsqueda por nombre, email de contacto o dominio de
  // empresa (customer_domains). Devuelve una fila por empresa (getMany agrupa
  // por PK del root; los joins repetidos no duplican resultados).
  async findAllCustomers(search?: string) {
    const qb = this.customers
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.contacts', 'contacts')
      .leftJoinAndSelect('c.contracts', 'contracts');
    const term = (search || '').trim();
    if (term) {
      qb.leftJoinAndSelect('c.domains', 'domains');
      // Si el término parece un email completo, además buscar coincidencia EXACTA
      // con el dominio (p.ej. buscar usuario@melacrom.com.ar también encuentra la
      // empresa Melacrom aunque ningún contacto tenga ese email exacto).
      const atIdx = term.indexOf('@');
      const domainPart = atIdx > 0 ? term.slice(atIdx + 1).trim().toLowerCase() : '';
      qb.andWhere(
        `(c.name ILIKE :search OR contacts.email ILIKE :search OR domains.domain ILIKE :search${
          domainPart ? ' OR domains.domain = :domainExact' : ''
        })`,
        { search: `%${term}%`, ...(domainPart ? { domainExact: domainPart } : {}) },
      );
    }
    const rows = await qb.orderBy('c.name', 'ASC').getMany();
    return rows.map((c) => ({
      ...c,
      contactCount: c.contacts?.length ?? 0,
      contractCount: c.contracts?.length ?? 0,
    }));
  }

  async findCustomer(id: string) {
    const c = await this.customers.findOne({
      where: { id },
      relations: { contacts: true, sites: true, contracts: true },
    });
    if (!c) throw new NotFoundException('Cliente no encontrado');
    // Exponer si el contacto tiene contraseña de portal (boolean, nunca el hash),
    // para que la UI pueda avisar cuando el portal está habilitado sin contraseña.
    if (c.contacts && c.contacts.length) {
      const ids = c.contacts.map((x) => x.id);
      const withHash = await this.contacts
        .createQueryBuilder('co')
        .select('co.id', 'id')
        .where('co.id IN (:...ids)', { ids })
        .andWhere('(co.portal_password_hash IS NOT NULL OR co.legacy_argon2_hash IS NOT NULL)')
        .getRawMany<{ id: string }>();
      const hashSet = new Set(withHash.map((r) => r.id));
      c.contacts = c.contacts.map((contact) => ({
        ...contact,
        hasPortalPassword: hashSet.has(contact.id),
      })) as Contact[];
    }
    return c;
  }

  // Sugerencia de unificación por dominio: si el email ingresado tiene un
  // dominio NO personal, busca clientes que ya tengan al menos un contacto con
  // ese mismo dominio (distinto del customer actual, para no auto-sugerirse).
  // Se excluye el `customerId` actual porque agregar un contacto a ese cliente
  // es la operación normal y no debe sugerirse a sí mismo.
  async suggestByDomain(email: string, excludeCustomerId?: string) {
    const domain = extractEmailDomain(email || '');
    if (!domain || isPersonalEmailDomain(domain)) {
      return { excluded: true, domain, candidates: [] };
    }
    const qb = this.contacts
      .createQueryBuilder('co')
      .select('co.customer_id', 'customerId')
      .addSelect('MIN(c.name)', 'customerName')
      .addSelect('COUNT(*)', 'contactCount')
      .leftJoin('co.customer', 'c')
      .where('LOWER(co.email) LIKE :d', { d: `%@${domain.replace(/[%_]/g, '')}` })
      .andWhere('co.deleted_at IS NULL');
    if (excludeCustomerId) {
      qb.andWhere('co.customer_id <> :excl', { excl: excludeCustomerId });
    }
    const rows = await qb
      .groupBy('co.customer_id')
      .orderBy('"contactCount"', 'DESC')
      .getRawMany();
    const candidates = rows.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      contactCount: Number(r.contactCount),
    }));
    return { excluded: false, domain, candidates };
  }

  async createCustomer(dto: CreateCustomerDto, actor: AuthenticatedUser) {
    const c = await this.customers.save(this.customers.create(dto));
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.CUSTOMER,
      entityId: c.id,
      newValue: { name: c.name },
    });
    return c;
  }

  async updateCustomer(
    id: string,
    dto: UpdateCustomerDto,
    actor: AuthenticatedUser,
  ) {
    const c = await this.findCustomer(id);
    const old = { name: c.name, active: c.active };
    Object.assign(c, dto);
    await this.customers.save(c);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CUSTOMER,
      entityId: id,
      oldValue: old,
      newValue: { name: c.name, active: c.active },
    });
    return c;
  }

  // Soft delete (admin/supervisor only); history preserved.
  async softDeleteCustomer(id: string, actor: AuthenticatedUser) {
    const c = await this.findCustomer(id);
    await this.customers.softRemove(c);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.CUSTOMER,
      entityId: id,
      meta: { softDelete: true },
    });
    return { ok: true };
  }

  // --- Contact -------------------------------------------------------------
  async findContacts(customerId: string) {
    return this.contacts.find({ where: { customerId }, order: { name: 'ASC' } });
  }

  async createContact(
    customerId: string,
    dto: CreateContactDto,
    actor: AuthenticatedUser,
  ) {
    const c = this.contacts.create({ ...dto, customerId });
    const saved = await this.contacts.save(c);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.CONTACT,
      entityId: saved.id,
      newValue: { name: saved.name, email: saved.email, customerId },
    });
    return saved;
  }

  async updateContact(
    customerId: string,
    id: string,
    dto: UpdateContactDto,
    actor: AuthenticatedUser,
  ) {
    const contact = await this.contacts.findOne({ where: { id, customerId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    const old = { name: contact.name, email: contact.email };
    Object.assign(contact, dto);
    await this.contacts.save(contact);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CONTACT,
      entityId: id,
      oldValue: old,
      newValue: { name: contact.name, email: contact.email },
    });
    return contact;
  }

  async softDeleteContact(id: string, actor: AuthenticatedUser) {
    const contact = await this.contacts.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    await this.contacts.softRemove(contact);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.CONTACT,
      entityId: id,
      meta: { softDelete: true },
    });
    return { ok: true };
  }

  // Vincula el número de WhatsApp de un contacto genérico "Cliente WA {n}" a un
  // contacto/cliente real ya existente. En una transacción:
  //   1) Guarda el número en el contacto real (campo `whatsapp`). Si el destino
  //      ya tenía otro número de WhatsApp, ese previo se conserva moviéndolo a
  //      `phone` (el lookup por whatsapp/phone sigue encontrando al contacto por
  //      el número recién vinculado).
  //   2) Reasigna TODOS los tickets del contacto genérico al real — contactId Y
  //      customerId, para que queden bajo el cliente correcto (mismo espíritu de
  //      reasignación que `ticket-groups.deactivate()` / merge de tickets).
  //   3) Marca el contacto genérico como fusionado con soft-remove (deleted_at),
  //      sin borrarlo: queda la trazabilidad, y el lookup de WhatsApp lo excluye
  //      automáticamente (no se vuelven a crear duplicados para ese número).
  async linkToContact(placeholderId: string, targetContactId: string, actor: AuthenticatedUser) {
    return this.dataSource.transaction(async (mgr) => {
      const contactRepo = mgr.getRepository(Contact);
      const ticketRepo = mgr.getRepository(Ticket);

      const placeholder = await contactRepo.findOne({ where: { id: placeholderId } });
      if (!placeholder) throw new NotFoundException('Contacto genérico de WhatsApp no encontrado');
      const target = await contactRepo.findOne({
        where: { id: targetContactId },
        relations: { customer: true },
      });
      if (!target) throw new NotFoundException('Contacto destino no encontrado');
      if (placeholder.id === target.id) {
        throw new BadRequestException('No se puede vincular un contacto consigo mismo');
      }
      if (!placeholder.whatsapp) {
        throw new BadRequestException('El contacto genérico no tiene número de WhatsApp asociado');
      }

      // 1) Número en el contacto real.
      if (target.whatsapp !== placeholder.whatsapp) {
        if (target.whatsapp && !target.phone) target.phone = target.whatsapp;
        target.whatsapp = placeholder.whatsapp;
      }

      // 2) Reasignar tickets (contacto + cliente).
      const toMove = await ticketRepo.find({ where: { contactId: placeholder.id } });
      let moved = 0;
      for (const t of toMove) {
        const oldCustomerId = t.customerId;
        t.contactId = target.id;
        t.customerId = target.customerId;
        await ticketRepo.save(t);
        moved++;
        await this.audit.log({
          user: actor,
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.TICKET,
          entityId: t.id,
          oldValue: { contactId: placeholder.id, customerId: oldCustomerId },
          newValue: { contactId: target.id, customerId: target.customerId },
          meta: { action: 'link_whatsapp_contact' },
        });
      }

      // 3) Marcar genérico como fusionado (soft-delete, no borrado físico).
      await contactRepo.softRemove(placeholder);
      await contactRepo.save(target);

      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.CONTACT,
        entityId: placeholder.id,
        oldValue: { customerId: placeholder.customerId, name: placeholder.name },
        newValue: { mergedInto: target.id, customerId: target.customerId, whatsapp: target.whatsapp },
        meta: { action: 'link_whatsapp_contact', softDeleted: true },
      });

      return {
        ok: true,
        movedTickets: moved,
        linkedTo: {
          contactId: target.id,
          customerId: target.customerId,
          customerName: target.customer?.name ?? null,
        },
      };
    });
  }

  // --- Contact portal access (P2) ------------------------------------------
  // Este endpoint SOLO habilita/deshabilita el acceso al portal. NO toca la
  // contraseña: la fijación/cambio de contraseña de portal es responsabilidad
  // exclusiva de `POST /customers/:id/contacts/:contactId/portal/password`
  // (mecanismo único). Antes este endpoint también hasheaba un `password` que
  // venía del form, lo que permitía que un valor residual pisara en silencio la
  // contraseña correcta fijada por el staff.
  async updateContactPortal(
    customerId: string,
    id: string,
    dto: { enabled: boolean },
    actor: AuthenticatedUser,
  ) {
    const contact = await this.contacts.findOne({ where: { id, customerId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    const old = { portalEnabled: contact.portalEnabled };
    contact.portalEnabled = dto.enabled;
    const saved = await this.contacts.save(contact);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CONTACT,
      entityId: id,
      oldValue: old as unknown as Record<string, unknown>,
      newValue: { portalEnabled: saved.portalEnabled },
    });
    // Return safe representation (never the hash).
    const { portalPasswordHash, legacyArgon2Hash, ...rest } = saved;
    void portalPasswordHash;
    void legacyArgon2Hash;
    return { ...rest };
  }

  // Fija manualmente la contraseña de portal de un contacto (staff). A diferencia
  // del flujo de autoservicio (reset-password), NO hay email de por medio: el
  // staff ve/copia la contraseña y se la comunica al cliente por el canal que
  // corresponda. Hashea con el mismo bcrypt(10) que reset-password, no toca
  // portal_enabled y audita el hecho (sin guardar la contraseña ni el hash).
  async setContactPortalPassword(
    customerId: string,
    id: string,
    dto: { password: string },
    actor: AuthenticatedUser,
  ) {
    if (!dto?.password || dto.password.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const contact = await this.contacts
      .createQueryBuilder('c')
      .addSelect('c.portalPasswordHash')
      .where('c.id = :id', { id })
      .andWhere('c.customer_id = :customerId', { customerId })
      .getOne();
    if (!contact) throw new NotFoundException('Contacto no encontrado');

    contact.portalPasswordHash = await bcrypt.hash(dto.password, 10);
    contact.legacyArgon2Hash = null;
    const saved = await this.contacts.save(contact);

    await this.audit.log({
      user: actor,
      action: AuditAction.PASSWORD_RESET,
      entityType: AuditEntityType.CONTACT,
      entityId: saved.id,
      meta: { email: saved.email, changedByStaff: true, method: 'manual' },
    });

    // Nunca devolver ni loguear la contraseña (ni su hash).
    return { ok: true, email: saved.email, portalEnabled: saved.portalEnabled };
  }

  // --- Site ----------------------------------------------------------------
  async findSites(customerId: string) {
    return this.sites.find({ where: { customerId } });
  }

  async createSite(customerId: string, dto: CreateSiteDto, actor: AuthenticatedUser) {
    const saved = await this.sites.save(this.sites.create({ ...dto, customerId }));
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.SITE,
      entityId: saved.id,
      newValue: { name: saved.name, customerId },
    });
    return saved;
  }

  async updateSite(
    customerId: string,
    id: string,
    dto: UpdateSiteDto,
    actor: AuthenticatedUser,
  ) {
    const site = await this.sites.findOne({ where: { id, customerId } });
    if (!site) throw new NotFoundException('Sitio no encontrado');
    Object.assign(site, dto);
    return this.sites.save(site);
  }

  // --- Contract ------------------------------------------------------------
  async findContracts(customerId: string) {
    return this.contracts.find({ where: { customerId }, order: { createdAt: 'DESC' } });
  }

  // Returns the active contract (the SLA basis). Falls back to first.
  async activeContract(customerId: string): Promise<Contract | null> {
    const contracts = await this.contracts.find({
      where: { customerId, active: true },
      order: { createdAt: 'DESC' },
    });
    return contracts[0] ?? null;
  }

  async createContract(
    customerId: string,
    dto: CreateContractDto,
    actor: AuthenticatedUser,
  ) {
    await this.findCustomer(customerId);
    const saved = await this.contracts.save(
      this.contracts.create({ ...dto, customerId }),
    );
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.CONTRACT,
      entityId: saved.id,
      newValue: { name: saved.name, customerId },
    });
    return saved;
  }

  async updateContract(
    customerId: string,
    id: string,
    dto: UpdateContractDto,
    actor: AuthenticatedUser,
  ) {
    const contract = await this.contracts.findOne({ where: { id, customerId } });
    if (!contract) throw new NotFoundException('Contrato no encontrado');
    Object.assign(contract, dto);
    const saved = await this.contracts.save(contract);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CONTRACT,
      entityId: id,
      newValue: {
        slaFirstResponseMinutes: saved.slaFirstResponseMinutes,
        slaResolutionHours: saved.slaResolutionHours,
      },
    });
    return saved;
  }
}
