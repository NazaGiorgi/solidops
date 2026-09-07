import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { Contact } from '../src/entities/contact.entity';
import { MailboxesService } from '../src/modules/mailboxes/mailboxes.service';

// Envío ÚNICO del anuncio de migración a la nueva plataforma de soporte.
// NO es parte del flujo del producto: se ejecuta a mano una sola vez.
//
//   npm run send:migration-announcement                 -> DRY-RUN (no envía nada)
//   npm run send:migration-announcement -- --send       -> envío real
//   npm run send:migration-announcement -- --pdf=/ruta/a/instructivo....pdf
//
// La ruta del PDF también puede darse con la variable de entorno MIGRATION_PDF_PATH.
// Por defecto busca en <backend>/assets/instructivo-clientes-nueva-plataforma-soporte.pdf.
// Sin el flag --send el script NUNCA manda emails reales, sin importar cómo se lo invoque.

const SUBJECT = 'Importante: cambios en nuestro sistema de soporte técnico';
const PDF_FILENAME = 'instructivo-clientes-nueva-plataforma-soporte.pdf';
const DEFAULT_PDF_PATH = path.join(process.cwd(), 'assets', PDF_FILENAME);
const BATCH_SIZE = 25;
const BATCH_PAUSE_MS = 2500;
const PREVIEW_COUNT = 10;

function parseArgs(argv: string[]): { send: boolean; pdf: string | null } {
  const send = argv.includes('--send');
  const flag = argv.find((a) => a.startsWith('--pdf='));
  return { send, pdf: flag ? flag.slice('--pdf='.length) : (process.env.MIGRATION_PDF_PATH || null) };
}

function isEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function buildText(): string {
  return (
    'Estimado cliente:\n\n' +
    'Reorganizamos nuestro sistema de soporte técnico. A partir de ahora todas las consultas ' +
    'se gestionan desde una nueva plataforma, con un portal de cliente propio para hacer ' +
    'seguimiento de tus solicitudes y la atención por WhatsApp como canal adicional.\n\n' +
    'Adjuntamos un instructivo con los nuevos números de contacto y los pasos a seguir para ' +
    'usar el portal. Es importante que lo lea.\n\n' +
    'Saludos,\n' +
    'Equipo de Soporte — Solido Connecting Solutions\n' +
    'SolidoCS, lo hacemos simple.'
  );
}

function buildHtml(): string {
  return (
    '<p>Estimado cliente,</p>' +
    '<p>Reorganizamos nuestro sistema de soporte técnico. A partir de ahora todas las consultas ' +
    'se gestionan desde una <strong>nueva plataforma</strong>, con un <strong>portal de cliente</strong> ' +
    'propio para hacer seguimiento de tus solicitudes y la atención por <strong>WhatsApp</strong> como ' +
    'canal adicional.</p>' +
    '<p>Adjuntamos un instructivo con los nuevos números de contacto y los pasos a seguir para usar ' +
    'el portal. Es importante que lo lea.</p>' +
    '<p>Saludos,<br/>Equipo de Soporte — Solido Connecting Solutions<br/>SolidoCS, lo hacemos simple.</p>'
  );
}

async function main(): Promise<void> {
  const { send, pdf } = parseArgs(process.argv.slice(2));
  let exitCode = 0;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const contacts = app.get<Repository<Contact>>(getRepositoryToken(Contact));
    const mailboxes = app.get(MailboxesService);

    // 1) Destinatarios: todos los emails de contacto válidos, dedup por dirección
    //    (lower + trim). Si un email aparece en varios contactos, se envía una vez.
    const rows = await contacts
      .createQueryBuilder('c')
      .select('c.email', 'email')
      .where('c.email IS NOT NULL')
      .andWhere("c.email <> ''")
      .getRawMany<{ email: string }>();
    const seen = new Set<string>();
    const recipients: string[] = [];
    let skippedInvalid = 0;
    for (const r of rows) {
      const email = String(r.email || '').trim().toLowerCase();
      if (!email) continue;
      if (!isEmailValid(email)) {
        skippedInvalid++;
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push(email);
    }

    // 2) PDF adjunto (obligatorio para el envío real).
    const pdfPath = pdf ? pdf : DEFAULT_PDF_PATH;
    const pdfBuffer = fs.existsSync(pdfPath) ? fs.readFileSync(pdfPath) : null;

    console.log('=== Anuncio migración plataforma de soporte ===');
    console.log(`Asunto: ${SUBJECT}`);
    console.log(`Contactos con email: ${rows.length} | descartados por formato: ${skippedInvalid}`);

    // SMTP / remitente: se reusa la misma config del sistema (getSmtpConfig), que
    // prioriza enviar desde soporte@solidocs.com.ar.
    const smtp = await mailboxes.getSmtpConfig();
    console.log(`Remitente: ${smtp ? smtp.from : '(sin SMTP configurado)'}${smtp ? ` — ${smtp.host}:${smtp.port}` : ''}`);
    console.log(`PDF: ${pdfBuffer ? `${pdfPath} (${pdfBuffer.length} bytes)` : `NO ENCONTRADO en ${pdfPath} — el envío real requiere --pdf=`}`);
    console.log('');
    console.log(`Destinatarios únicos: ${recipients.length}`);
    console.log(`Muestra (primeros ${Math.min(PREVIEW_COUNT, recipients.length)}):`);
    recipients.slice(0, PREVIEW_COUNT).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));

    if (!send) {
      console.log('\n[DRY-RUN] No se envió ningún email. Para enviar de verdad usá el flag --send');
      return;
    }

    // Modo real: prerrequisitos estrictos.
    if (!pdfBuffer) {
      console.error('\n[ERROR] Sin PDF adjunto — abortando el envío real (usá --pdf=/ruta/a/instructivo....pdf)');
      exitCode = 1;
      return;
    }
    if (!smtp) {
      console.error('\n[ERROR] Sin configuración SMTP (casilla soporte@solidocs.com.ar) — abortando el envío real');
      exitCode = 1;
      return;
    }
    if (recipients.length === 0) {
      console.error('\n[ERROR] Sin destinatarios — abortando');
      exitCode = 1;
      return;
    }

    console.log('\n[!!!] MODO REAL: se van a enviar emails reales a todos los destinatarios únicos.');
    console.log(`[!!!] Total: ${recipients.length} — en lotes de ${BATCH_SIZE} con pausa de ${BATCH_PAUSE_MS / 1000}s entre lotes.`);

    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: smtp.requireTLS,
      auth: { user: smtp.user, pass: smtp.password },
    });
    const text = buildText();
    const html = buildHtml();
    const attachment = { filename: PDF_FILENAME, content: pdfBuffer, contentType: 'application/pdf' };

    let okCount = 0;
    const failed: Array<{ email: string; reason: string }> = [];
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch = recipients.slice(i, i + BATCH_SIZE);
      for (const to of batch) {
        try {
          await transport.sendMail({ from: smtp.from, to, subject: SUBJECT, text, html, attachments: [attachment] });
          okCount++;
          console.log(`OK ${to}`);
        } catch (e) {
          failed.push({ email: to, reason: (e as Error).message });
          console.error(`ERROR ${to} :: ${(e as Error).message}`);
        }
      }
      if (i + BATCH_SIZE < recipients.length) {
        console.log(`… pausa ${BATCH_PAUSE_MS / 1000}s antes del siguiente lote…`);
        await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }
    }
    await transport.close();

    console.log('\n=== Resumen final ===');
    console.log(`Destinatarios únicos: ${recipients.length}`);
    console.log(`Enviados OK: ${okCount}`);
    console.log(`Fallidos: ${failed.length}`);
    for (const f of failed) console.log(`  ${f.email} :: ${f.reason}`);
    if (failed.length > 0) console.log('\nLos fallidos se pueden reintentar manualmente con el mismo comando.');
  } catch (e) {
    console.error('FATAL', e);
    exitCode = 1;
  } finally {
    // Los `return` del try saltan todo lo posterior, así que el exit va acá.
    // app.close() se dispara fire-and-forget: puede colgarse por handles abiertos
    // (Redis/socket.io) al levantar todo el AppModule; el CLI termina igual por exit().
    app.close().catch(() => {});
    process.exit(exitCode);
  }
}

main();