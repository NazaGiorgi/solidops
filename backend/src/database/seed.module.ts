import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../entities/role.entity';
import { User } from '../entities/user.entity';
import { Technician } from '../entities/technician.entity';
import { Customer } from '../entities/customer.entity';
import { Contract } from '../entities/contract.entity';
import { Contact } from '../entities/contact.entity';
import { Site } from '../entities/site.entity';
import { Ticket } from '../entities/ticket.entity';
import { TicketMessage } from '../entities/ticket-message.entity';
import { TicketAttachment } from '../entities/ticket-attachment.entity';
import { Mailbox } from '../entities/mailbox.entity';
import { SystemSettings } from '../entities/system-settings.entity';
import { SeedService } from './seeds/seed.service';
import { ZammadImportService } from './import/zammad-import.service';
import { ZammadMetaImportService } from './import/zammad-meta-import.service';
import { TicketImportService } from './import/ticket-import.service';
import { StorageModule } from '../storage/storage.module';

// Self-contained module for the seeder + Zammad importer. Declares EVERY
// repository these inject, so they never depend on which other module happens
// to re-export TypeOrmModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      User,
      Technician,
      Customer,
      Contract,
      Contact,
      Site,
      Ticket,
      TicketMessage,
      TicketAttachment,
      Mailbox,
      SystemSettings,
    ]),
    StorageModule,
  ],
  providers: [SeedService, ZammadImportService, ZammadMetaImportService, TicketImportService],
  exports: [SeedService, ZammadImportService, ZammadMetaImportService, TicketImportService],
})
export class DatabaseModule {}
