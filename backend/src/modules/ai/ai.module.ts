import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiUsageLog } from '../../entities/ai-usage-log.entity';
import { TicketsModule } from '../tickets/tickets.module';
import { AiController } from './ai.controller';
import { AiTicketsController } from './ai-tickets.controller';
import { AiService } from './ai.service';
import { AiTicketsService } from './ai-tickets.service';
import { AiUsageService } from './ai-usage.service';
import { AiProvider, CHAT_PROVIDER, EMBED_PROVIDER } from './ai.types';
import { MockAiProvider } from './providers/mock.provider';
import { OllamaAiProvider } from './providers/ollama.provider';

// Fábrica de proveedores: agregar openai/anthropic acá no toca servicios ni
// controladores. Cada variable (chat/embed) se resuelve por separado.
function buildProvider(config: ConfigService, kind: string | undefined): AiProvider {
  switch ((kind || 'ollama').toLowerCase()) {
    case 'mock':
      return new MockAiProvider(config);
    case 'ollama':
    default:
      return new OllamaAiProvider(config);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([AiUsageLog]), TicketsModule],
  controllers: [AiController, AiTicketsController],
  providers: [
    AiService,
    AiTicketsService,
    AiUsageService,
    {
      provide: CHAT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildProvider(config, config.get<string>('ai.chatProvider')),
    },
    {
      provide: EMBED_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildProvider(config, config.get<string>('ai.embedProvider')),
    },
  ],
  exports: [AiService],
})
export class AiModule {}
