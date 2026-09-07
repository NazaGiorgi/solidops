import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { TicketAttachment } from '../../entities/ticket-attachment.entity';
import { Sla } from '../../entities/sla.entity';
import { Customer } from '../../entities/customer.entity';
import { Contract } from '../../entities/contract.entity';
import { Contact } from '../../entities/contact.entity';
import { Technician } from '../../entities/technician.entity';
import { User } from '../../entities/user.entity';
import { SystemSettings } from '../../entities/system-settings.entity';
import { SavedView } from '../../entities/saved-view.entity';
import { WorkshopEquipment } from '../../entities/workshop-equipment.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketMergeService } from './ticket-merge.service';
import { SlaService } from './sla.service';
import { SavedViewsService } from './saved-views.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticket,
      TicketMessage,
      TicketAttachment,
      Sla,
      Customer,
      Contract,
      Contact,
      Technician,
      User,
      SystemSettings,
      SavedView,
      WorkshopEquipment,
      TicketGroup,
    ]),
    NotificationsModule,
    // forwardRef: TicketsService usa WhatsappService (envío saliente) y WhatsappService
    // usa TicketsService (upsert de tickets desde WhatsApp) — dependencia circular.
    forwardRef(() => WhatsappModule),
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketMergeService, SlaService, SavedViewsService],
  exports: [TicketsService, TicketMergeService, SlaService, SavedViewsService],
})
export class TicketsModule {}
