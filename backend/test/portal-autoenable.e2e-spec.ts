import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Contact } from '../src/entities/contact.entity';
import { Customer } from '../src/entities/customer.entity';
import { Ticket } from '../src/entities/ticket.entity';
import { AuditLog } from '../src/entities/audit-log.entity';
import { EmailService } from '../src/modules/email/email.service';
import { assertIsolatedTestDb } from './test-db.guard';

jest.setTimeout(30000);

// Tanda 1.5: la ingesta de email solo puede habilitar el portal cuando el
// contacto se crea por primera vez. Nunca re-habilita un contacto existente con
// el portal apagado. Todo cambio de portal_enabled por ingesta queda auditado.
describe('Portal auto-enable on email ingestion e2e', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let emailService: EmailService;
  let customers: Repository<Customer>;
  let contacts: Repository<Contact>;
  let tickets: Repository<Ticket>;
  let auditLogs: Repository<AuditLog>;

  const suffix = Date.now().toString();
  const createdCustomerIds: string[] = [];
  const createdContactIds: string[] = [];

  async function cleanupCustomer(customerId: string) {
    const ticketSub = `SELECT id FROM tickets WHERE customer_id = $1`;
    await dataSource.query(`DELETE FROM sla WHERE ticket_id IN (${ticketSub})`, [customerId]);
    await dataSource.query(`DELETE FROM notes WHERE ticket_id IN (${ticketSub})`, [customerId]);
    await dataSource.query(`DELETE FROM appointments WHERE ticket_id IN (${ticketSub})`, [customerId]);
    await dataSource.query(
      `DELETE FROM ticket_attachments WHERE ticket_message_id IN (
         SELECT tm.id FROM ticket_messages tm
         JOIN tickets t ON t.id = tm.ticket_id
         WHERE t.customer_id = $1)`,
      [customerId],
    );
    await dataSource.query(
      `DELETE FROM ticket_messages WHERE ticket_id IN (${ticketSub})`,
      [customerId],
    );
    await tickets.delete({ customerId });
    await contacts.delete({ customerId });
    await customers.delete(customerId);
  }

  beforeAll(async () => {
    assertIsolatedTestDb();
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    emailService = app.get(EmailService);
    customers = dataSource.getRepository(Customer);
    contacts = dataSource.getRepository(Contact);
    tickets = dataSource.getRepository(Ticket);
    auditLogs = dataSource.getRepository(AuditLog);
  });

  afterAll(async () => {
    for (const contactId of createdContactIds) {
      await auditLogs.delete({ entityType: 'contact', entityId: contactId });
    }
    for (const customerId of createdCustomerIds) {
      await cleanupCustomer(customerId);
    }
    if (app) await app.close();
    if (moduleFixture) await moduleFixture.close();
  });

  it('keeps an existing contact with portal disabled OFF after receiving email', async () => {
    const customer = await customers.save(
      customers.create({ name: `__e2e autoenable existing ${suffix}`, active: true }),
    );
    createdCustomerIds.push(customer.id);

    const contact = await contacts.save(
      contacts.create({
        customerId: customer.id,
        name: 'Existing portal-off contact',
        email: `existing-off-${suffix}@example.test`,
        portalEnabled: false,
        emailVerifiedAt: null,
      }),
    );
    createdContactIds.push(contact.id);

    const res = await emailService.ingest({
      fromEmail: contact.email!,
      subject: `Consulta existente ${suffix}`,
      body: 'Cuerpo del correo existente',
    });
    expect(res.ok).toBe(true);

    const reloaded = await contacts.findOneOrFail({ where: { id: contact.id } });
    expect(reloaded.portalEnabled).toBe(false);

    const audits = await auditLogs.find({ where: { entityType: 'contact', entityId: contact.id } });
    const enableAudits = audits.filter(
      (a) => (a.meta as Record<string, unknown> | null)?.via === 'email_ingestion',
    );
    expect(enableAudits).toHaveLength(0);
  });

  it('enables portal for a newly created contact and records an audit entry', async () => {
    const domain = `tanda15-${suffix}.test`;
    const fromEmail = `nuevo-${suffix}@${domain}`;

    const res = await emailService.ingest({
      fromEmail,
      subject: `Consulta nueva ${suffix}`,
      body: 'Cuerpo del correo nuevo',
    });
    expect(res.ok).toBe(true);

    const contact = await contacts.findOne({ where: { email: fromEmail.toLowerCase() } });
    expect(contact).toBeTruthy();
    createdContactIds.push(contact!.id);
    createdCustomerIds.push(contact!.customerId!);

    const reloaded = await contacts.findOneOrFail({ where: { id: contact!.id } });
    expect(reloaded.portalEnabled).toBe(true);

    const audits = await auditLogs.find({ where: { entityType: 'contact', entityId: contact!.id } });
    const enableAudits = audits.filter(
      (a) => (a.meta as Record<string, unknown> | null)?.via === 'email_ingestion',
    );
    expect(enableAudits).toHaveLength(1);
    expect(enableAudits[0].action).toBe('update');
    expect((enableAudits[0].newValue as Record<string, unknown>).portalEnabled).toBe(true);
  });
});
