import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { RoleName } from '../src/common/enums';
import { assertIsolatedTestDb } from './test-db.guard';

jest.setTimeout(120000);

// Pruebas 1-9 del prompt de Tareas, ejecutadas sólo contra ops_msp_e2e.
// La prueba 10 (blindaje de salidas a clientes) se verifica además fuera de Jest.
describe('Tareas pendientes - correcciones e2e', () => {
  let app: INestApplication;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;

  let adminToken: string;
  let mariaToken: string;
  let consultaToken: string;
  let anaUserId: string;
  let mariaUserId: string;
  let pedroUserId: string;
  let pedroTechId: string;
  let customerId: string;

  const suffix = Date.now().toString();
  const taskIds: string[] = [];
  const ticketIds: string[] = [];
  const appointmentIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdTechIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const evidenceFile = path.resolve(
    __dirname,
    '../../backup/evidencia/TAREAS-correcciones-evidencia.jsonl',
  );
  const evidence = (label: string, data: unknown) => {
    const line = JSON.stringify({ at: new Date().toISOString(), label, data });
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.appendFileSync(evidenceFile, `${line}\n`, 'utf8');
    console.log(`[EVIDENCIA][tareas] ${label} ${line}`);
  };

  async function login(email: string, password = 'demo1234'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(201);
    return res.body.accessToken as string;
  }

  async function createTask(body: Record<string, unknown>, token = adminToken): Promise<any> {
    const res = await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(token))
      .send(body)
      .expect(201);
    taskIds.push(res.body.id);
    return res.body;
  }

  async function createTicket(technicianId?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/tickets')
      .set(auth(adminToken))
      .send({
        customerId,
        technicianId,
        title: `__e2e tareas ${suffix} ${ticketIds.length + 1}`,
        description: 'Ticket aislado para verificar tareas vinculadas',
      })
      .expect(201);
    ticketIds.push(res.body.id);
    return res.body.id as string;
  }

  async function myDay(token: string): Promise<any[]> {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard/my-day')
      .set(auth(token))
      .expect(200);
    return res.body.tasks ?? [];
  }

  async function notifications(token: string): Promise<any[]> {
    const res = await request(app.getHttpServer())
      .get('/api/notifications')
      .set(auth(token))
      .expect(200);
    return res.body as any[];
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

    adminToken = await login('ana@msp.local');
    mariaToken = await login('maria@msp.local');
    const [ana, maria, pedro] = await Promise.all([
      dataSource.query('SELECT id FROM users WHERE email = $1', ['ana@msp.local']),
      dataSource.query('SELECT id FROM users WHERE email = $1', ['maria@msp.local']),
      dataSource.query('SELECT id FROM users WHERE email = $1', ['pedro@msp.local']),
    ]);
    anaUserId = ana[0].id;
    mariaUserId = maria[0].id;
    pedroUserId = pedro[0].id;
    const tech = await dataSource.query('SELECT id FROM technicians WHERE user_id = $1', [pedroUserId]);
    pedroTechId = tech[0].id;

    const customer = await request(app.getHttpServer())
      .post('/api/customers')
      .set(auth(adminToken))
      .send({ name: `__e2e tareas ${suffix}`, active: true, sharedPortal: false })
      .expect(201);
    customerId = customer.body.id;

    // Usuario Consulta: tiene CALENDAR_READ pero no CALENDAR_WRITE.
    const consulta = await request(app.getHttpServer())
      .post('/api/users')
      .set(auth(adminToken))
      .send({
        name: `Consulta Tareas ${suffix}`,
        email: `consulta-tareas-${suffix}@msp.local`,
        password: 'demo1234',
        role: RoleName.CONSULTA,
        active: true,
      })
      .expect(201);
    createdUserIds.push(consulta.body.id);
    consultaToken = await login(`consulta-tareas-${suffix}@msp.local`);

    evidence('setup', { db: process.env.E2E_ALLOW_DB, anaUserId, mariaUserId, pedroUserId, customerId });
  });

  afterAll(async () => {
    if (taskIds.length) {
      await dataSource.query(
        `DELETE FROM notifications WHERE payload->>'taskId' = ANY($1)`, [taskIds],
      );
      await dataSource.query(
        `DELETE FROM audit_logs WHERE entity_type = 'task' AND entity_id = ANY($1)`, [taskIds],
      );
      // Las ocurrencias nuevas no se registran en taskIds: se limpian por padre.
      await dataSource.query(`DELETE FROM tasks WHERE recurrence_parent_id = ANY($1)`, [taskIds]);
      await dataSource.query(`DELETE FROM tasks WHERE id = ANY($1)`, [taskIds]);
    }
    if (appointmentIds.length) {
      await dataSource.query(`DELETE FROM appointment_technicians WHERE appointment_id = ANY($1)`, [appointmentIds]);
      await dataSource.query(`DELETE FROM appointments WHERE id = ANY($1)`, [appointmentIds]);
    }
    if (ticketIds.length) {
      await dataSource.query('DELETE FROM ticket_technicians WHERE ticket_id = ANY($1)', [ticketIds]);
      await dataSource.query('DELETE FROM sla WHERE ticket_id = ANY($1)', [ticketIds]);
      await dataSource.query(`DELETE FROM tickets WHERE id = ANY($1)`, [ticketIds]);
    }
    if (customerId) await dataSource.query('DELETE FROM customers WHERE id = $1', [customerId]);
    if (createdTechIds.length) {
      await dataSource.query(`DELETE FROM technicians WHERE id = ANY($1)`, [createdTechIds]);
    }
    if (createdUserIds.length) {
      await dataSource.query(`DELETE FROM audit_logs WHERE user_id = ANY($1)`, [createdUserIds]);
      await dataSource.query(`DELETE FROM notifications WHERE user_id = ANY($1)`, [createdUserIds]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [createdUserIds]);
    }
    if (app) await app.close();
    if (moduleFixture) await moduleFixture.close();
  });

  it('1 - tarea propia con vencimiento hoy aparece en Mi día con fecha de hoy', async () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const task = await createTask({
      title: `__e2e tarea propia ${suffix}`,
      assigneeId: anaUserId,
      dueAt: today.toISOString(),
    });
    const mine = await myDay(adminToken);
    const found = mine.find((t: any) => t.id === task.id);
    expect(found).toBeDefined();
    expect(new Date(found.dueAt).toDateString()).toBe(today.toDateString());
    evidence('prueba-1', { taskId: task.id, dueAt: task.dueAt });
  });

  it('2 - María ve su tarea en Mi día y en /tasks y recibe la notificación interna', async () => {
    const before = (await notifications(mariaToken)).filter(
      (n) => n.payload?.taskId && String(n.payload.title || '').includes(suffix),
    ).length;
    const task = await createTask({
      title: `__e2e tarea de María ${suffix}`,
      assigneeId: mariaUserId,
      dueAt: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(task.assigneeId).toBe(mariaUserId);

    const listed = await request(app.getHttpServer())
      .get('/api/tasks?mine=true')
      .set(auth(mariaToken))
      .expect(200);
    expect(listed.body.some((t: any) => t.id === task.id)).toBe(true);

    const mine = await myDay(mariaToken);
    expect(mine.some((t: any) => t.id === task.id)).toBe(true);

    const note = (await notifications(mariaToken)).find((n) => n.payload?.taskId === task.id);
    expect(note).toBeDefined();
    expect(note.type).toBe('tarea_asignada');
    expect(note.payload.message).toContain('Te asignaron la tarea:');
    expect((await notifications(mariaToken)).length).toBeGreaterThanOrEqual(before);
    evidence('prueba-2', { taskId: task.id, assigneeId: mariaUserId, notification: note.payload });
  });

  it('3 - vencida y sin fecha aparecen en Mi día, vencida primero', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const overdue = await createTask({
      title: `__e2e vencida ${suffix}`, assigneeId: anaUserId, dueAt: yesterday,
    });
    const noDate = await createTask({
      title: `__e2e sin fecha ${suffix}`, assigneeId: anaUserId, dueAt: null,
    });
    const mine = await myDay(adminToken);
    const overdueIdx = mine.findIndex((t: any) => t.id === overdue.id);
    const noDateIdx = mine.findIndex((t: any) => t.id === noDate.id);
    expect(overdueIdx).toBeGreaterThanOrEqual(0);
    expect(noDateIdx).toBeGreaterThanOrEqual(0);
    expect(overdueIdx).toBeLessThan(noDateIdx);
    evidence('prueba-3', { overdueIdx, noDateIdx });
  });

  it('4 - marcar hecha y deshacer devuelve la tarea a pendiente', async () => {
    const task = await createTask({ title: `__e2e deshacer ${suffix}`, assigneeId: anaUserId });
    await request(app.getHttpServer())
      .patch(`/api/tasks/${task.id}`)
      .set(auth(adminToken))
      .send({ status: 'hecha' })
      .expect(200);
    const undone = await request(app.getHttpServer())
      .patch(`/api/tasks/${task.id}`)
      .set(auth(adminToken))
      .send({ status: 'pendiente' })
      .expect(200);
    expect(undone.body.status).toBe('pendiente');
    evidence('prueba-4', { taskId: task.id, status: undone.body.status });
  });

  it('5 - recurrente semanal vinculada a ticket crea la próxima con vínculo y responsable', async () => {
    const ticketId = await createTicket(pedroTechId);
    const dueAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const task = await createTask({
      title: `__e2e semanal ${suffix}`,
      assigneeId: mariaUserId,
      dueAt,
      recurrenceRule: 'weekly',
      relatedEntityType: 'ticket',
      relatedEntityId: ticketId,
    });
    const res = await request(app.getHttpServer())
      .patch(`/api/tasks/${task.id}`)
      .set(auth(adminToken))
      .send({ status: 'hecha' })
      .expect(200);
    expect(res.body.done.id).toBe(task.id);
    expect(res.body.done.status).toBe('hecha');
    const next = res.body.next;
    expect(next.status).toBe('pendiente');
    expect(next.relatedEntityType).toBe('ticket');
    expect(next.relatedEntityId).toBe(ticketId);
    expect(next.assigneeId).toBe(mariaUserId);
    expect(next.recurrenceParentId).toBe(task.id);
    expect(new Date(next.dueAt).getTime() - new Date(dueAt).getTime()).toBe(7 * 86400000);
    taskIds.push(next.id);

    const audits = await dataSource.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'task' AND entity_id = ANY($1)`,
      [[task.id, next.id]],
    );
    expect(audits.map((a: any) => a.action)).toEqual(expect.arrayContaining(['update', 'create']));
    evidence('prueba-5', { done: task.id, next: next.id, dueAt: next.dueAt, audits });
  });

  it('6 - editar prioridad audita el valor anterior real', async () => {
    const task = await createTask({
      title: `__e2e auditoría ${suffix}`, assigneeId: anaUserId, priority: 'normal',
    });
    await request(app.getHttpServer())
      .patch(`/api/tasks/${task.id}`)
      .set(auth(adminToken))
      .send({ priority: 'alta' })
      .expect(200);
    const rows = await dataSource.query(
      `SELECT old_value, new_value FROM audit_logs
       WHERE entity_type = 'task' AND entity_id = $1 AND action = 'update'
       ORDER BY created_at DESC LIMIT 1`,
      [task.id],
    );
    expect(rows[0].old_value.priority).toBe('normal');
    expect(rows[0].new_value.priority).toBe('alta');
    evidence('prueba-6', rows[0]);
  });

  it('7 - tarea de seguimiento queda vinculada al responsable; cerrar avisa sin bloquear', async () => {
    const ticketId = await createTicket(pedroTechId);
    const task = await createTask({
      title: `__e2e seguimiento ${suffix}`,
      assigneeId: pedroUserId,
      relatedEntityType: 'ticket',
      relatedEntityId: ticketId,
    });
    expect(task.relatedEntityId).toBe(ticketId);
    const closed = await request(app.getHttpServer())
      .patch(`/api/tickets/${ticketId}`)
      .set(auth(adminToken))
      .send({ status: 'cerrado' })
      .expect(200);
    expect(closed.body.warning).toContain('1 tarea pendiente');
    evidence('prueba-7', { ticketId, taskId: task.id, warning: closed.body.warning });
  });

  it('8 - turnos viejos de tipo tarea se siguen listando (aunque ya no se crean)', async () => {
    const startAt = new Date(Date.now() + 2 * 86400000).toISOString();
    const endAt = new Date(Date.now() + 2 * 86400000 + 3600000).toISOString();
    const appt = await request(app.getHttpServer())
      .post('/api/appointments')
      .set(auth(adminToken))
      .send({ type: 'tarea', subject: `__e2e turno tarea viejo ${suffix}`, startAt, endAt })
      .expect(201);
    appointmentIds.push(appt.body.id);
    const listed = await request(app.getHttpServer())
      .get('/api/appointments?from=2020-01-01T00:00:00Z&to=2035-01-01T00:00:00Z')
      .set(auth(adminToken))
      .expect(200);
    const found = (listed.body as any[]).find((a) => a.id === appt.body.id);
    expect(found).toBeDefined();
    expect(found.type).toBe('tarea');
    evidence('prueba-8', { appointmentId: appt.body.id, type: found.type });
  });

  it('9 - usuario sin CALENDAR_WRITE no puede crear ni editar (403)', async () => {
    await request(app.getHttpServer())
      .post('/api/tasks')
      .set(auth(consultaToken))
      .send({ title: `__e2e sin permiso ${suffix}` })
      .expect(403);
    const task = await createTask({ title: `__e2e editar sin permiso ${suffix}` });
    await request(app.getHttpServer())
      .patch(`/api/tasks/${task.id}`)
      .set(auth(consultaToken))
      .send({ priority: 'critica' })
      .expect(403);
    evidence('prueba-9', { taskId: task.id, create: 403, update: 403 });
  });

  it('10 - la asignación notifica por canal interno, sin datos de cliente', async () => {
    const task = await createTask({
      title: `__e2e blindaje ${suffix}`, assigneeId: mariaUserId,
    });
    const note = (await notifications(mariaToken)).find((n) => n.payload?.taskId === task.id);
    expect(note).toBeDefined();
    expect(note.type).toBe('tarea_asignada');
    expect(note.payload.customerId).toBeUndefined();
    expect(note.payload.email).toBeUndefined();
    expect(note.payload.whatsapp).toBeUndefined();
    evidence('prueba-10', { taskId: task.id, type: note.type, payload: note.payload });
  });

  const agendaRange =
    'from=2020-01-01T00:00:00Z&to=2035-01-01T00:00:00Z&includeOverdue=true';

  it('11 - supervisor con "todos los técnicos": todo el equipo y las sin asignar', async () => {
    const dueAt = new Date(Date.now() + 86400000).toISOString();
    const own = await createTask({
      title: `__e2e agenda equipo ana ${suffix}`, assigneeId: anaUserId, dueAt,
    });
    const mariaTask = await createTask({
      title: `__e2e agenda equipo maria ${suffix}`, assigneeId: mariaUserId, dueAt,
    });
    const unassigned = await createTask({
      title: `__e2e agenda sin asignar ${suffix}`, dueAt,
    });
    const res = await request(app.getHttpServer())
      .get(`/api/tasks?${agendaRange}&team=true`)
      .set(auth(adminToken))
      .expect(200);
    const byId = new Map((res.body as any[]).map((t) => [t.id, t] as const));
    expect(byId.has(own.id)).toBe(true);
    expect(byId.has(mariaTask.id)).toBe(true);
    expect(byId.has(unassigned.id)).toBe(true);
    expect(byId.get(mariaTask.id)?.assignee?.id).toBe(mariaUserId);
    expect(typeof byId.get(mariaTask.id)?.assignee?.name).toBe('string');
    expect(byId.get(unassigned.id)?.assignee).toBeNull();
    evidence('prueba-11', {
      team: [own.id, mariaTask.id, unassigned.id],
      assigneeName: byId.get(mariaTask.id)?.assignee?.name,
    });
  });

  it('12 - con un técnico elegido se filtra por el userId de ese técnico', async () => {
    const techs = await request(app.getHttpServer())
      .get('/api/technicians')
      .set(auth(adminToken))
      .expect(200);
    const mariaTech = (techs.body as any[]).find((t) => t.userId === mariaUserId);
    expect(mariaTech).toBeDefined();
    const dueAt = new Date(Date.now() + 86400000).toISOString();
    const theirs = await createTask({
      title: `__e2e agenda tecnico maria ${suffix}`, assigneeId: mariaTech.userId, dueAt,
    });
    const other = await createTask({
      title: `__e2e agenda tecnico ana ${suffix}`, assigneeId: anaUserId, dueAt,
    });
    const res = await request(app.getHttpServer())
      .get(`/api/tasks?${agendaRange}&assigneeId=${mariaTech.userId}`)
      .set(auth(adminToken))
      .expect(200);
    const ids = (res.body as any[]).map((t) => t.id);
    expect(ids).toContain(theirs.id);
    expect(ids).not.toContain(other.id);
    evidence('prueba-12', { technicianId: mariaTech.id, userId: mariaTech.userId, ids });
  });

  it('13 - Mi día sigue mostrando sólo las tareas propias y las sin asignar', async () => {
    const mine = await createTask({ title: `__e2e midia propio ${suffix}`, assigneeId: anaUserId });
    const theirs = await createTask({ title: `__e2e midia ajeno ${suffix}`, assigneeId: mariaUserId });
    const unassigned = await createTask({ title: `__e2e midia sin asignar ${suffix}` });
    const ids = (await myDay(adminToken)).map((t) => t.id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(unassigned.id);
    expect(ids).not.toContain(theirs.id);
    evidence('prueba-13', { mine: mine.id, unassigned: unassigned.id, excluded: theirs.id });
  });
});
