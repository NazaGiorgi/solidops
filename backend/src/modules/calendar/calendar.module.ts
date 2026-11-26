import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../../entities/appointment.entity';
import { AppointmentTechnician } from '../../entities/appointment-technician.entity';
import { Task } from '../../entities/task.entity';
import { User } from '../../entities/user.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Customer } from '../../entities/customer.entity';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Appointment, AppointmentTechnician, Task, User, Ticket, Customer,
    ]),
    NotificationsModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
