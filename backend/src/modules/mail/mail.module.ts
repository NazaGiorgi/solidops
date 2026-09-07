import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemSettings } from '../../entities/system-settings.entity';
import { MailboxesModule } from '../mailboxes/mailboxes.module';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [MailboxesModule, TypeOrmModule.forFeature([SystemSettings])],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
