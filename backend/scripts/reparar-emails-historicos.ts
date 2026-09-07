import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TicketMessage } from '../src/entities/ticket-message.entity';
import { TicketAttachment } from '../src/entities/ticket-attachment.entity';
import { InboundMailLog } from '../src/entities/inbound-mail-log.entity';
import { Mailbox } from '../src/entities/mailbox.entity';
import { CryptoService } from '../src/crypto/crypto.service';
import { StorageService } from '../src/storage/storage.service';
import { ImapFlow } from 'imapflow';
import { parseMime, normalizeCid, ParsedAttachment } from '../src/modules/mailboxes/mime.helper';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const messages = app.get<Repository<TicketMessage>>(getRepositoryToken(TicketMessage));
  const attachments = app.get<Repository<TicketAttachment>>(getRepositoryToken(TicketAttachment));
  const logs = app.get<Repository<InboundMailLog>>(getRepositoryToken(InboundMailLog));
  const mailboxes = app.get<Repository<Mailbox>>(getRepositoryToken(Mailbox));
  const crypto = app.get(CryptoService);
  const storage = app.get(StorageService);

  const candidate = await messages
    .createQueryBuilder('m')
    .where("m.body LIKE '%[cid:%' OR m.body LIKE '%=F3%' OR m.body LIKE '%=ED%' OR m.body LIKE '%=E1%' OR m.body LIKE '%=A1%' OR m.body LIKE '%=E9%' OR m.body LIKE '%=F1%'")
    .andWhere("m.channel = 'email'")
    .getMany();
  console.log('Mensajes a reparar:', candidate.length);
  const mb = await mailboxes.findOne({ where: { email: 'soporte@solidocs.com.ar' } });
  if (!mb) { console.log('No soporte'); await app.close(); process.exit(1); }
  const pass = crypto.decrypt(mb.imapPassword);
  const mkClient = () => new ImapFlow({ host: mb.imapHost, port: mb.imapPort, secure: mb.imapSsl, auth: { user: mb.imapUser, pass }, logger: false });
  const results: any[] = [];

  for (const msg of candidate) {
    try {
      const logRow = await logs
        .createQueryBuilder('l').where('l.entity_id = :tid', { tid: msg.ticketId }).andWhere('l.imap_uid IS NOT NULL')
        .orderBy('l.received_at', 'DESC').getOne();
      // Si no hay fila con uid, intentar por message_id (cualquier mailbox).
      const anyLog = logRow ?? await logs
        .createQueryBuilder('l').where('l.entity_id = :tid', { tid: msg.ticketId })
        .orderBy('l.received_at', 'DESC').getOne();
      if (!anyLog && !logRow) { results.push({ msgId: msg.id, ticketId: msg.ticketId, estado: 'SIN_FUENTE_BD' }); console.log('SIN_FUENTE_BD ' + msg.id); continue; }
      const client = mkClient();
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      let raw: Buffer | null = null; let uid: number | null = null;
      try {
        const uidToFetch = logRow ? logRow.imapUid! : null;
        if (uidToFetch) {
          for await (const f of client.fetch({ uid: uidToFetch }, { uid: true, source: true }, { uid: true })) { raw = f.source as any; uid = f.uid as any; break; }
        } else if (anyLog?.messageId) {
          const found = await client.search({ header: { 'message-id': anyLog.messageId } }, { uid: true });
          const uids = Array.isArray(found) ? found : [];
          if (uids.length) {
            for await (const f of client.fetch({ uid: uids }, { uid: true, source: true }, { uid: true })) { raw = f.source as any; uid = f.uid as any; break; }
          }
        }
      } finally { await lock.release(); await client.logout().catch(() => client.close()); }
      if (!raw) { results.push({ msgId: msg.id, ticketId: msg.ticketId, uid, estado: 'SIN_FUENTE_IMAP' }); console.log('SIN_FUENTE_IMAP ' + msg.id); continue; }

      const parsed = await parseMime(raw);
      let html = parsed.html ? parsed.html : null;
      const atts: ParsedAttachment[] = [];
      if (html && parsed.images.size) {
        for (const [cid, img] of parsed.images) {
          const ext = (img.mimeType.split('/')[1] || 'img').replace('jpeg', 'jpg');
          const name = `inline-${cid.slice(0, 8)}.${ext}`;
          atts.push({ cid, filename: name, mimeType: img.mimeType, data: img.data, sizeBytes: img.data.length, disposition: 'inline' });
          const re = /src\s*=\s*["']cid:([^"']+)["']/gi;
          html = html.replace(re, (m, mcid) => (normalizeCid(mcid) === normalizeCid(cid) ? `src="__CIDPLACE__"` : m));
        }
      }
      for (const a of parsed.attachments) {
        const name = a.filename || `adj-${Math.random().toString(36).slice(2, 8)}`;
        atts.push({ cid: a.cid, filename: name, mimeType: a.mimeType, data: a.data, sizeBytes: a.sizeBytes, disposition: a.disposition });
      }
      const urlByCid = new Map<string, string>();
      for (const a of atts) { const { url } = await storage.putObject(a.data, a.filename!, a.mimeType, 'tickets'); urlByCid.set(a.filename!, url); }
      if (html) for (const a of atts) if (a.disposition === 'inline' && a.cid) html = html.replace(/__CIDPLACE__/g, urlByCid.get(a.filename!) || '');

      msg.body = parsed.text.replace(/\r\n/g, '\n');
      msg.bodyHtml = html;
      await messages.save(msg);
      await attachments.delete({ ticketMessageId: msg.id });
      for (const a of atts) await attachments.save(attachments.create({ ticketMessageId: msg.id, fileUrl: urlByCid.get(a.filename!) || '', filename: a.filename!, mimeType: a.mimeType, sizeBytes: a.sizeBytes }));
      results.push({ msgId: msg.id, ticketId: msg.ticketId, uid, estado: 'REPARADO', images: parsed.images.size, attachments: atts.length });
      console.log(`REPARADO ${msg.id} uid=${uid} images=${parsed.images.size} atts=${atts.length} textL=${parsed.text.length}`);
    } catch (e) { results.push({ msgId: msg.id, ticketId: msg.ticketId, estado: 'ERROR', error: (e as Error).message }); console.log('ERROR ' + msg.id + ' :: ' + (e as Error).message); }
  }

  const logFile = path.join(process.cwd(), 'debug', 'repair-log', 'repair-results.json');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, JSON.stringify(results, null, 2));
  const rep = results.filter((r) => r.estado === 'REPARADO').length;
  console.log('\nLog: ' + logFile);
  console.log(`Resultado: ${rep} reparados / ${results.length} procesados`);
  await app.close();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
