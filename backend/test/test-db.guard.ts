import { Logger } from '@nestjs/common';

const logger = new Logger('TestDbGuard');

export function assertIsolatedTestDb(): void {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === 'production') {
    const msg = 'E2E tests must not run in production (NODE_ENV=production).';
    logger.error(msg);
    throw new Error(msg);
  }

  const dbName = process.env.DB_NAME || '';
  const allowedSuffixes = ['_e2e', '_test'];
  const hasSuffix = allowedSuffixes.some((s) => dbName.endsWith(s));
  if (!hasSuffix) {
    const msg = `DB_NAME="${dbName}" is not an isolated test DB. Must end with _e2e or _test.`;
    logger.error(msg);
    throw new Error(msg);
  }

  const host = process.env.DB_HOST || 'postgres';
  const port = process.env.DB_PORT || '5432';
  const target = `${host}:${port}/${dbName}`;
  const allowedTarget = process.env.E2E_ALLOW_DB;
  if (!allowedTarget) {
    const msg = `E2E_ALLOW_DB is not set. Aborting to prevent running against unexpected DB.`;
    logger.error(msg);
    throw new Error(msg);
  }
  if (allowedTarget !== target) {
    const msg = `E2E_ALLOW_DB="${allowedTarget}" does not match current target "${target}". Aborting.`;
    logger.error(msg);
    throw new Error(msg);
  }

  logger.log(`Test DB isolation OK: ${target}`);
}
