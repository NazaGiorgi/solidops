import { AppModule } from './src/app.module';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Mailbox } from './src/entities/mailbox.entity';
import { CryptoService } from './src/crypto/crypto.service';
import { ImapFlow } from 'imapflow';
import * as fs from 'fs';
import * as path from 'path';

const MID = 'RIUP284MB4008A6A02FE679529E31BB83ACB72@RIUP284MB4008.BRAP284.PROD.OUTLOOK.COM';

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const mailboxes = app.get<Repository<Mailbox>>(getRepositoryToken(Mailbox));
  const crypto = app.get(CryptoService);
  const mb = await mailboxes.findOne({ where: { email: 'soporte@solidocs.com.ar' } });
  if (!mb) { console.log('NO SOPORTE'); process.exit(1); }
  const pass = crypto.decrypt(mb.imapPassword);
  const client = new ImapFlow({ host: mb.imapHost, port: mb.imapPort, secure: mb.imapSsl, auth: { user: mb.imapUser, pass }, logger: false });
  let lock: any = null;
  try {
    await client.connect();
    console.log('CONECTADO OK');
    lock = await client.getMailboxLock('INBOX');
    // Búsqueda por UID conocido (37093) y luego buscar el message-id en el envelope.
    const uids = [37093];
    console.log('Buscar UID 37093...');
    let found: any = null;
    for await (const msg of client.fetch({ uid: uids }, { uid: true, source: true, envelope: true, bodyStructure: false }, { uid: true })) { found = msg; break; }
    if (found) {
      const src = found.source as Buffer | undefined;
      console.log('UID=' + found.uid + ' source.length=' + src?.length);
      const env = (found.envelope as any) || {};
      console.log('Subject=' + JSON.stringify(env.subject) + ' MessageId=' + JSON.stringify(env.messageId));
      const raw = src?.toString('latin1') || '';
      console.log('Contiene message-id de OUTLOOK: ' + raw.toLowerCase().includes('riup284mb4008a6a02fe679529e31bb83acb72'));
      console.log('--- primeros 800 ---'); console.log(raw.substr(0, 800)); console.log('--- fin ---');
      const dir = path.join(process.cwd(), 'debug', 'imap-raw');
      fs.mkdirSync(dir, { recursive: true });
      const fn = path.join(dir, 'uid-37093.eml');
      fs.writeFileSync(fn, src as any);
      console.log('GUARDADO: ' + fn);
    } else console.log('NO FOUND UID 37093');
  } catch (e) { console.log('ERROR IMAP: ' + ((e as Error).message || e)); }
  finally {
    try { if (lock) await lock.release(); } catch {}
    try { await client.logout(); } catch { client.close(); }
    await app.close();
    console.log('CLOSED');
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
