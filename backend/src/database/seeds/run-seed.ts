import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { SeedService } from '../../database/seeds/seed.service';

// Manual seed runner: `npm run seed`.
// Initializes the app, forces a seed, then exits. Useful for re-seeding a
// fresh DB outside the app bootstrap.
async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('SeedRunner');
  try {
    const seed = app.get(SeedService);
    await seed.seedRoles();
    await seed.seedUsers();
    await seed.seedDemoCustomer();
    logger.log('Seed forzado completado.');
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Error en seed:', e);
  process.exit(1);
});
