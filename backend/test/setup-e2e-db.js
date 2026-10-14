#!/usr/bin/env node
// One-time bootstrap for the isolated e2e database (dev only).
//
//   npm run test:e2e:setup
//
// Creates <DB_NAME> (default ops_msp_e2e) in the dev Postgres, builds the schema
// the same way the app does (synchronize:true on boot + seed), and recreates the
// non-entity objects the tests rely on (the `ticket_number_seq` global counter).
//
// Note: TypeORM migrations are intentionally NOT run here. This project builds
// its schema with synchronize:true, and the migration set overlaps with it
// (e.g. AddPortalRegistration adds a column synchronize already created), so
// running migrations on a synchronized DB collides. See the report/notes.
const { Client } = require('pg');
const { spawnSync } = require('child_process');
const path = require('path');

const dbHost = process.env.DB_HOST || 'postgres';
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const dbUser = process.env.DB_USER || 'ops';
const dbPassword = process.env.DB_PASSWORD || 'ops_dev_password';
const dbName = process.env.DB_NAME || 'ops_msp_e2e';
const adminDb = process.env.DB_ADMIN_NAME || 'postgres';

async function withClient(database, fn) {
  const client = new Client({ host: dbHost, port: dbPort, user: dbUser, password: dbPassword, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureDatabase() {
  const exists = await withClient(adminDb, async (c) => {
    const res = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    return res.rowCount > 0;
  });
  if (exists) {
    console.log(`[e2e:setup] Database "${dbName}" already exists.`);
    return;
  }
  console.log(`[e2e:setup] Creating database "${dbName}"...`);
  await withClient(adminDb, async (c) => {
    await c.query(`CREATE DATABASE "${dbName}"`);
  });
}

function runSeed() {
  console.log('[e2e:setup] Seeding schema + data (synchronize on boot)...');
  const entry = path.resolve(__dirname, '..', 'src', 'database', 'seeds', 'run-seed.ts');
  const result = spawnSync(
    process.execPath,
    ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register', entry],
    {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DB_NAME: dbName, RUN_SEED: 'true' },
      encoding: 'utf8',
      // The seed commits before the app's background workers keep the process
      // alive, so a timeout SIGTERM after completion is expected and safe.
      timeout: 180000,
      stdio: 'pipe',
    },
  );
  const out = `${result.stdout || ''}${result.stderr || ''}`;
  if (!/Seed forzado completado|Seed completado/.test(out)) {
    console.error(out);
    throw new Error('Seed did not report completion.');
  }
  console.log('[e2e:setup] Seed completed.');
}

async function ensureSequence() {
  await withClient(dbName, async (c) => {
    await c.query('CREATE SEQUENCE IF NOT EXISTS ticket_number_seq START 1');
  });
  console.log('[e2e:setup] Ensured ticket_number_seq.');
}

(async () => {
  await ensureDatabase();
  runSeed();
  await ensureSequence();
  console.log(`[e2e:setup] Ready: ${dbHost}:${dbPort}/${dbName}`);
})().catch((e) => {
  console.error('[e2e:setup] FAILED:', e.message);
  process.exit(1);
});
