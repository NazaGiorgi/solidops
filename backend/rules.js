require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
(async () => {
  const app = await NestFactory.createApplicationContext(AppModule);
  const { MailboxRulesService } = require('./dist/modules/mailboxes/mailbox-rules.service');
  const svc = app.get(MailboxRulesService);

  // Case 1: subject contains asset name -> should match rule (document) + auto-match asset
  const mail1 = { fromEmail: 'backup@x.com', subject: 'Backup Router Mikrotik 1 completado', body: 'ok' };
  const d1 = await svc.evaluate('soporte@solidocs.com.ar', mail1);
  console.log('EVALUATE:', JSON.stringify({ dest: d1.destination, matched: !!d1.matchedRuleId, customerId: d1.customerId }));
  const doc1 = await svc.routeToDocument(mail1, d1.customerId);
  console.log('DOC ROUTE: id=' + doc1.id + ' customerId=' + doc1.customerId + ' assetId=' + doc1.assetId + ' status=' + doc1.status + ' (asset autos-matcheado?) ' + (doc1.assetId ? 'SI' : 'NO'));

  // Case 2: subject WITHOUT asset name -> rule matches (backup) but no asset -> sin_clasificar
  const mail2 = { fromEmail: 'foo@x.com', subject: 'Backup sin nombre', body: 'x' };
  const d2 = await svc.evaluate('soporte@solidocs.com.ar', mail2);
  const doc2 = await svc.routeToDocument(mail2, d2.customerId);
  console.log('DOC ROUTE2: customerId=' + doc2.customerId + ' assetId=' + doc2.assetId + ' status=' + doc2.status + ' (por sin match -> ' + (doc2.assetId ? 'con asset' : 'sin clasificar') + ')');

  await app.close();
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
