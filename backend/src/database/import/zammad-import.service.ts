import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../entities/customer.entity';
import { Contact } from '../../entities/contact.entity';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { TicketStatus, TicketPriority, TicketAuthorType, TicketChannel } from '../../common/enums';

export interface ZammadArticle {
  author_type: 'customer' | 'agent' | 'system' | string;
  body: string;
  created_at: string;
}
export interface ZammadTicket {
  id: number | string;
  group: string;
  title: string;
  status: string;
  priority: string;
  customer_email: string;
  customer_name: string;
  created_at: string;
  articles: ZammadArticle[];
}
export interface ImportCounters {
  customersCreated: number;
  contactsCreated: number;
}
export interface ImportResult {
  customersCreated: number;
  contactsCreated: number;
  ticketsCreated: number;
  ticketsSkipped: number;
  messagesImported: number;
}

function mapStatus(z: string): TicketStatus {
  const s = z.toLowerCase();
  if (s.includes('closed')) return TicketStatus.CERRADO;
  if (s.includes('resolved')) return TicketStatus.RESUELTO;
  if (s.includes('pending')) return TicketStatus.ESPERANDO_CLIENTE;
  if (s.includes('open')) return TicketStatus.ABIERTO;
  return TicketStatus.NUEVO;
}
function mapPriority(p: string): TicketPriority {
  const s = p.toLowerCase();
  if (s.includes('4') || s.includes('urgent')) return TicketPriority.CRITICA;
  if (s.includes('3') || s.includes('high')) return TicketPriority.ALTA;
  if (s.includes('1') || s.includes('low')) return TicketPriority.BAJA;
  return TicketPriority.NORMAL;
}
function mapAuthor(a: string): TicketAuthorType {
  if (a === 'customer') return TicketAuthorType.CLIENTE;
  if (a === 'system') return TicketAuthorType.SISTEMA;
  return TicketAuthorType.TECNICO;
}

@Injectable()
export class ZammadImportService {
  private readonly logger = new Logger(ZammadImportService.name);

  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Ticket) private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketMessage) private readonly messages: Repository<TicketMessage>,
  ) {}

  async import(tickets: ZammadTicket[]): Promise<ImportResult> {
    const result: ImportResult = {
      customersCreated: 0,
      contactsCreated: 0,
      ticketsCreated: 0,
      ticketsSkipped: 0,
      messagesImported: 0,
    };

    for (const t of tickets) {
      // 1) Resolve or create the Customer + Contact (by email; avoid duplicates).
      const { customer, contact, counters } = await this.resolveCustomerContact(t);
      result.customersCreated += counters.customersCreated;
      result.contactsCreated += counters.contactsCreated;

      // 2) Skip if the ticket was already imported (legacy_zammad_id present).
      const existing = await this.tickets.findOne({
        where: { legacyZammadId: String(t.id) },
        withDeleted: true,
      });
      if (existing) {
        result.ticketsSkipped++;
        continue;
      }

      // 3) Create the ticket with legacy id and original createdAt.
      const ticket = this.tickets.create({
        customerId: customer.id,
        contactId: contact?.id ?? null,
        title: t.title || '(sin título)',
        status: mapStatus(t.status),
        priority: mapPriority(t.priority),
        source: 'email',
        shadow: false,
        legacyZammadId: String(t.id),
        subjectKey: t.title ? t.title.toLowerCase().trim() : '',
        firstResponseAt: null,
        resolvedAt: null,
        createdAt: new Date(t.created_at),
        updatedAt: new Date(t.created_at),
      });
      const saved = await this.tickets.save(ticket);
      result.ticketsCreated++;

      // 4) Import each article as a TicketMessage, preserving the original date.
      for (const a of t.articles || []) {
        await this.messages.save(
          this.messages.create({
            ticketId: saved.id,
            authorType: mapAuthor(a.author_type),
            channel: TicketChannel.EMAIL,
            body: a.body || '',
            fromEmail: t.customer_email || null,
            createdAt: new Date(a.created_at),
            updatedAt: new Date(a.created_at),
          }),
        );
        result.messagesImported++;
      }
    }

    this.logger.log(
      `Import Zammad: ${result.ticketsCreated} creados, ${result.ticketsSkipped} omitidos, ` +
        `${result.customersCreated} clientes, ${result.contactsCreated} contactos, ${result.messagesImported} mensajes.`,
    );
    return result;
  }

  private async resolveCustomerContact(t: ZammadTicket): Promise<{
    customer: Customer;
    contact: Contact | null;
    counters: ImportCounters;
  }> {
    const email = (t.customer_email || '').toLowerCase().trim();
    let counters: ImportCounters = { customersCreated: 0, contactsCreated: 0 };

    // If an existing contact matches by email, reuse it (and its customer).
    if (email) {
      const contact = await this.contacts.findOne({ where: { email } });
      if (contact && contact.customerId) {
        const customer = await this.customers.findOne({ where: { id: contact.customerId } });
        if (customer) return { customer, contact, counters };
      }
    }

    // Reuse customer by exact name if present.
    const name = t.customer_name?.trim() || email.split('@')[0] || 'Cliente';
    let customer = await this.customers.findOne({ where: { name } });
    if (!customer) {
      customer = await this.customers.save(this.customers.create({ name, active: true }));
      counters.customersCreated = 1;
    }

    // Create (or reuse) the contact.
    let contact: Contact | null = null;
    if (email) {
      contact = await this.contacts.findOne({ where: { email } });
      if (!contact) {
        contact = await this.contacts.save(
          this.contacts.create({
            customerId: customer.id,
            name,
            email,
            preferredChannel: 'email' as never,
          }),
        );
        counters.contactsCreated = 1;
      }
    }

    return { customer, contact, counters };
  }
}
