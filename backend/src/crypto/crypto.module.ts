import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

// Global crypto provider so any module can encrypt/decrypt credentials.
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
