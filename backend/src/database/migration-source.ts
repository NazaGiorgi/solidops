import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import dbConfig from '../config/database.config';

// DataSource SOLO para migraciones: sin entidades (el glob de entidades de
// data-source.ts recorre TODO /app incl. node_modules y bloquea en initialize).
// Las migraciones no necesitan cargar entidades, solo conectarse a la base.
export const MigrationDataSource = new DataSource({
  ...dbConfig(),
  entities: [],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});

// Aplica las migraciones pendientes (tabla `migrations`).
export async function runPendingMigrations(): Promise<string[]> {
  await MigrationDataSource.initialize();
  try {
    const executed = await MigrationDataSource.runMigrations();
    return executed.map((m) => m.name);
  } finally {
    await MigrationDataSource.destroy();
  }
}

// Entrypoint directo si se corre como script.
if (require.main === module) {
  const logger = new Logger('MigrationRunner');
  runPendingMigrations()
    .then((names) => {
      logger.log(names.length === 0 ? 'No hay migraciones pendientes.' : `Migraciones aplicadas: ${names.join(', ')}`);
      process.exit(0);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error('Error al correr migraciones:', e);
      process.exit(1);
    });
}
