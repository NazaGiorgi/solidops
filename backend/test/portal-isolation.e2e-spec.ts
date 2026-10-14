import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Contact } from '../src/entities/contact.entity';
import { Customer } from '../src/entities/customer.entity';
import { Ticket } from '../src/entities/ticket.entity';
import { TicketAttachment } from '../src/entities/ticket-attachment.entity';
import { TicketMessage } from '../src/entities/ticket-message.entity';
import { WorkshopEquipment } from '../src/entities/workshop-equipment.entity';
import { WorkshopQuote } from '../src/entities/workshop-quote.entity';
import {
  EquipmentType,
  TicketAuthorType,
  TicketChannel,
  WorkshopQuoteStatus,
} from '../src/common/enums';
import { assertIsolatedTestDb } from './test-db.guard';

jest.setTimeout(30000);

describe('Portal isolation e2e', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let jwt: JwtService;
  let config: ConfigService;
  let customers: Repository<Customer>;
  let contacts: Repository<Contact>;
  let tickets: Repository<Ticket>;
  let messages: Repository<TicketMessage>;
  let attachments: Repository<TicketAttachment>;
  let equipment: Repository<WorkshopEquipment>;
  let quotes: Repository<WorkshopQuote>;
  let customer: Customer;
  let contactA: Contact;
  let contactB: Contact;
  let ticketA: Ticket;
  let ticketB: Ticket;
  let messageB: TicketMessage;
  let attachmentB: TicketAttachment;
  let quoteB: WorkshopQuote;
  let tokenA: string;
  let createdTicketId: string;

  const auth = () => ({ Authorization: `Bearer ${tokenA}` });

  async function nextTicketNumber(): Promise<number> {
    const [row] = await dataSource.query(`SELECT nextval('ticket_number_seq') AS n`);
    return Number(row.n);
  }

  async function portalToken(contact: Contact): Promise<string> {
    return jwt.signAsync(
      {
        sub: contact.id,
        type: 'portal',
        customerId: contact.customerId,
        email: contact.email || '',
        name: contact.name,
      },
      { secret: config.getOrThrow<string>('jwt.secret'), expiresIn: '15m' },
    );
  }

  beforeAll(async () => {
    assertIsolatedTestDb();
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dataSource = app.get(DataSource);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    customers = dataSource.getRepository(Customer);
    contacts = dataSource.getRepository(Contact);
    tickets = dataSource.getRepository(Ticket);
    messages = dataSource.getRepository(TicketMessage);
    attachments = dataSource.getRepository(TicketAttachment);
    equipment = dataSource.getRepository(WorkshopEquipment);
    quotes = dataSource.getRepository(WorkshopQuote);

    const suffix = Date.now().toString();
    customer = await customers.save(customers.create({
      name: `__e2e portal isolation ${suffix}`,
      active: true,
      sharedPortal: false,
    }));
    contactA = await contacts.save(contacts.create({
      customerId: customer.id,
      name: 'Portal isolation A',
      email: `portal-isolation-a-${suffix}@example.test`,
      portalEnabled: true,
      emailVerifiedAt: new Date(),
    }));
    contactB = await contacts.save(contacts.create({
      customerId: customer.id,
      name: 'Portal isolation B',
      email: `portal-isolation-b-${suffix}@example.test`,
      portalEnabled: true,
      emailVerifiedAt: new Date(),
    }));
    ticketA = await tickets.save(tickets.create({
      customerId: customer.id,
      contactId: contactA.id,
      ticketNumber: await nextTicketNumber(),
      title: 'Ticket A private',
      source: 'manual',
      shadow: false,
    }));
    ticketB = await tickets.save(tickets.create({
      customerId: customer.id,
      contactId: contactB.id,
      ticketNumber: await nextTicketNumber(),
      title: 'Ticket B private',
      source: 'manual',
      shadow: false,
    }));
    messageB = await messages.save(messages.create({
      ticketId: ticketB.id,
      authorType: TicketAuthorType.CLIENTE,
      channel: TicketChannel.PORTAL,
      body: 'Mensaje privado B',
    }));
    attachmentB = await attachments.save(attachments.create({
      ticketMessageId: messageB.id,
      fileUrl: 'tickets/e2e-private.txt',
      filename: 'e2e-private.txt',
      mimeType: 'text/plain',
      sizeBytes: 1,
    }));
    const equipmentB = await equipment.save(equipment.create({
      customerId: customer.id,
      contactId: contactB.id,
      customerLabel: customer.name,
      equipmentType: EquipmentType.PC,
      reportedFault: 'Falla e2e',
      receivedAt: new Date(),
      statusHistory: [],
    }));
    quoteB = await quotes.save(quotes.create({
      equipmentId: equipmentB.id,
      number: `E2E-${suffix}`,
      status: WorkshopQuoteStatus.PENDIENTE,
      notes: null,
      subtotal: '0',
      total: '0',
      sentAt: new Date(),
    }));
    tokenA = await portalToken(contactA);
  });

  afterAll(async () => {
    if (quoteB) await quotes.delete(quoteB.id);
    if (customer) {
      await equipment.delete({ customerId: customer.id });
      await attachments.delete({ ticketMessageId: messageB?.id });
      await messages
        .createQueryBuilder()
        .delete()
        .where('ticket_id IN (SELECT id FROM tickets WHERE customer_id = :customerId)', { customerId: customer.id })
        .execute();
      await tickets.delete({ customerId: customer.id });
      await contacts.delete({ customerId: customer.id });
      await customers.delete(customer.id);
    }
    if (app) await app.close();
    if (moduleFixture) await moduleFixture.close();
  });

  it('keeps a bucket contact limited to its own tickets and reports', async () => {
    const list = await request(app.getHttpServer()).get('/api/portal/tickets').set(auth()).expect(200);
    expect(list.body.map((ticket: Ticket) => ticket.id)).toEqual([ticketA.id]);

    const reports = await request(app.getHttpServer()).get('/api/portal/reports').set(auth()).expect(200);
    expect(reports.body.total).toBe(1);
  });

  it('returns 404 for another contact ticket, message, attachment, and quote', async () => {
    await request(app.getHttpServer()).get(`/api/portal/tickets/${ticketB.id}`).set(auth()).expect(404);
    await request(app.getHttpServer()).post(`/api/portal/tickets/${ticketB.id}/messages`).set(auth()).send({ body: 'No permitido' }).expect(404);
    await request(app.getHttpServer()).post(`/api/portal/tickets/messages/${messageB.id}/attachments`).set(auth()).attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' }).expect(404);
    await request(app.getHttpServer()).get(`/api/portal/tickets/attachments/${attachmentB.id}/download`).set(auth()).expect(404);
    await request(app.getHttpServer()).get('/api/portal/quotes').set(auth()).expect(200).expect([]);
    await request(app.getHttpServer()).post(`/api/portal/quotes/${quoteB.id}/respond`).set(auth()).send({ decision: 'aprobado' }).expect(404);
  });

  it('keeps the normal portal flow working for the ticket owner', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/portal/tickets')
      .set(auth())
      .send({ title: 'Ticket creado por A', description: 'Detalle propio' })
      .expect(201);
    createdTicketId = created.body.id;
    expect(created.body.contactId).toBe(contactA.id);

    await request(app.getHttpServer()).get(`/api/portal/tickets/${createdTicketId}`).set(auth()).expect(200);
    await request(app.getHttpServer()).post(`/api/portal/tickets/${createdTicketId}/messages`).set(auth()).send({ body: 'Respuesta propia' }).expect(201);
  });

  it('allows the customer to share explicitly', async () => {
    customer.sharedPortal = true;
    await customers.save(customer);

    const list = await request(app.getHttpServer()).get('/api/portal/tickets').set(auth()).expect(200);
    expect(list.body.map((ticket: Ticket) => ticket.id)).toEqual(expect.arrayContaining([ticketA.id, ticketB.id, createdTicketId]));
    await request(app.getHttpServer()).get(`/api/portal/tickets/${ticketB.id}`).set(auth()).expect(200);
    const quotesRes = await request(app.getHttpServer()).get('/api/portal/quotes').set(auth()).expect(200);
    expect(quotesRes.body.map((quote: WorkshopQuote) => quote.id)).toContain(quoteB.id);
  });

  it('rejects an otherwise valid token immediately after portal is disabled', async () => {
    contactA.portalEnabled = false;
    await contacts.save(contactA);
    await request(app.getHttpServer()).get('/api/portal/tickets').set(auth()).expect(401);
  });
});
