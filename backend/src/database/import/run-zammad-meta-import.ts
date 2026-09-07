import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as path from 'path';
import { AppModule } from '../../app.module';
import { ZammadMetaImportService, ZammadMeta } from './zammad-meta-import.service';

// Manual import runner: `npm run import:zammad:meta -- <path-to-json>`.
// Reads the Zammad platform metadata export (import/export_zammad_meta.rb) and
// creates Customers (from orgs), Users (staff) + Technician profiles, Contacts
// (portal) and Mailboxes in SolidOps.
async function run() {
  const file = process.argv[2] || 'src/database/import/zammad_meta.json';
  const abs = path.resolve(process.cwd(), file);
  const logger = new Logger('ZammadMetaImportRunner');

  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch (e) {
    logger.error(`No se pudo leer ${abs}: ${(e as Error).message}`);
    process.exit(1);
  }
  const meta = JSON.parse(raw.replace('\uFEFF', '')) as ZammadMeta;
  logger.log(`Leídos ${meta.organizations?.length || 0} organizaciones, ${meta.users?.length || 0} usuarios, ${meta.email_channels?.length || 0} canales`);

  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(ZammadMetaImportService);
  const result = await service.import(meta);
  logger.log(JSON.stringify(result));
  await app.close();
  process.exit(0);
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Error en import:', e);
  process.exit(1);
});
