import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Mailbox } from '../../entities/mailbox.entity';
import { Asset } from '../../entities/asset.entity';
import { Document } from '../../entities/document.entity';
import { MailboxRule } from '../../entities/mailbox-rule.entity';
import { Customer } from '../../entities/customer.entity';
import { InboundMailLog } from '../../entities/inbound-mail-log.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { MailboxesService } from './mailboxes.service';
import { MailboxesController } from './mailboxes.controller';
import { MailboxRulesService } from './mailbox-rules.service';
import { MailboxRulesController } from './mailbox-rules.controller';
import { ImapService } from './imap.service';
import { MailboxWorker } from './mailbox-worker.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Mailbox,
      Asset,
      Document,
      MailboxRule,
      Customer,
      InboundMailLog,
      TicketGroup,
    ]),
    EmailModule,
  ],
  controllers: [MailboxesController, MailboxRulesController],
  providers: [MailboxesService, MailboxRulesService, ImapService, MailboxWorker],
  exports: [MailboxesService, MailboxRulesService, ImapService],
})
export class MailboxesModule {}
