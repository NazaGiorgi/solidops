import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { Ticket } from '../../entities/ticket.entity';
import { MailboxRule } from '../../entities/mailbox-rule.entity';
import { TicketGroupsService } from './ticket-groups.service';
import { TicketGroupsController } from './ticket-groups.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TicketGroup, Ticket, MailboxRule])],
  controllers: [TicketGroupsController],
  providers: [TicketGroupsService],
  exports: [TicketGroupsService],
})
export class TicketGroupsModule {}
