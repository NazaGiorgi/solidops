import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ticket } from '../../entities/ticket.entity';
import { Technician } from '../../entities/technician.entity';
import { Contract } from '../../entities/contract.entity';
import { ReportsController } from './reports.controller';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, Technician, Contract]),
    TicketsModule,
  ],
  controllers: [ReportsController],
})
export class ReportsModule {}
