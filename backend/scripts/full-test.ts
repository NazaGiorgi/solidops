import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Contact } from '../src/entities/contact.entity';
import { EmailService } from '../src/modules/email/email.service';

(async () => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log','error','warn'] });
  const email = app.get(EmailService);
  const contacts = app.get<Repository<Contact>>(getRepositoryToken(Contact));
  const c = await contacts.findOne({ where: { email: 'iupitoys@gmail.com' } });
  if (!c) { console.log('NO CONTACTO'); process.exit(1); }
  const res = await email.ingest({ fromEmail: 'iupitoys@gmail.com', subject: 'PRUEBA FULL2 ' + Date.now(), body: 'test', messageId: '<full2-' + Date.now() + '@solidocs>' });
  console.log('RESULT:', JSON.stringify(res));
  await new Promise(r => setTimeout(r, 3000));
  await app.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
