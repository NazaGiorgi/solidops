import 'reflect-metadata';
import { DataSource } from 'typeorm';
import dbConfig from '../config/database.config';

// Standalone DataSource for CLI migrations / seeding outside Nest runtime.
// dbConfig() returns concrete PostgresConnectionOptions, so the spread keeps
// the exact Postgres types. `autoLoadEntities` is NestJS-only; it's dropped by
// DataSource (spread excess props are allowed) and only matters for forRoot.
export const AppDataSource = new DataSource({
  ...dbConfig(),
  entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});
