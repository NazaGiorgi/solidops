import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsageLog } from '../../entities/ai-usage-log.entity';

export interface RecordUsageInput {
  userId: string | null;
  feature: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  tokensPerSecond: number | null;
  ok: boolean;
  errorMessage?: string | null;
}

// Sólo métricas. No existe campo para prompts ni respuestas, a propósito.
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectRepository(AiUsageLog) private readonly usage: Repository<AiUsageLog>,
  ) {}

  async record(input: RecordUsageInput): Promise<void> {
    try {
      await this.usage.save(
        this.usage.create({
          userId: input.userId,
          feature: input.feature,
          provider: input.provider,
          model: input.model,
          tokensIn: Math.max(0, Math.round(input.tokensIn)),
          tokensOut: Math.max(0, Math.round(input.tokensOut)),
          durationMs: Math.max(0, Math.round(input.durationMs)),
          tokensPerSecond: input.tokensPerSecond,
          ok: input.ok,
          errorMessage: input.errorMessage?.slice(0, 500) ?? null,
        }),
      );
    } catch (e) {
      // La auditoría no puede romper el laboratorio ni el resto del sistema.
      this.logger.warn(`No se pudo registrar ai_usage_log: ${(e as Error).message}`);
    }
  }
}
