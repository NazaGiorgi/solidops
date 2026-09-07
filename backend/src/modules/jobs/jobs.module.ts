import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { Technician } from '../../entities/technician.entity';
import { Contract } from '../../entities/contract.entity';
import { Appointment } from '../../entities/appointment.entity';
import { JobsService } from './jobs.service';
import { TicketsModule } from '../tickets/tickets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CalendarModule } from '../calendar/calendar.module';
import { MailModule } from '../mail/mail.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Technician, Contract, Appointment]),
    TicketsModule,
    NotificationsModule,
    CalendarModule,
    MailModule,
    WhatsappModule,
  ],
  providers: [JobsService],
})
export class JobsModule {}
