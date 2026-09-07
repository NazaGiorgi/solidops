import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Contact } from '../../entities/contact.entity';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import { Customer } from '../../entities/customer.entity';
import { CustomerDomain } from '../../entities/customer-domain.entity';
import { PasswordResetToken } from '../../entities/password-reset-token.entity';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalAccountsController } from './portal-accounts.controller';
import { PortalGuard } from './portal.guard';
import { PasswordResetService } from '../../common/auth/password-reset.service';
import { RateLimitService } from '../../common/auth/rate-limit.service';
import { WorkshopModule } from '../workshop/workshop.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Contact, Ticket, TicketMessage, Customer, CustomerDomain, PasswordResetToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt.secret'),
      }),
    }),
    WorkshopModule,
  ],
  controllers: [PortalController, PortalAccountsController],
  providers: [PortalService, PortalGuard, PasswordResetService, RateLimitService],
  exports: [PortalService],
})
export class PortalModule {}
