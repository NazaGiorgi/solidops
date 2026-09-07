import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from '../../entities/customer.entity';
import { Contact } from '../../entities/contact.entity';
import { Site } from '../../entities/site.entity';
import { Contract } from '../../entities/contract.entity';
import { Ticket } from '../../entities/ticket.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { ContactsController } from './contacts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, Contact, Site, Contract, Ticket])],
  controllers: [CustomersController, ContactsController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
