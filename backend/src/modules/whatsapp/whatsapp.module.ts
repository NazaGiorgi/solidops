import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contact } from '../../entities/contact.entity';
import { Customer } from '../../entities/customer.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { Technician } from '../../entities/technician.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { TicketsModule } from '../tickets/tickets.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Customer, TicketGroup, Technician, SystemSettings]),
    // forwardRef: TicketsService usa WhatsappService (envío saliente) y WhatsappService
    // usa TicketsService (upsert de tickets desde WhatsApp) — dependencia circular.
    forwardRef(() => TicketsModule),
    NotificationsModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
