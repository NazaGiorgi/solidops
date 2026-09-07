import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import { AppModule } from '../../app.module';
import {
  TicketImportService,
  ImportOptions,
  AttachmentsOnlyOptions,
} from './ticket-import.service';

// Manual import runner for the FULL Zammad ticket export (~40k).
//
// Uso:
//   npm run import:zammad:full -- --ndjson-dir <carpeta con NDJSON> [--dry-run] [--limit N]
//                            [--fail-report <archivo>] [--attach-prefix tickets]
//   npm run import:zammad:attachments -- --ndjson-dir <carpeta con NDJSON+attachments_*>
//                            [--dry-run] [--limit N] [--ticket-ids 1,2,3]
//                            [--fail-report <archivo>] [--attach-prefix tickets]
//
// Argumentos:
//   --ndjson-dir     carpeta con los tickets_*.ndjson (+ attachments_*/) exportados desde Zammad
//   --dry-run        solo reporta (no escribe en la base)
//   --limit N        importar solo los primeros N tickets nuevos
//   --attachments-only   migrar SOLO los adjuntos de tickets ya importados
//   --ticket-ids     (con --attachments-only) lista de id de Zammad separados por coma
//   --fail-report    escribir el reporte de fallidos a un archivo
//   --attach-prefix  prefijo en MinIO para los adjuntos (default 'tickets')
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function run() {
  const logger = new Logger('TicketImportRunner');
  const dir = arg('--ndjson-dir');
  if (!dir) {
    logger.error('Se requiere --ndjson-dir con la ruta a la carpeta de NDJSON exportados.');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const attachmentsOnly = process.argv.includes('--attachments-only');
  const limit = arg('--limit') ? parseInt(arg('--limit')!, 10) : undefined;

  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(TicketImportService);

  if (attachmentsOnly) {
    const idsRaw = arg('--ticket-ids');
    const ticketIds = idsRaw
      ? idsRaw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
      : undefined;
    const opts: AttachmentsOnlyOptions = {
      dryRun,
      outDir: path.resolve(dir),
      failReport: arg('--fail-report') || path.resolve(process.cwd(), 'import/attachments-fail-report.txt'),
      attachmentsPrefix: arg('--attach-prefix') || 'tickets',
      limit,
      ticketIds,
    };
    logger.log(`Migrando ATTACHMENTS (attachment-only) desde ${opts.outDir} (dryRun=${dryRun}, limit=${limit ?? 'todos'}, ticketIds=${ticketIds ? ticketIds.join(',') : 'todos'})`);
    const result = await service.importAttachmentsOnly(opts);
    logger.log(JSON.stringify({ ...result, failures: undefined }, null, 2));
    await app.close();
    process.exit(0);
  }

  const opts: ImportOptions = {
    dryRun,
    outDir: path.resolve(dir),
    failReport: arg('--fail-report') || path.resolve(process.cwd(), 'import/fail-report.txt'),
    attachmentsPrefix: arg('--attach-prefix') || 'tickets',
    limit,
  };

  logger.log(`Importando tickets Zammad desde ${opts.outDir} (dryRun=${dryRun}, limit=${limit ?? 'todos'})`);

  const result = await service.import(opts);
  logger.log(JSON.stringify({ ...result, failures: undefined }, null, 2));
  await app.close();
  process.exit(0);
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Error en import de tickets:', e);
  process.exit(1);
});
