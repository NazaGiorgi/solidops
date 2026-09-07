import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as path from 'path';
import { AppModule } from '../../app.module';
import { ZammadImportService, ZammadTicket } from './zammad-import.service';

// Manual import runner: `npm run import:zammad -- <path-to-json>`.
// Reads the Zammad export JSON (see import/export_zammad.rb) and creates
// Customer/Contact/Ticket/TicketMessage in SolidOps.
async function run() {
  const file = process.argv[2] || 'src/database/import/export_l1l2l3.json';
  const abs = path.resolve(process.cwd(), file);
  const logger = new Logger('ZammadImportRunner');

  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (e) {
    logger.error(`No se pudo leer ${abs}: ${(e as Error).message}`);
    process.exit(1);
  }
  const tickets = JSON.parse(raw.replace('\uFEFF', '')) as ZammadTicket[];
  logger.log(`Leídos ${tickets.length} tickets desde ${abs}`);

  const app = await NestFactory.createApplicationContext(AppModule)
  const service = app.get(ZammadImportService);
  const result = await service.import(tickets);
  logger.log(JSON.stringify(result));
  await app.close();
  process.exit(0);
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Error en import:', e);
  process.exit(1);
});
