import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailboxRule } from '../../entities/mailbox-rule.entity';
import { Mailbox } from '../../entities/mailbox.entity';
import { Asset } from '../../entities/asset.entity';
import { Customer } from '../../entities/customer.entity';
import { Document } from '../../entities/document.entity';
import { InboundMailLog } from '../../entities/inbound-mail-log.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { CreateMailboxRuleDto, UpdateMailboxRuleDto } from './mailbox-rules.dto';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

export interface InboundMailMeta {
  fromEmail: string;
  subject: string;
  body?: string | null;
}

export interface RoutingDecision {
  rule: MailboxRule | null;
  destination: 'ticket' | 'document' | 'discard';
  matchedRuleId?: string;
  customerId?: string | null;
  assetId?: string | null;
  // Nombre del box destino (si la regla enruta a un box del catálogo). Cuando
  // está presente, el ticket creado se asigna a ese box (tickets.legacy_group).
  targetGroupName?: string | null;
}

// Compiles a pattern to a RegExp. Treats the pattern as plain text unless it
// contains wildcards (`*`) or regex metacharacters; in both cases we wrap it so
// partial matches work (matches anywhere) and it's case-insensitive. `*` maps to
// `.*` (matches any sequence), so `*@domain.com` matches any sender at that domain.
function toMatcher(pattern: string | null): ((input: string) => boolean) | null {
  if (!pattern) return null;
  const p = pattern.trim();
  if (!p) return null;
  // Escape regex metacharacters EXCEPT our wildcard `*`, then turn `*` into `.*`
  // and keep any intentional `( ... )` grouping untouched for advanced use.
  const escaped = p
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape all metachars except `*`
    .replace(/\*/g, '.*'); // wildcard -> any sequence
  let re: RegExp;
  try {
    re = new RegExp(escaped, 'i');
  } catch {
    // Fallback: if the pattern can't compile, treat it as a plain substring.
    re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  return (input: string) => re.test(input);
}

@Injectable()
export class MailboxRulesService {
  constructor(
    @InjectRepository(MailboxRule) private readonly rules: Repository<MailboxRule>,
    @InjectRepository(Mailbox) private readonly mailboxes: Repository<Mailbox>,
    @InjectRepository(Asset) private readonly assets: Repository<Asset>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(TicketGroup) private readonly groups: Repository<TicketGroup>,
    @InjectRepository(InboundMailLog)
    private readonly inboundLog: Repository<InboundMailLog>,
    private readonly audit: AuditService,
  ) {}

  // --- CRUD (admin) ---------------------------------------------------------
  async listForMailbox(mailboxEmail: string): Promise<MailboxRule[]> {
    return this.rules.find({
      where: { mailboxEmail },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
  }

  async create(dto: CreateMailboxRuleDto, actor: AuthenticatedUser) {
    const rule = this.rules.create({
      mailboxEmail: dto.mailboxEmail.toLowerCase().trim(),
      senderPattern: dto.senderPattern ?? null,
      subjectPattern: dto.subjectPattern ?? null,
      destination: dto.destination,
      targetGroupId: dto.targetGroupId ?? null,
      targetCustomerStrategy: dto.targetCustomerStrategy ?? null,
      fixedCustomerId: dto.fixedCustomerId ?? null,
      priority: dto.priority ?? 100,
      active: dto.active ?? true,
    });
    const saved = await this.rules.save(rule);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.MAILBOX_RULE,
      entityId: saved.id,
      newValue: { mailboxEmail: saved.mailboxEmail, destination: saved.destination },
    });
    return saved;
  }

  async update(id: string, dto: UpdateMailboxRuleDto, actor: AuthenticatedUser) {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Regla no encontrada');
    if (dto.senderPattern !== undefined) rule.senderPattern = dto.senderPattern;
    if (dto.subjectPattern !== undefined) rule.subjectPattern = dto.subjectPattern;
    if (dto.destination !== undefined) rule.destination = dto.destination;
    if (dto.targetGroupId !== undefined) rule.targetGroupId = dto.targetGroupId ?? null;
    if (dto.targetCustomerStrategy !== undefined) rule.targetCustomerStrategy = dto.targetCustomerStrategy;
    if (dto.fixedCustomerId !== undefined) rule.fixedCustomerId = dto.fixedCustomerId;
    if (dto.priority !== undefined) rule.priority = dto.priority;
    if (dto.active !== undefined) rule.active = dto.active;
    const saved = await this.rules.save(rule);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.MAILBOX_RULE,
      entityId: id,
      newValue: { destination: saved.destination, active: saved.active },
    });
    return saved;
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Regla no encontrada');
    await this.rules.remove(rule);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.MAILBOX_RULE,
      entityId: id,
    });
    return { ok: true };
  }

  // --- Evaluation (used by the worker) --------------------------------------
  async evaluate(
    mailbox: Pick<Mailbox, 'email' | 'defaultDestination'>,
    mail: InboundMailMeta,
  ): Promise<RoutingDecision> {
    const activeRules = await this.rules.find({
      where: { mailboxEmail: mailbox.email, active: true },
      order: { priority: 'ASC', createdAt: 'ASC' },
    });
    for (const rule of activeRules) {
      const senderOk = (toMatcher(rule.senderPattern) ?? (() => true))(mail.fromEmail);
      const subjectOk = (toMatcher(rule.subjectPattern) ?? (() => true))(mail.subject);
      if (senderOk && subjectOk) {
        let customerId: string | null = null;
        let assetId: string | null = null;
        if (rule.targetCustomerStrategy === 'fixed_customer_id' && rule.fixedCustomerId) {
          customerId = rule.fixedCustomerId;
        }
        // Resolver el box destino (si la regla enruta a un box del catálogo).
        let targetGroupName: string | null = null;
        if (rule.targetGroupId) {
          const group = await this.groups.findOne({ where: { id: rule.targetGroupId } });
          if (group && group.active) targetGroupName = group.name;
        }
        return {
          rule,
          destination: rule.destination as RoutingDecision['destination'],
          matchedRuleId: rule.id,
          customerId,
          assetId,
          targetGroupName,
        };
      }
    }
    // No rule matched -> use the mailbox's catch-all default ('' = legacy 'ticket').
    const fallback = (mailbox.defaultDestination || 'ticket') as RoutingDecision['destination'];
    return { rule: null, destination: fallback };
  }

  // "Correos recientes sin regla": recent inbound emails with NO matching rule,
  // so the admin can review them and quickly create a rule (e.g. "por remitente").
  async listUnrouted(mailboxEmail: string, limit = 50): Promise<InboundMailLog[]> {
    const qb = this.inboundLog
      .createQueryBuilder('log')
      .where('log.routed = :r', { r: false })
      .orderBy('log.receivedAt', 'DESC')
      .take(limit);
    if (mailboxEmail) qb.andWhere('log.mailboxEmail = :m', { m: mailboxEmail });
    return qb.getMany();
  }

  // Preview / test: against the last 30 days of inbound email for a mailbox,
  // how many would a pending rule (sender/subject/destination) match, and how
  // many would have landed in each destination. Lets an admin sanity-check a
  // rule before committing (avoids a broad rule sending too much to discard).
  async preview(mailboxEmail: string, rule: { senderPattern?: string; subjectPattern?: string; destination?: string }) {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const qb = this.inboundLog
      .createQueryBuilder('log')
      .where('log.mailboxEmail = :m', { m: mailboxEmail })
      .andWhere('log.receivedAt >= :since', { since })
      .orderBy('log.receivedAt', 'DESC');
    const emails = await qb.getMany();

    const senderMatcher = toMatcher(rule.senderPattern ?? null);
    const subjectMatcher = toMatcher(rule.subjectPattern ?? null);

    // Which matched AND, of those, how they'd be routed (rule dest vs catch-all).
    const matched = emails.filter((e) => {
      const senderOk = senderMatcher ? senderMatcher(e.fromEmail ?? '') : true;
      const subjectOk = subjectMatcher ? subjectMatcher(e.subject ?? '') : true;
      return senderOk && subjectOk;
    });

    // How many of the matched would touch each destination. Uses the rule's
    // destination; emails with no sender/subject in log are skipped.
    const destCounts: Record<string, number> = { ticket: 0, document: 0, discard: 0 };
    // Also count current catch-all / no-destination distribution for context.
    const noDest = emails.filter((e) => !e.destination).map((e) => ({
      from_email: e.fromEmail,
      subject: e.subject,
      receivedAt: e.receivedAt,
    }));

    return {
      mailboxEmail,
      rule,
      windowDays: 30,
      totalInWindow: emails.length,
      matched: matched.length,
      destination: rule.destination ?? 'ticket',
      matchedSamples: matched.slice(0, 10).map((e) => ({
        from_email: e.fromEmail,
        subject: e.subject,
        receivedAt: e.receivedAt,
      })),
      context: {
        withDestination: emails.filter((e) => e.destination).length,
        withoutDestination: noDest.length,
        noDestSamples: noDest.slice(0, 5),
      },
    };
  }

  // --- Destination: document (with asset auto-match) ------------------------
  async routeToDocument(mail: InboundMailMeta, customerId?: string | null) {
    // 1) Resolve customer. A fixed customer already came from the rule; else
    //    try to match an Asset whose name appears in the subject (case-insensitive)
    //    and carry that asset's customer.
    let resolvedCustomerId = customerId ?? null;
    let assetId: string | null = null;

    if (!resolvedCustomerId) {
      const candidates = await this.assets.find();
      const subjectLower = mail.subject.toLowerCase();
      for (const asset of candidates) {
        if (asset.name && asset.customerId && subjectLower.includes(asset.name.toLowerCase())) {
          assetId = asset.id;
          resolvedCustomerId = asset.customerId;
          break;
        }
      }
    } else if (!assetId) {
      // A customer was fixed but we could still try to tag the asset by name.
      const subjectLower = mail.subject.toLowerCase();
      const asset = await this.assets
        .createQueryBuilder('a')
        .where('a.customer_id = :cid', { cid: resolvedCustomerId })
        .getMany();
      for (const a of asset) {
        if (a.name && subjectLower.includes(a.name.toLowerCase())) {
          assetId = a.id;
          break;
        }
      }
    }

    // Unresolved (no customer/asset) -> lands in the "sin clasificar" tray.
    const doc = this.documents.create({
      customerId: resolvedCustomerId,
      assetId,
      title: mail.subject,
      storagePath: null,
      source: 'email',
      mimeType: null,
      status: 'sin_clasificar',
      body: mail.body ?? null,
      rawFilename: null,
    });
    const saved = await this.documents.save(doc);
    await this.audit.log({
      user: null,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.DOCUMENT,
      entityId: saved.id,
      newValue: {
        title: saved.title,
        customerId: resolvedCustomerId,
        assetId,
        source: 'email',
        status: saved.status,
      },
    });
    return saved;
  }
}
