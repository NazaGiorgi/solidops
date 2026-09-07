import { Injectable, UnauthorizedException, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { Contact } from '../../entities/contact.entity';
import { Customer } from '../../entities/customer.entity';
import { CustomerDomain } from '../../entities/customer-domain.entity';
import { verifyPasswordLazy } from '../../common/auth/password.util';
import { PasswordResetService } from '../../common/auth/password-reset.service';
import { RateLimitService } from '../../common/auth/rate-limit.service';
import { MailService } from '../mail/mail.service';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { AuditAction, AuditEntityType, TicketStatus, TicketPriority, TicketAuthorType, TicketChannel } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { PortalTokenPayload } from './portal.guard';
import { normalizeSubjectKey } from '../../common/utils/subject-key.util';
import { extractEmailDomain, isPersonalEmailDomain } from '../../common/utils/email-domain';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { WorkshopService } from '../workshop/workshop.service';

const FORGOT_OK = { ok: true };

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Nombre humano de una empresa creada a partir de un dominio corporativo nuevo.
// 'miempresa.com.ar' -> 'Miempresa'.
function humanizeDomainName(domain: string): string {
  const label = domain.split('.')[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

@Injectable()
export class PortalService {
  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(CustomerDomain) private readonly customerDomains: Repository<CustomerDomain>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly resetTokens: PasswordResetService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
    private readonly workshop: WorkshopService,
    private readonly dataSource: DataSource,
  ) {}

  async login(email: string, password: string) {
    const contact = await this.contacts
      .createQueryBuilder('c')
      .addSelect('c.portalPasswordHash')
      .addSelect('c.legacyArgon2Hash')
      .where('c.email = :email', { email: email.toLowerCase().trim() })
      .andWhere('c.portal_enabled = true')
      .getOne();
    if (!contact) {
      throw new UnauthorizedException('Credenciales de portal inválidas');
    }
    // Lazy migration: Zammad's Argon2id -> SolidOps bcrypt on first portal login.
    const ok = await verifyPasswordLazy({
      password,
      bcryptHash: contact.portalPasswordHash,
      legacyArgon2Hash: contact.legacyArgon2Hash,
      zammadSecret: this.config.get<string>('zammad.applicationSecret') || null,
      onMigrate: async (newHash) => {
        contact.portalPasswordHash = newHash;
        contact.legacyArgon2Hash = null;
        await this.contacts.save(contact);
      },
    });
    if (!ok) throw new UnauthorizedException('Credenciales de portal inválidas');
    // Cuenta nueva del portal: no puede loguearse hasta verificar el email.
    if (!contact.emailVerifiedAt) {
      throw new UnauthorizedException('Verificá tu correo para activar tu cuenta');
    }

    const payload: PortalTokenPayload = {
      sub: contact.id,
      type: 'portal',
      customerId: contact.customerId,
      email: contact.email ?? '',
      name: contact.name,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.secret'),
      expiresIn: this.config.get('jwt.expiresIn'),
    });
    // Refresh token del portal: se firma con jwt.refreshSecret y lleva un marcador
    // `portal: true` para que el endpoint de refresh del portal lo distinga del
    // refresh de staff (que no lleva ese marcador).
    const refreshToken = await this.jwt.signAsync(
      { ...payload, type: 'refresh', portal: true },
      {
        secret: this.config.get('jwt.refreshSecret'),
        expiresIn: this.config.get('jwt.refreshExpiresIn'),
      },
    );
    return { token, refreshToken, contact: { id: contact.id, name: contact.name, email: contact.email, customerId: contact.customerId } };
  }

  // Refresca el access token del portal a partir de un refresh token de portal.
  // Verifica con jwt.refreshSecret, exige `type: 'refresh'` + `portal: true`, y
  // re-chequea que el contacto siga con portal habilitado (si fue deshabilitado,
  // el refresh falla — no reactiva el acceso).
  async refresh(refreshToken: string) {
    let verified: Record<string, unknown>;
    try {
      verified = await this.jwt.verifyAsync<Record<string, unknown>>(refreshToken, {
        secret: this.config.get('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (verified.type !== 'refresh' || verified.portal !== true) {
      throw new UnauthorizedException('Token inválido');
    }
    const contact = await this.contacts.findOne({ where: { id: String(verified.sub) } });
    if (!contact || !contact.portalEnabled || !contact.emailVerifiedAt) {
      throw new UnauthorizedException('Acceso de portal no disponible');
    }
    const payload: PortalTokenPayload = {
      sub: contact.id,
      type: 'portal',
      customerId: contact.customerId,
      email: contact.email ?? '',
      name: contact.name,
    };
    const token = await this.jwt.signAsync(payload, {
      secret: this.config.get('jwt.secret'),
      expiresIn: this.config.get('jwt.expiresIn'),
    });
    return { token, contact: { id: contact.id, name: contact.name, email: contact.email, customerId: contact.customerId } };
  }

  // --- Tickets (scoped by customerId) ---------------------------------------
  // Default returns the FULL history (all statuses) so clients see past tickets
  // too, not just what's open today. Optional `status` filters the list.
  async listTickets(customerId: string | null, status?: string, search?: string) {
    const qb = this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.customer', 'customer')
      .leftJoinAndSelect('t.technician', 'technician')
      .leftJoinAndSelect('t.slaRecords', 'sla')
      .where('t.customer_id = :cid', { cid: customerId })
      .andWhere('t.shadow = :sh', { sh: false })
      .orderBy('t.createdAt', 'DESC');
    if (status) {
      qb.andWhere('t.status IN (:...statuses)', { statuses: status.split(',') });
    }
    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(t.title) LIKE :term OR t.ticket_number::text ILIKE :term OR ' +
          "('TK-' || EXTRACT(YEAR FROM t.created_at)::int || '-' || t.ticket_number) ILIKE :term)",
        { term },
      );
    }
    return qb.getMany();
  }

  async getTicket(id: string, customerId: string | null) {
    const t = await this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.customer', 'customer')
      .leftJoinAndSelect('t.technician', 'technician')
      .leftJoinAndSelect('t.messages', 'messages')
      .leftJoinAndSelect('messages.attachments', 'attachments')
      .leftJoinAndSelect('t.slaRecords', 'sla')
      .where('t.id = :id', { id })
      .andWhere('t.customer_id = :cid', { cid: customerId })
      .getOne();
    if (!t) throw new NotFoundException('Ticket no encontrado');
    return t;
  }

  async createTicket(
    customerId: string | null,
    contactId: string,
    dto: { title: string; description?: string; priority?: string },
  ) {
    if (!customerId) {
      throw new BadRequestException('Tu cuenta todavía no está vinculada a una empresa');
    }
    const [numRow] = await this.dataSource.query(`SELECT nextval('ticket_number_seq') AS n`);
    const ticket = this.tickets.create({
      customerId,
      contactId,
      title: dto.title,
      description: dto.description ?? null,
      source: 'portal',
      status: TicketStatus.NUEVO,
      priority: (dto.priority as TicketPriority) ?? TicketPriority.NORMAL,
      subjectKey: normalizeSubjectKey(dto.title),
      ticketNumber: Number(numRow.n),
      shadow: false,
      firstResponseAt: null,
      resolvedAt: null,
    });
    const saved = await this.tickets.save(ticket);
    await this.messages.save(
      this.messages.create({
        ticketId: saved.id,
        authorType: TicketAuthorType.CLIENTE,
        channel: TicketChannel.PORTAL,
        body: dto.description ?? '(sin descripción)',
      }),
    );
    return this.getTicket(saved.id, customerId);
  }

  async addMessage(ticketId: string, customerId: string | null, body: string) {
    if (!customerId) throw new NotFoundException('Ticket no encontrado');
    const t = await this.tickets.findOne({ where: { id: ticketId, customerId } });
    if (!t) throw new NotFoundException('Ticket no encontrado');
    const message = this.messages.create({
      ticketId,
      authorType: TicketAuthorType.CLIENTE,
      channel: TicketChannel.PORTAL,
      body,
    });
    await this.messages.save(message);
    return this.getTicket(ticketId, customerId);
  }

  // Reports for the client portal: only the customer's own tickets, by
  // status/priority and SLA compliance.
  async reports(customerId: string | null) {
    const tickets = await this.tickets
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.slaRecords', 'sla')
      .where('t.customer_id = :cid', { cid: customerId })
      .andWhere('t.shadow = :sh', { sh: false })
      .getMany();

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const slaStatus: Record<string, number> = { verde: 0, amarillo: 0, rojo: 0 };
    for (const t of tickets) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      const latest = t.slaRecords?.[0];
      slaStatus[latest?.status ?? 'verde'] = (slaStatus[latest?.status ?? 'verde'] || 0) + 1;
    }

    return { byStatus, byPriority, slaStatus, total: tickets.length };
  }

  // Request a password reset for a portal contact. Uniform response whether or
  // not the email exists; rate limited per IP + email.
  async forgotPassword(email: string, ip: string): Promise<typeof FORGOT_OK> {
    const normalized = (email || '').toLowerCase().trim();
    await this.rateLimit.check(RateLimitService.consumerKey(ip), 5, 3600);
    await this.rateLimit.check(RateLimitService.consumerKey(ip, normalized), 3, 3600);

    const contact = await this.contacts.findOne({ where: { email: normalized } });
    if (!contact || !contact.portalEnabled) {
      return FORGOT_OK;
    }

    const rawToken = await this.resetTokens.create('contact', contact.id);
    const frontend = this.config.get<string>('frontendUrl') || 'http://localhost:3000';
    const resetUrl = `${frontend}/reset-password?token=${encodeURIComponent(rawToken)}&type=portal`;
    await this.mail.sendPasswordReset(contact.email || normalized, resetUrl);

    await this.audit.log({
      user: null,
      action: AuditAction.PASSWORD_RESET_REQUEST,
      entityType: AuditEntityType.CONTACT,
      entityId: contact.id,
      meta: { email: contact.email },
    });
    return FORGOT_OK;
  }

  // Complete a portal contact password reset with a one-time token.
  async resetPassword(rawToken: string, next: string): Promise<void> {
    if (next.length < 8) {
      throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');
    }
    const contactId = await this.resetTokens.consume('contact', rawToken);
    const contact = await this.contacts.findOne({ where: { id: contactId } });
    if (!contact) throw new BadRequestException('El enlace de recuperación no es válido');

    contact.portalPasswordHash = await bcrypt.hash(next, 10);
    contact.legacyArgon2Hash = null;
    const saved = await this.contacts.save(contact);

    await this.audit.log({
      user: null,
      action: AuditAction.PASSWORD_RESET,
      entityType: AuditEntityType.CONTACT,
      entityId: saved.id,
      meta: { email: saved.email },
    });
  }

  // --- Registro de cuenta en el portal --------------------------------------

  // Alta de cuenta: crea el contacto SIN empresa y bloqueado hasta verificar el
  // email (24 h). El vínculo por dominio corre en verifyEmail, no acá.
  async register(
    dto: { name: string; email: string; password: string },
    ip: string,
  ): Promise<{ ok: true }> {
    const name = (dto.name || '').trim();
    const email = (dto.email || '').toLowerCase().trim();
    if (!name) throw new BadRequestException('Ingresá tu nombre');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Email inválido');
    if (dto.password.length < 8) throw new BadRequestException('La contraseña debe tener al menos 8 caracteres');

    await this.rateLimit.check(`portal-register:${ip}`, 10, 3600);
    await this.rateLimit.check(`portal-register:${email}`, 3, 3600);

    const existing = await this.contacts.findOne({ where: { email } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese email');

    const rawToken = randomBytes(24).toString('hex');
    const contact = this.contacts.create({
      name,
      email,
      customerId: null,
      portalEnabled: true,
      portalPasswordHash: await bcrypt.hash(dto.password, 10),
      legacyArgon2Hash: null,
      emailVerifiedAt: null,
      emailVerificationTokenHash: sha256(rawToken),
      emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await this.contacts.save(contact);

    const frontend = this.config.get<string>('frontendUrl') || 'http://localhost:3000';
    const verifyUrl = `${frontend}/portal/verify-email?token=${encodeURIComponent(rawToken)}`;
    await this.mail.sendEmailVerification(contact.email || email, { name: contact.name, link: verifyUrl });

    await this.audit.log({
      user: null,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.CONTACT,
      entityId: contact.id,
      meta: { email: contact.email, registered: true },
    });
    return { ok: true };
  }

  // Confirma el email (token de un solo uso, 24 h) y corre el vínculo por
  // dominio: dominio corporativo conocido -> asocia a esa empresa; dominio nuevo
  // -> crea la empresa desde el dominio; dominio personal -> queda sin empresa
  // (huérfano) para la bandeja de staff.
  async verifyEmail(rawToken: string, ip: string): Promise<{
    verified: true;
    account: { id: string; name: string; email: string };
    linked: boolean;
    reason: string;
    customerId?: string | null;
    customerName?: string | null;
  }> {
    await this.rateLimit.check(`portal-verify:${ip}`, 10, 3600);
    const tokenHash = sha256(rawToken);
    const contact = await this.contacts
      .createQueryBuilder('c')
      .where('c.email_verification_token_hash = :h', { h: tokenHash })
      .andWhere('c.deleted_at IS NULL')
      .getOne();
    if (!contact || contact.emailVerifiedAt) {
      throw new BadRequestException('El enlace de verificación no es válido o ya fue usado');
    }
    if (!contact.emailVerificationExpiresAt || contact.emailVerificationExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('El enlace de verificación expiró. Volvé a registrarte o contactá a soporte');
    }

    contact.emailVerifiedAt = new Date();
    contact.emailVerificationTokenHash = null;
    contact.emailVerificationExpiresAt = null;
    await this.contacts.save(contact);

    const link = await this.linkByDomain(contact);
    await this.audit.log({
      user: null,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CONTACT,
      entityId: contact.id,
      meta: { email: contact.email, verified: true, ...link },
    });

    return {
      verified: true,
      account: { id: contact.id, name: contact.name, email: contact.email || '' },
      ...link,
    };
  }

  // Lógica de auto-vínculo por dominio (corre en la confirmación del email).
  private async linkByDomain(
    contact: Contact,
  ): Promise<{ linked: boolean; reason: string; customerId?: string | null; customerName?: string | null }> {
    const domain = extractEmailDomain(contact.email || '');
    if (!domain || isPersonalEmailDomain(domain)) {
      return { linked: false, reason: 'personal', customerId: null, customerName: null };
    }

    const row = await this.customerDomains.findOne({ where: { domain }, relations: { customer: true } });
    if (row) {
      const customer = row.customer;
      if (!customer || (customer.deletedAt && customer.deletedAt !== null)) {
        return { linked: false, reason: 'personal', customerId: null, customerName: null };
      }
      contact.customerId = row.customerId;
      await this.contacts.save(contact);
      return { linked: true, reason: 'linked', customerId: row.customerId, customerName: customer.name };
    }

    // Dominio corporativo desconocido -> se crea la empresa desde el dominio.
    const display = humanizeDomainName(domain);
    let customer = await this.customers
      .createQueryBuilder('c')
      .where('LOWER(c.name) = :n', { n: display.toLowerCase() })
      .andWhere('c.deleted_at IS NULL')
      .getOne();
    if (!customer) {
      customer = this.customers.create({ name: display, active: true });
      customer = await this.customers.save(customer);
      await this.customerDomains.save(this.customerDomains.create({ customerId: customer.id, domain }));
      await this.audit.log({
        user: null,
        action: AuditAction.CREATE,
        entityType: AuditEntityType.CUSTOMER,
        entityId: customer.id,
        meta: { fromDomain: domain },
      });
    }
    contact.customerId = customer.id;
    await this.contacts.save(contact);
    return { linked: true, reason: 'created', customerId: customer.id, customerName: customer.name };
  }

  // Perfil del contacto de portal con datos FRESCOS de BD (no del claim del JWT):
// refleja asignaciones de empresa hechas por staff mientras la sesión sigue viva.
  async me(contactId: string): Promise<{ id: string; name: string; email: string | null; customerId: string | null }> {
    const c = await this.contacts.findOne({ where: { id: contactId } });
    if (!c) throw new NotFoundException('Contacto no encontrado');
    return { id: c.id, name: c.name, email: c.email, customerId: c.customerId };
  }

  // --- Bandeja de staff: usuarios del portal sin empresa ---------------------

  // Usuarios del portal registrados (verificados o pendientes) que aún no están
  // vinculados a ninguna empresa.
  async orphans(): Promise<
    Array<{
      id: string;
      name: string;
      email: string | null;
      portalEnabled: boolean;
      emailVerifiedAt: Date | null;
      createdAt: Date;
    }>
  > {
    const rows = await this.contacts
      .createQueryBuilder('c')
      .addSelect('c.emailVerifiedAt')
      .where('c.customer_id IS NULL')
      .andWhere('c.deleted_at IS NULL')
      .orderBy('c.createdAt', 'DESC')
      .getMany();
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      portalEnabled: c.portalEnabled,
      emailVerifiedAt: c.emailVerifiedAt,
      createdAt: c.createdAt,
    }));
  }

  async assignOrphan(contactId: string, customerId: string, actor: AuthenticatedUser): Promise<{ id: string; customerId: string | null }> {
    const contact = await this.contacts.findOne({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    if (contact.customerId) throw new BadRequestException('La cuenta ya está vinculada a una empresa');
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Cliente no encontrado');

    contact.customerId = customerId;
    if (!contact.portalEnabled) contact.portalEnabled = true;
    const saved = await this.contacts.save(contact);

    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CONTACT,
      entityId: saved.id,
      newValue: { customerId, portalEnabled: saved.portalEnabled },
    });
    return { id: saved.id, customerId: saved.customerId };
  }

  // Rechazar la cuenta huérfana: se deshabilita el acceso al portal (la cuenta
  // queda conservada, visible para auditabilidad).
  async rejectOrphan(contactId: string, actor: AuthenticatedUser): Promise<{ ok: true }> {
    const contact = await this.contacts.findOne({ where: { id: contactId } });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    contact.portalEnabled = false;
    const saved = await this.contacts.save(contact);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.CONTACT,
      entityId: saved.id,
      newValue: { portalEnabled: false },
    });
    return { ok: true };
  }

  // --- Presupuestos de taller (portal) --------------------------------------

  async quotes(customerId: string | null, contactId: string) {
    if (!customerId) return [];
    return this.workshop.portalQuotes(customerId, contactId);
  }

  async respondQuote(quoteId: string, decision: 'aprobado' | 'rechazado', contact: { id: string; customerId: string | null; email: string; name: string }) {
    if (!contact.customerId) {
      throw new BadRequestException('Tu cuenta todavía no está vinculada a una empresa');
    }
    return this.workshop.portalRespondQuote(quoteId, decision, contact as { id: string; customerId: string; email: string; name: string });
  }
}
