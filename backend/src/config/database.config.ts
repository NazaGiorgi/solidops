import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

const isProd = process.env.NODE_ENV === 'production';

// Concrete Postgres options (not the generic TypeOrmModuleOptions union), so
// every property (type, database, ssl, ...) keeps its exact Postgres type
// instead of the union that covers all TypeORM drivers (incl. better-sqlite3).
// `autoLoadEntities` is a NestJS-only convenience not present on the typeorm
// type, so we intersect it.
export default (): PostgresConnectionOptions & { autoLoadEntities: boolean } => {
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'ops',
    password: process.env.DB_PASSWORD || 'ops_dev_password',
    database: process.env.DB_NAME || 'ops_msp',
    // In dev/deploy-local, synchronize is acceptable for Fase 1.
    // Production should use migrations instead once the schema stabilises.
    synchronize: true,
    autoLoadEntities: true,
    // SQL logging disabled by default to keep terminal clean.
    logging: process.env.DB_LOGGING === 'true',
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
    // Required by pgvector-aware tooling later; benign now.
    ssl: isProd && process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    // Pool sizing — explicit and generous so it never exhausts silently.
    // `max` guards against runaway connection growth; `connectionTimeoutMillis`
    // makes a stuck pool fail fast instead of hanging /api/health forever.
    extra: {
      pool: {
        max: parseInt(process.env.DB_POOL_MAX || '20', 10),
        min: 2,
        idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE || '30000', 10),
        connectionTimeoutMillis: parseInt(process.env.DB_POOL_TIMEOUT || '5000', 10),
      },
    },
  };
};
