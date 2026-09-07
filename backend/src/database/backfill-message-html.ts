import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { sanitizeHtml } from '../modules/mailboxes/mime.helper';

// html-to-text no trae tipos; se usa require con cast.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const htmlToText = require('html-to-text') as {
  htmlToText: (html: string, options?: { wordwrap?: boolean }) => string;
};

// Backfill de mensajes migrados de Zammad que quedaron con HTML crudo en `body`
// y `body_html = NULL` (el importer nunca pobló body_html).
//
// Para cada mensaje afectado:
//   - body_html = sanitizeHtml(body)   (mismo sanitizador que usa la ingesta en vivo)
//   - body      = htmlToText(body)     (texto plano legible, sin tags)
//
// Procesa en lotes (resumible: solo toma los que aún tienen body_html IS NULL) y
// loguea progreso. Requiere `html-to-text` (transitiva de mailparser).
//
// Uso: `docker exec ops-backend node /app/dist/database/backfill-message-html.js`
// (tras compilar con npm run build).
const LOG_PREFIX = '[BACKFILL-BODYHTML]';

async function run() {
  const logger = new Logger('BackfillMessageHtml');
  const app = await NestFactory.createApplicationContext(AppModule);
  const dataSource = app.get(DataSource);

  // Condición de detección (heurística): HTML crudo en body sin body_html.
  // Coincide con la query confirmada (36.954 mensajes).
  const DETECTION = `(body LIKE '%<br%' OR body LIKE '%<div%' OR body LIKE '%</%')`;

  const [countRow] = await dataSource.query(
    `SELECT COUNT(*) AS c FROM ticket_messages WHERE body_html IS NULL AND ${DETECTION}`,
  );
  const total = Number(countRow.c);
  logger.log(`${LOG_PREFIX} total a procesar: ${total}`);

  const BATCH = 500;
  let processed = 0;
  let failed = 0;

  while (true) {
    const rows: Array<{ id: string; body: string }> = await dataSource.query(
      `SELECT id, body FROM ticket_messages WHERE body_html IS NULL AND ${DETECTION} LIMIT ${BATCH}`,
    );
    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        const html = sanitizeHtml(row.body || '');
        const text = htmlToText.htmlToText(row.body || '', { wordwrap: false });
        await dataSource.query(
          `UPDATE ticket_messages SET body_html = $1, body = $2 WHERE id = $3`,
          [html, text, row.id],
        );
        processed++;
      } catch (e) {
        failed++;
        logger.error(`${LOG_PREFIX} fallo mensaje ${row.id}: ${(e as Error).message}`);
      }
    }
    logger.log(`${LOG_PREFIX} procesados ${processed}/${total} (fallidos ${failed})`);
  }

  logger.log(`${LOG_PREFIX} FIN: procesados ${processed}, fallidos ${failed}, total ${total}`);
  await app.close();
  process.exit(0);
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(`${LOG_PREFIX} Error fatal:`, e);
  process.exit(1);
});
