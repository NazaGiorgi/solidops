require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule);
  const { MailboxWorker } = require('./dist/modules/mailboxes/mailbox-worker.service');
  const worker = app.get(MailboxWorker);
  console.log('Running pollAll manually...');
  await worker.pollAll();
  console.log('pollAll done');
  await app.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
