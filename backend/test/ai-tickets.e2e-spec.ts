import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { DataSource, DeepPartial } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  RoleName,
  TicketAuthorType,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from '../src/common/enums';
import { AiUsageLog } from '../src/entities/ai-usage-log.entity';
import { AuditLog } from '../src/entities/audit-log.entity';
import { Contact } from '../src/entities/contact.entity';
import { Customer } from '../src/entities/customer.entity';
import { Role } from '../src/entities/role.entity';
import { Ticket } from '../src/entities/ticket.entity';
import { TicketMessage } from '../src/entities/ticket-message.entity';
import { User } from '../src/entities/user.entity';
import { assertIsolatedTestDb } from './test-db.guard';

jest.setTimeout(60000);

// IA 03: el panel del ticket usa el MISMO AiService que el Laboratorio. Acá se
// comprueba el cableado HTTP (flags, permisos, features de métricas, avisos
// automáticos y auditoría al aplicar) con el proveedor mock: sin Ollama ni red.
describe('Asistente IA en tickets e2e (proveedor mock)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let customer: Customer;
  let contact: Contact;
  let ticket: Ticket;
  let ticketRelated: Ticket;
  let ticketSinEquipo: Ticket;
  let ticketAutomatico: Ticket;
  let consulta: User;
  let tokenSupervisor: string;
  let tokenConsulta: string;

  const envOriginal: Record<string, string | undefined> = {};
  const clavesAi = [
    'AI_ENABLED',
    'AI_LAB_ENABLED',
    'AI_TICKETS_ENABLED',
    'AI_CHAT_PROVIDER',
    'AI_EMBED_PROVIDER',
  ];
  const sufijo = Date.now().toString();
  const api = () => request(app.getHttpServer());

  async function nextTicketNumber(): Promise<number> {
    const [row] = await dataSource.query(`SELECT nextval('ticket_number_seq') AS n`);
    return Number(row.n);
  }

  beforeAll(async () => {
    assertIsolatedTestDb();
    for (const clave of clavesAi) envOriginal[clave] = process.env[clave];
    Object.assign(process.env, {
      AI_ENABLED: 'true',
      AI_LAB_ENABLED: 'true',
      AI_TICKETS_ENABLED: 'true',
      AI_CHAT_PROVIDER: 'mock',
      AI_EMBED_PROVIDER: 'mock',
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dataSource = app.get(DataSource);
    const customers = dataSource.getRepository(Customer);
    const contacts = dataSource.getRepository(Contact);
    const tickets = dataSource.getRepository(Ticket);
    const messages = dataSource.getRepository(TicketMessage);
    const users = dataSource.getRepository(User);
    const roles = dataSource.getRepository(Role);

    customer = await customers.save(
      customers.create({ name: `__e2e IA tickets ${sufijo}`, active: true, sharedPortal: false }),
    );
    contact = await contacts.save(
      contacts.create({
        customerId: customer.id,
        name: 'Cliente IA e2e',
        email: `ia-tickets-${sufijo}@example.test`,
      }),
    );
    const datosTicket: DeepPartial<Ticket> = {
      customerId: customer.id,
      contactId: contact.id,
      source: 'manual',
      shadow: false,
      category: 'Red / Conectividad',
      priority: TicketPriority.NORMAL,
    };
    ticket = await tickets.save(
      tickets.create({
        ...datosTicket,
        ticketNumber: await nextTicketNumber(),
        title: 'Sin internet en la oficina',
      }),
    );
    ticketRelated = await tickets.save(
      tickets.create({
        ...datosTicket,
        status: TicketStatus.CERRADO,
        ticketNumber: await nextTicketNumber(),
        title: 'Sin internet en la oficina',
      }),
    );
    ticketSinEquipo = await tickets.save(
      tickets.create({
        ...datosTicket,
        status: TicketStatus.CERRADO,
        ticketNumber: await nextTicketNumber(),
        title: 'Sin internet en la oficina',
      }),
    );
    ticketAutomatico = await tickets.save(
      tickets.create({
        customerId: customer.id,
        ticketNumber: await nextTicketNumber(),
        title: 'MikroTik Respaldo automático',
        subjectKey: 'mikrotik respaldo automatico',
        source: 'email',
        shadow: false,
      }),
    );
    await messages.save(
      messages.create({
        ticketId: ticket.id,
        authorType: TicketAuthorType.CLIENTE,
        channel: TicketChannel.PORTAL,
        body: 'No tengo internet desde esta mañana, probé reiniciar el router.',
      }),
    );
    await messages.save(
      messages.create({
        ticketId: ticketRelated.id,
        authorType: TicketAuthorType.CLIENTE,
        channel: TicketChannel.PORTAL,
        body: 'No tengo internet desde esta mañana, probé reiniciar el router.',
      }),
    );
    await messages.save(
      messages.create({
        ticketId: ticketRelated.id,
        authorType: TicketAuthorType.TECNICO,
        channel: TicketChannel.PORTAL,
        body: 'Reiniciamos el router y volvió la conexión. La clave es: supersecreto123.',
      }),
    );
    await messages.save(
      messages.create({
        ticketId: ticketSinEquipo.id,
        authorType: TicketAuthorType.CLIENTE,
        channel: TicketChannel.PORTAL,
        body: 'No tengo internet desde esta mañana, probé reiniciar el router.',
      }),
    );

    const rolConsulta = await roles.findOne({ where: { name: RoleName.CONSULTA } });
    expect(rolConsulta).toBeTruthy();
    consulta = await users.save(
      users.create({
        name: 'Consulta IA e2e',
        email: `ia-consulta-${sufijo}@example.test`,
        passwordHash: await bcrypt.hash('demo1234', 10),
        roleId: rolConsulta!.id,
        active: true,
      }),
    );

    const loginSupervisor = await api()
      .post('/api/auth/login')
      .send({ email: 'ana@msp.local', password: 'demo1234' })
      .expect(201);
    tokenSupervisor = loginSupervisor.body.accessToken;
    const loginConsulta = await api()
      .post('/api/auth/login')
      .send({ email: consulta.email, password: 'demo1234' })
      .expect(201);
    tokenConsulta = loginConsulta.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      const ds = app.get(DataSource);
      await ds.getRepository(AiUsageLog).delete({ userId: consulta?.id });
      await ds.getRepository(AuditLog).delete({ entityType: 'ticket', entityId: ticket?.id });
      await ds.query('DELETE FROM ticket_messages WHERE ticket_id = ANY($1)', [
        [ticket?.id, ticketRelated?.id, ticketSinEquipo?.id].filter(Boolean),
      ]);
      await ds.getRepository(TicketMessage).delete({ ticketId: ticketAutomatico?.id });
      const ids = [ticket?.id, ticketRelated?.id, ticketSinEquipo?.id, ticketAutomatico?.id].filter(
        Boolean,
      );
      await ds.query('DELETE FROM sla WHERE ticket_id = ANY($1)', [ids]);
      await ds.query('DELETE FROM audit_logs WHERE entity_type = $1 AND entity_id = ANY($2)', [
        'ticket',
        ids,
      ]);
      await ds.getRepository(Ticket).delete(ids);
      await ds.getRepository(Contact).delete(contact?.id);
      await ds.getRepository(Customer).delete(customer?.id);
      await ds.query('DELETE FROM audit_logs WHERE user_id = $1', [consulta?.id]);
      await ds.getRepository(User).delete(consulta?.id);
      await app.close();
    }
    for (const clave of clavesAi) {
      if (envOriginal[clave] === undefined) delete process.env[clave];
      else process.env[clave] = envOriginal[clave];
    }
  });

  const authSupervisor = () => ({ Authorization: `Bearer ${tokenSupervisor}` });
  const authConsulta = () => ({ Authorization: `Bearer ${tokenConsulta}` });
  const url = (accion: string) => `/api/ai/tickets/${ticket.id}/${accion}`;

  it('expone los flags del panel en /ai/features', async () => {
    const res = await api().get('/api/ai/features').set(authSupervisor()).expect(200);
    expect(res.body.aiEnabled).toBe(true);
    expect(res.body.aiTicketsEnabled).toBe(true);
  });

  it('Consulta no puede usar los endpoints nuevos (403)', async () => {
    await api().post(url('summary')).set(authConsulta()).send({}).expect(403);
    await api().post(url('classify')).set(authConsulta()).send({}).expect(403);
    await api().post(url('reply-draft')).set(authConsulta()).send({}).expect(403);
    await api().get(url('related')).set(authConsulta()).expect(403);
    await api().post(url('solution')).set(authConsulta()).send({}).expect(403);
  });

  it('resume, clasifica y propone respuesta reutilizando AiService', async () => {
    const resumen = await api().post(url('summary')).set(authSupervisor()).send({}).expect(201);
    expect(Object.keys(resumen.body.summary)).toEqual(
      expect.arrayContaining(['pedido', 'probado', 'falta', 'cliente']),
    );
    expect(resumen.body.summary.cliente).toBe('Cliente IA e2e');

    const clasificacion = await api()
      .post(url('classify'))
      .set(authSupervisor())
      .send({})
      .expect(201);
    expect(clasificacion.body.ai).toHaveProperty('categoria');
    expect(clasificacion.body.ai).toHaveProperty('prioridad');

    const borrador = await api()
      .post(url('reply-draft'))
      .set(authSupervisor())
      .send({ tono: 'corto' })
      .expect(201);
    expect(borrador.body.draft).toContain('Equipo Solido');
    expect(borrador.body.draft).toContain('Cliente IA e2e');
  });

  it('relacionados incluye tickets de personas y excluye avisos automáticos', async () => {
    const res = await api().get(url('related')).set(authSupervisor()).expect(200);
    expect(res.body.automaticNotice).toBe(false);
    expect(res.body.related.map((r: { id: string }) => r.id)).toContain(ticketRelated.id);
    expect(res.body.related.map((r: { id: string }) => r.id)).not.toContain(ticketAutomatico.id);
  });

  it('no propone respuesta para un aviso automático (409)', async () => {
    const res = await api()
      .post(`/api/ai/tickets/${ticketAutomatico.id}/reply-draft`)
      .set(authSupervisor())
      .send({})
      .expect(409);
    expect(res.body.message).toContain('aviso automático');
  });

  it('solution propone pasos citando la fuente cerrada y enmascara credenciales', async () => {
    const res = await api().post(url('solution')).set(authSupervisor()).send({}).expect(201);
    expect(res.body.sinAntecedentes).toBe(false);
    expect(res.body.pasos.length).toBeGreaterThan(0);
    expect(res.body.pasos[0].texto).toMatch(/\(Fuente: TK-\d{4}-\d+\)/);
    expect(res.body.pasos[0].fuente.id).toBe(ticketRelated.id);
    expect(JSON.stringify(res.body)).not.toContain('supersecreto123');
    expect(res.body.fuentes.map((f: { id: string }) => f.id)).toContain(ticketRelated.id);
    expect(res.body.fuentes.map((f: { id: string }) => f.id)).not.toContain(ticketSinEquipo.id);
  });

  it('registra los features ticket_* sin guardar textos', async () => {
    const registros = await dataSource
      .getRepository(AiUsageLog)
      .createQueryBuilder('log')
      .where('log.feature LIKE :prefijo', { prefijo: 'ticket_%' })
      .andWhere('log.created_at >= :desde', { desde: new Date(Date.now() - 120000) })
      .getMany();
    const features = new Set(registros.map((r) => r.feature));
    for (const feature of [
      'ticket_summary',
      'ticket_classify',
      'ticket_reply',
      'ticket_related',
      'ticket_precedents',
      'ticket_solution',
    ]) {
      expect(features.has(feature)).toBe(true);
    }
    expect(JSON.stringify(registros)).not.toContain('No tengo internet desde esta mañana');
    expect(JSON.stringify(registros)).not.toContain('supersecreto123');
  });

  it('aplicar sugerencia usa el PATCH normal y audita origen IA', async () => {
    await api()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authSupervisor())
      .send({ category: 'Taller', origin: 'ia' })
      .expect(200);
    await api()
      .patch(`/api/tickets/${ticket.id}`)
      .set(authSupervisor())
      .send({ priority: 'alta', origin: 'ia' })
      .expect(200);

    const auditorias = await dataSource.getRepository(AuditLog).find({
      where: { entityType: 'ticket', entityId: ticket.id },
      order: { createdAt: 'DESC' },
    });
    expect(auditorias.length).toBeGreaterThanOrEqual(2);
    expect(auditorias[0].meta).toMatchObject({
      origen: 'IA',
      detalle: 'sugerido por IA y aceptado por Ana Supervisor',
    });
  });

  it('el asistente no crea mensajes: el envío sigue siendo manual', async () => {
    const mensajes = await dataSource.getRepository(TicketMessage).count({ where: { ticketId: ticket.id } });
    expect(mensajes).toBe(1);
  });
});
