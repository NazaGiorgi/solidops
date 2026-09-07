import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkshopEquipment } from '../../entities/workshop-equipment.entity';
import { PriceListItem } from '../../entities/price-list-item.entity';
import { WorkshopQuote } from '../../entities/workshop-quote.entity';
import { WorkshopQuoteItem } from '../../entities/workshop-quote-item.entity';
import { Ticket } from '../../entities/ticket.entity';
import { Customer } from '../../entities/customer.entity';
import { Contact } from '../../entities/contact.entity';
import { Site } from '../../entities/site.entity';
import { TicketGroup } from '../../entities/ticket-group.entity';
import { AuditModule } from '../audit/audit.module';
import { WorkshopService } from './workshop.service';
import { WorkshopController } from './workshop.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkshopEquipment,
      PriceListItem,
      WorkshopQuote,
      WorkshopQuoteItem,
      Ticket,
      Customer,
      Contact,
      Site,
      TicketGroup,
    ]),
    AuditModule,
  ],
  controllers: [WorkshopController],
  providers: [WorkshopService],
  exports: [WorkshopService],
})
export class WorkshopModule {}
