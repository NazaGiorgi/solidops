import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { RoleName } from '../src/common/enums';
import { Appointment } from '../src/entities/appointment.entity';
import { Customer } from '../src/entities/customer.entity';
import { Ticket } from '../src/entities/ticket.entity';
import { User } from '../src/entities/user.entity';
import { assertIsolatedTestDb } from './test-db.guard';

jest.setTimeout(60000);

// Regresión de las tres correcciones pedidas sobre responsable + colaboradores:
//  1) los filtros por técnico NO recortan technicianLinks de citas;
//  2) colaboradores y responsable se escriben en transacción;
//  3) permisos, notificaciones, reportes y conteos quedan cubiertos.
describe('Ticket colaboradores - correcciones e2e', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let users: Repository<User>;
  let customers: Repository<Customer>;
  let appointments: Repository<Appointment>;
  let tickets: Repository<Ticket>;

  let adminToken: string;
  let mariaToken: string;
  let pedroToken: string;
  let nazarenoToken: string;
  let pedroTechId: string;
  let mariaTechId: string;
  let nazarenoTechId: string;
  let mariaUserId: string;
  let nazarenoUserId: string;
  let mariaName: string;
  let nazarenoName: string;
  let customer: Customer;

  const suffix = Date.now().toString();
  const customerIds: string[] = [];
  const ticketIds: string[] = [];
  const appointmentIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // Jest recorta los console.log largos; el JSONL conserva la evidencia completa.
  const evidenceFile = path.resolve(
    __dirname,
    '../../docs/evidencia/TICKET-COLABORADORES-correcciones-evidencia.jsonl',
  );
  const evidence = (label: string, data: unknown) => {
    const line = JSON.stringify({ at: new Date().toISOString(), label, data });
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.appendFileSync(evidenceFile, `${line}\n`, 'utf8');
    console.log(`[EVIDENCIA][colaboradores] ${label} ${line}`);
  };

  async function login(email: string, password = 'demo1234'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);
    return res.body.accessToken as string;
  }

  async function createTicket(technicianId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set(auth(adminToken))
      .send({
        customerId: customer.id,
        technicianId,
        title: `__e2e colaboradores ${suffix} ${ticketIds.length + 1}`,
        description: 'Verificación aislada de responsable + colaboradores',
      })
      .expect(201);
    ticketIds.push(res.body.id);
    return res.body.id as string;
  }

  async function setCollaborators(ticketId: string, ids: string[], token = adminToken) {
    const res = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticketId}`)
      .set(auth(token))
      .send({ collaboratorIds: ids })
      .expect(200);
    return (res.body.collaborators || []).map((c: { id: string }) => c.id) as string[];
  }

  async function ticketDetail(ticketId: string): Promise<any> {
    const res = await request(app.getHttpServer())
      .get(`/api/tickets/${ticketId}`)
      .set(auth(adminToken))
      .expect(200);
    return res.body;
  }

  async function notificationCount(userId: string, token: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(token))
      .expect(200);
    return (res.body as Array<{ userId: string }>).filter((n) => n.userId === userId).length;
  }

  async function notificationsFor(token: string): Promise<any[]> {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(token))
      .expect(200);
    return res.body;
  }

  async function collaboratorReport(): Promise<Record<string, number>> {
    const res = await request(app.getHttpServer())
      .get('/api/reports/summary')
      .set(auth(adminToken))
      .expect(200);
    return res.body.byTechnicianAsCollaborator || {};
  }

  async function countByResponsible(technicianId: string): Promise<number> {
    const res = await request(app.getHttpServer())
      .get(`/api/tickets?technicianId=${technicianId}&tray=all&take=1`)
      .set(auth(adminToken))
      .expect(200);
    return Number(res.body.total);
  }

  async function topResponsible(): Promise<{ techId: string; name: string; count: number }> {
    const rows = await dataSource.query(
      `SELECT tech.id AS "techId", u.name AS name, COUNT(*)::int AS count
       FROM tickets t
       JOIN technicians tech ON tech.id = t.technician_id
       JOIN users u ON u.id = tech.user_id
       WHERE t.shadow = false AND t.deleted_at IS NULL
       GROUP BY tech.id, u.name
       ORDER BY COUNT(*) DESC
       LIMIT 1`,
    );
    return { techId: rows[0].techId, name: rows[0].name, count: Number(rows[0].count) };
  }

  beforeAll(async () => {
    assertIsolatedTestDb();
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, '', 'utf8');
    moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    users = dataSource.getRepository(User);
    customers = dataSource.getRepository(Customer);
    appointments = dataSource.getRepository(Appointment);
    tickets = dataSource.getRepository(Ticket);

    adminToken = await login('ana@msp.local');
    mariaToken = await login('maria@msp.local');
    pedroToken = await login('pedro@msp.local');

    const mariaUser = await users.findOneOrFail({ where: { email: 'maria@msp.local' } });
    const pedroUser = await users.findOneOrFail({ where: { email: 'pedro@msp.local' } });
    mariaUserId = mariaUser.id;
    mariaName = mariaUser.name;
    mariaTechId = mariaUser.technicianId!;
    pedroTechId = pedroUser.technicianId!;

    // Tercer técnico (Nazareno) con usuario activo, creado por la API real.
    const nazarenoEmail = `nazareno-e2e-${suffix}@msp.local`;
    nazarenoName = 'Nazareno Giorgi';
    const createdUser = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        name: nazarenoName,
        email: nazarenoEmail,
        password: 'demo1234',
        role: RoleName.TECNICO,
        active: true,
      })
      .expect(201);
    nazarenoUserId = createdUser.body.id;
    const createdTech = await request(app.getHttpServer())
      .post('/api/technicians')
      .set(auth(adminToken))
      .send({ userId: nazarenoUserId })
      .expect(201);
    nazarenoTechId = createdTech.body.id;
    nazarenoToken = await login(nazarenoEmail);

    customer = await customers.save(
      customers.create({ name: `__e2e colaboradores ${suffix}`, active: true, sharedPortal: false }),
    );
    customerIds.push(customer.id);

    evidence('setup', {
      responsable: pedroTechId,
      maria: mariaTechId,
      nazareno: nazarenoTechId,
      db: process.env.E2E_ALLOW_DB,
    });
  });

  afterAll(async () => {
    if (appointmentIds.length) {
      await appointments.delete(appointmentIds);
    }
    if (ticketIds.length) {
      await dataSource.query('DELETE FROM ticket_technicians WHERE ticket_id = ANY($1)', [ticketIds]);
      await dataSource.query('DELETE FROM sla WHERE ticket_id = ANY($1)', [ticketIds]);
      await dataSource.query(`DELETE FROM notifications WHERE payload->>'ticketId' = ANY($1)`, [ticketIds]);
      await tickets.delete(ticketIds);
    }
    if (customerIds.length) await customers.delete(customerIds);
    if (app) await app.close();
    if (moduleFixture) await moduleFixture.close();
  });

  it('notifica a los colaboradores recién sumados y no a los que ya estaban', async () => {
    const ticketId = await createTicket(pedroTechId);
    const before = await notificationCount(nazarenoUserId, nazarenoToken);

    const first = await setCollaborators(ticketId, [mariaTechId]);
    expect(first).toEqual([mariaTechId]);
    const afterFirst = await notificationCount(nazarenoUserId, nazarenoToken);
    expect(afterFirst).toBe(before);

    const second = await setCollaborators(ticketId, [mariaTechId, nazarenoTechId]);
    expect(new Set(second)).toEqual(new Set([mariaTechId, nazarenoTechId]));
    const after = await notificationCount(nazarenoUserId, nazarenoToken);
    expect(after).toBe(before + 1);

    const note = (await notificationsFor(nazarenoToken)).find(
      (n) =>
        n.payload?.ticketId === ticketId &&
        String(n.payload?.message || '').includes('Te sumaron como colaborador'),
    );
    expect(note).toBeDefined();
    evidence('notificacion colaborador nuevo', {
      ticketId,
      antes: before,
      despues: after,
      mensaje: note.payload.message,
      tipo: note.type,
    });
  });

  it('devuelve 403 al editar colaboradores sin tickets:assign', async () => {
    const ticketId = ticketIds[0];
    const res = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticketId}`)
      .set(auth(mariaToken))
      .send({ collaboratorIds: [nazarenoTechId] })
      .expect(403);
    expect(String(res.body.message)).toMatch(/permiso para editar colaboradores/);

    const detail = await ticketDetail(ticketId);
    expect(new Set(detail.collaborators.map((c: { id: string }) => c.id))).toEqual(
      new Set([mariaTechId, nazarenoTechId]),
    );
    evidence('403 sin tickets:assign', {
      usuario: mariaName,
      status: res.status,
      message: res.body.message,
      colaboradoresTrasIntento: detail.collaborators.map((c: { name: string }) => c.name),
    });
  });

  it('saca al colaborador que pasa a responsable (POST assign y PATCH)', async () => {
    const ticketId = ticketIds[0];

    // Ruta assign: María era colaboradora y pasa a responsable.
    const assigned = await request(app.getHttpServer())
      .post(`/api/tickets/${ticketId}/assign`)
      .set(auth(adminToken))
      .send({ technicianId: mariaTechId })
      .expect(201);
    expect(assigned.body.technicianId).toBe(mariaTechId);
    expect(assigned.body.collaborators.map((c: { id: string }) => c.id)).not.toContain(mariaTechId);
    expect(assigned.body.collaborators.map((c: { id: string }) => c.id)).toContain(nazarenoTechId);

    const auditRows = await dataSource.query(
      `SELECT new_value FROM audit_logs
       WHERE entity_type = 'ticket' AND entity_id = $1 AND action = 'assignment_change'
       ORDER BY created_at DESC LIMIT 1`,
      [ticketId],
    );
    expect(auditRows[0].new_value.removedFromCollaborators).toBe(mariaTechId);
    evidence('assign quita colaborador (transacción)', {
      nuevoResponsable: mariaName,
      colaboradores: assigned.body.collaborators.map((c: { name: string }) => c.name),
      auditoria: auditRows[0].new_value,
    });

    // Ruta update: Nazareno era colaborador y pasa a responsable sin enviar
    // collaboratorIds; el service debe sacarlo en la misma transacción.
    const promoted = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticketId}`)
      .set(auth(adminToken))
      .send({ technicianId: nazarenoTechId })
      .expect(200);
    expect(promoted.body.technicianId).toBe(nazarenoTechId);
    expect(promoted.body.collaborators.map((c: { id: string }) => c.id)).not.toContain(nazarenoTechId);

    // Dejar el ticket en el estado usado por las pruebas de reporte/count.
    const restored = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticketId}`)
      .set(auth(adminToken))
      .send({ technicianId: pedroTechId, collaboratorIds: [mariaTechId, nazarenoTechId] })
      .expect(200);
    expect(restored.body.technicianId).toBe(pedroTechId);
    evidence('PATCH quita colaborador (transacción)', {
      nuevoResponsable: nazarenoName,
      colaboradoresTrasPromocion: promoted.body.collaborators.map((c: { name: string }) => c.name),
      responsableRestaurado: pedroTechId,
    });
  });

  it('la cita con 3 técnicos se ve completa al filtrar por cualquiero de ellos', async () => {
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date();
    end.setHours(11, 0, 0, 0);
    const subject = `E2E 3 tecnicos ${suffix}`;

    const created = await request(app.getHttpServer())
      .post('/api/appointments')
      .set(auth(adminToken))
      .send({
        type: 'visita',
        subject,
        customerId: customer.id,
        technicianId: pedroTechId,
        technicianIds: [pedroTechId, mariaTechId, nazarenoTechId],
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      })
      .expect(201);
    appointmentIds.push(created.body.id);

    const range = `from=${start.toISOString()}&to=${end.toISOString()}`;
    const expected = new Set([pedroTechId, mariaTechId, nazarenoTechId]);
    for (const [label, techId, token] of [
      ['Pedro', pedroTechId, pedroToken],
      ['María', mariaTechId, mariaToken],
      ['Nazareno', nazarenoTechId, nazarenoToken],
    ] as Array<[string, string, string]>) {
      const list = await request(app.getHttpServer())
        .get(`/api/appointments?${range}&technicianId=${techId}`)
        .set(auth(token))
        .expect(200);
      const appt = (list.body as Appointment[]).find((a) => a.id === created.body.id);
      expect(appt).toBeDefined();
      expect(new Set((appt!.technicianLinks || []).map((l) => l.technicianId))).toEqual(expected);

      const day = await request(app.getHttpServer()).get('/api/dashboard/my-day').set(auth(token)).expect(200);
      const dayAppt = (day.body.appointments as Appointment[]).find((a) => a.id === created.body.id);
      expect(dayAppt).toBeDefined();
      expect(new Set((dayAppt!.technicianLinks || []).map((l) => l.technicianId))).toEqual(expected);

      evidence('filtro technicianId en cita', {
        tecnico: label,
        cita: created.body.id,
        tecnicosEnCita: (appt!.technicianLinks || []).map((l) => l.technicianId),
        enMiDia: (dayAppt!.technicianLinks || []).length,
      });
    }
  });

  it('reportes expone la columna como colaborador sin mezclarla con responsable', async () => {
    const ticketId = await createTicket(pedroTechId);
    const before = await collaboratorReport();
    const beforeMaria = Number(before[mariaName] || 0);
    const beforeNazareno = Number(before[nazarenoName] || 0);

    await setCollaborators(ticketId, [mariaTechId, nazarenoTechId]);
    const after = await collaboratorReport();
    const afterMaria = Number(after[mariaName] || 0);
    const afterNazareno = Number(after[nazarenoName] || 0);

    expect(afterMaria).toBe(beforeMaria + 1);
    expect(afterNazareno).toBe(beforeNazareno + 1);
    expect(after[mariaName]).toBeDefined();
    evidence('reporte columna como colaborador', {
      columna: 'byTechnicianAsCollaborator',
      [mariaName]: { antes: beforeMaria, despues: afterMaria },
      [nazarenoName]: { antes: beforeNazareno, despues: afterNazareno },
    });
  });

  it('el filtro technicianId no cambia con el técnico que más tickets tiene', async () => {
    const top = await topResponsible();
    expect(top.techId).toBeDefined();
    const ticketId = await createTicket(top.techId);
    const otherTech = [pedroTechId, mariaTechId, nazarenoTechId].find((id) => id !== top.techId)!;

    const before = await countByResponsible(top.techId);
    await setCollaborators(ticketId, [otherTech]);
    const after = await countByResponsible(top.techId);

    expect(before).toBeGreaterThan(0);
    expect(after).toBe(before);
    evidence('conteo technicianId antes/despues', {
      tecnicoConMasTickets: top.name,
      ticketsResponsable: top.count,
      antes: before,
      despues: after,
      igualdad: before === after,
      colaboradorAgregado: otherTech,
    });
  });
});
