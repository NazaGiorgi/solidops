import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import dbConfig from './config/database.config';

import { StorageModule } from './storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { TechniciansModule } from './modules/technicians/technicians.module';
import { CustomersModule } from './modules/customers/customers.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { EmailModule } from './modules/email/email.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuditModule } from './modules/audit/audit.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/seed.module';
import { CryptoModule } from './crypto/crypto.module';
import { MailboxesModule } from './modules/mailboxes/mailboxes.module';
import { MailModule } from './modules/mail/mail.module';
import { PortalModule } from './modules/portal/portal.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminModule } from './modules/admin/admin.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { NotesModule } from './modules/notes/notes.module';
import { WorkshopModule } from './modules/workshop/workshop.module';
import { TicketGroupsModule } from './modules/ticket-groups/ticket-groups.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';

// Entities auto-loaded by TypeORM via autoLoadEntities + glob in dbConfig.

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRoot(dbConfig()),
    ScheduleModule.forRoot(),
    StorageModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    TechniciansModule,
    CustomersModule,
    TicketsModule,
    EmailModule,
    CalendarModule,
    DashboardModule,
    NotificationsModule,
    JobsModule,
    HealthModule,
    DatabaseModule,
    CryptoModule,
    MailboxesModule,
    MailModule,
    PortalModule,
    ReportsModule,
    AdminModule,
    DocumentsModule,
NotesModule,
WorkshopModule,
TicketGroupsModule,
WhatsappModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
