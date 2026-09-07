import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Smoke test for the core auth + RBAC flow.
// Requires a running Postgres/Redis/MinIO (or the full stack via docker-compose).
// Run with: npm run test:e2e
describe('Smoke e2e (auth + protected route)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('logs in as a seeded admin/supervisor and gets tokens', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ana@msp.local', password: 'demo1234' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe('Supervisor');
    accessToken = res.body.accessToken;
  });

  it('rejects a protected route without a token', async () => {
    await request(app.getHttpServer()).get('/api/tickets').expect(401);
  });

  it('allows a protected route with a valid token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('login with a wrong password fails', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ana@msp.local', password: 'wrong-pass' })
      .expect(401);
  });
});
