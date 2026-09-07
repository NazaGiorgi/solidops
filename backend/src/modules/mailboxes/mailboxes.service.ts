import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { Mailbox } from '../../entities/mailbox.entity';
import { CryptoService } from '../../crypto/crypto.service';
import { ImapService } from './imap.service';
import {
  CreateMailboxDto,
  UpdateMailboxDto,
  TestMailboxDto,
} from './dto';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const MASK = '••••••••';

@Injectable()
export class MailboxesService {
  constructor(
    @InjectRepository(Mailbox) private readonly mailboxes: Repository<Mailbox>,
    private readonly crypto: CryptoService,
    private readonly imap: ImapService,
    private readonly audit: AuditService,
  ) {}

  // Convert an entity to a safe response: mask all secrets.
  private toSafe(m: Mailbox) {
    return {
      id: m.id,
      email: m.email,
      imapHost: m.imapHost,
      imapPort: m.imapPort,
      imapUser: m.imapUser,
      imapPassword: MASK, // never the real value
      imapSsl: m.imapSsl,
      smtpHost: m.smtpHost,
      smtpPort: m.smtpPort,
      smtpUser: m.smtpUser,
      smtpPassword: m.smtpPassword ? MASK : null,
      smtpSsl: m.smtpSsl,
      smtpSecurity: m.smtpSecurity,
      keepOnServer: m.keepOnServer,
      active: m.active,
      shadowMode: m.shadowMode,
      defaultDestination: m.defaultDestination,
      lastProcessedUid: m.lastProcessedUid,
      lastCheckedAt: m.lastCheckedAt,
      lastError: m.lastError,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    };
  }

  private toSafeList(list: Mailbox[]) {
    return list.map((m) => this.toSafe(m));
  }

  async findAll(): Promise<ReturnType<MailboxesService['toSafeList']>> {
    return this.toSafeList(await this.mailboxes.find({ order: { createdAt: 'ASC' } }));
  }

  async findOne(id: string) {
    const m = await this.mailboxes.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Casilla no encontrada');
    return this.toSafe(m);
  }

  async create(dto: CreateMailboxDto, actor: AuthenticatedUser) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.mailboxes.findOne({ where: { email } });
    if (existing) throw new BadRequestException('Ya existe una casilla con ese email');

    if (!dto.imapPassword) {
      throw new BadRequestException(
        'La contraseña IMAP es obligatoria al crear una casilla',
      );
    }

    const m = this.mailboxes.create({
      email,
      imapHost: dto.imapHost,
      imapPort: dto.imapPort,
      imapUser: dto.imapUser,
      imapPassword: this.crypto.encrypt(dto.imapPassword),
      imapSsl: dto.imapSsl,
      smtpHost: dto.smtpHost ?? null,
      smtpPort: dto.smtpPort ?? null,
      smtpUser: dto.smtpUser ?? null,
      smtpPassword: dto.smtpPassword ? this.crypto.encrypt(dto.smtpPassword) : null,
      smtpSsl: dto.smtpSsl ?? true,
      smtpSecurity: dto.smtpSecurity ?? null,
      keepOnServer: dto.keepOnServer ?? true,
      active: dto.active ?? true,
      shadowMode: dto.shadowMode ?? false,
      defaultDestination: dto.defaultDestination ?? '',
      lastCheckedAt: null,
      lastError: null,
    });
    const saved = await this.mailboxes.save(m);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.MAILBOX,
      entityId: saved.id,
      newValue: { email: saved.email, shadowMode: saved.shadowMode },
    });
    return this.toSafe(saved);
  }

  async update(id: string, dto: UpdateMailboxDto, actor: AuthenticatedUser) {
    const m = await this.mailboxes.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Casilla no encontrada');
    const old = { email: m.email, active: m.active, shadowMode: m.shadowMode };

    if (dto.email !== undefined) m.email = dto.email.toLowerCase().trim();
    if (dto.imapHost !== undefined) m.imapHost = dto.imapHost;
    if (dto.imapPort !== undefined) m.imapPort = dto.imapPort;
    if (dto.imapUser !== undefined) m.imapUser = dto.imapUser;
    if (dto.imapPassword !== undefined && dto.imapPassword !== '' && dto.imapPassword !== MASK) {
      m.imapPassword = this.crypto.encrypt(dto.imapPassword);
    }
    if (dto.imapSsl !== undefined) m.imapSsl = dto.imapSsl;
    if (dto.smtpHost !== undefined) m.smtpHost = dto.smtpHost;
    if (dto.smtpPort !== undefined) m.smtpPort = dto.smtpPort;
    if (dto.smtpUser !== undefined) m.smtpUser = dto.smtpUser;
    if (dto.smtpPassword !== undefined && dto.smtpPassword !== '' && dto.smtpPassword !== MASK) {
      m.smtpPassword = this.crypto.encrypt(dto.smtpPassword);
    }
    if (dto.smtpSsl !== undefined) m.smtpSsl = dto.smtpSsl;
    if (dto.smtpSecurity !== undefined) m.smtpSecurity = dto.smtpSecurity;
    if (dto.keepOnServer !== undefined) m.keepOnServer = dto.keepOnServer;
    if (dto.active !== undefined) m.active = dto.active;
    if (dto.shadowMode !== undefined) m.shadowMode = dto.shadowMode;
    if (dto.defaultDestination !== undefined) m.defaultDestination = dto.defaultDestination;

    const saved = await this.mailboxes.save(m);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.MAILBOX,
      entityId: id,
      oldValue: old as unknown as Record<string, unknown>,
      newValue: { email: saved.email, active: saved.active, shadowMode: saved.shadowMode },
    });
    return this.toSafe(saved);
  }

  async deactivate(id: string, actor: AuthenticatedUser) {
    const m = await this.mailboxes.findOne({ where: { id } });
    if (!m) throw new NotFoundException('Casilla no encontrada');
    m.active = false;
    const saved = await this.mailboxes.save(m);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.MAILBOX,
      entityId: id,
      oldValue: { active: true },
      newValue: { active: false },
    });
    return this.toSafe(saved);
  }

  // Verify IMAP credentials without persisting.
  async testConnection(dto: TestMailboxDto) {
    return this.imap.testConnection({
      host: dto.imapHost,
      port: dto.imapPort,
      user: dto.imapUser,
      password: dto.imapPassword,
      ssl: dto.imapSsl,
    });
  }

  // Used by the worker: list all active mailboxes with their decrypted creds.
  async activeMailboxesForWorker(): Promise<Array<Mailbox & { decryptedImapPassword: string }>> {
    const list = await this.mailboxes.find({ where: { active: true } });
    return list.map((m) => ({
      ...m,
      decryptedImapPassword: this.crypto.decrypt(m.imapPassword),
    }));
  }

  // SMTP config used for system outbound email (e.g. password reset links).
  // Prefers the `soporte@solidocs.com.ar` mailbox, else any mailbox that has
  // SMTP host + user + password configured. Returns null when none is usable.
  async getSmtpConfig(): Promise<{
    host: string;
    port: number;
    user: string;
    password: string;
    secure: boolean;
    requireTLS: boolean;
    from: string;
  } | null> {
    const list = await this.mailboxes.find();
    const pick =
      list.find((m) => m.email === 'soporte@solidocs.com.ar') ||
      list.find((m) => m.smtpHost && m.smtpUser && m.smtpPassword);
    if (!pick || !pick.smtpHost || !pick.smtpUser || !pick.smtpPassword) return null;
    // Security model: 'starttls' (587) = plain then upgrade; anything else /
    // null = implicit SSL/TLS (465) for backward compatibility.
    const starttls = pick.smtpSecurity === 'starttls';
    return {
      host: pick.smtpHost,
      port: pick.smtpPort ?? (starttls ? 587 : 465),
      user: pick.smtpUser,
      password: this.crypto.decrypt(pick.smtpPassword),
      secure: !starttls,
      requireTLS: starttls,
      from: pick.email,
    };
  }

  // Deactivate an existing mailbox by email (idempotent). Used to avoid leaking
  // that an address exists.
  async findByEmail(email: string): Promise<Mailbox | null> {
    return this.mailboxes.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  // Verify SMTP transport (handshake) WITHOUT sending an email. Shows the real
  // server error code/message so a config issue is not confused with IMAP.
  async testSmtp(dto: { smtpHost: string; smtpPort: number; smtpUser: string; smtpPassword: string; smtpSecurity: string }) {
    const starttls = dto.smtpSecurity === 'starttls';
    const transport = nodemailer.createTransport({
      host: dto.smtpHost,
      port: dto.smtpPort,
      secure: !starttls,
      requireTLS: starttls,
      auth: { user: dto.smtpUser, pass: dto.smtpPassword },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 15000,
    });
    try {
      await transport.verify();
      return { ok: true, message: `conexión SMTP exitosa (${dto.smtpHost}:${dto.smtpPort})` };
    } catch (e) {
      const err = e as Error & { responseCode?: string; code?: string; response?: string };
      const detail =
        err.responseCode || err.code || err.message || 'error de conexión SMTP';
      // Include the server's SMTP response text when available (e.g. "535 auth failed").
      const extra = err.response ? ` — ${String(err.response).trim()}` : '';
      return { ok: false, message: `${detail}${extra}` };
    } finally {
      transport.close();
    }
  }
}
