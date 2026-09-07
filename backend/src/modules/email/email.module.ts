import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { Customer } from '../../entities/customer.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { TicketAttachment } from '../../entities/ticket-attachment.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Customer, TicketMessage, TicketAttachment, SystemSettings]),
    TicketsModule,
  ],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
