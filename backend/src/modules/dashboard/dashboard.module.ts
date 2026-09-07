import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { Task } from '../../entities/task.entity';
import { Appointment } from '../../entities/appointment.entity';
import { Technician } from '../../entities/technician.entity';
import { User } from '../../entities/user.entity';
import { Contract } from '../../entities/contract.entity';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticket,
      Task,
      Appointment,
      Technician,
      User,
      Contract,
    ]),
    TicketsModule,
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
