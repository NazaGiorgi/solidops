import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { publicTicketNumber } from '../../common/utils/ticket-number.util';
import { TicketsService } from '../tickets/tickets.service';
import { AiUsageService } from './ai-usage.service';
import {
  AiDiagnosticsProvider,
  AiProvider,
  CHAT_PROVIDER,
  ChatMessage,
  EMBED_PROVIDER,
} from './ai.types';
import {
  cleanTicketText,
  cosineSimilarity,
  extractJsonObject,
  firstValues,
  truncateForContext,
} from './ai-text.util';

export interface MetricsView {
  tokensIn: number;
  tokensOut: number;
  seconds: number;
  tokensPerSecond: number | null;
  loadMs: number;
  provider: string;
  model: string;
}

export interface ChatView {
  response: string;
  metrics: MetricsView;
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(CHAT_PROVIDER) private readonly chatProvider: AiProvider,
    @Inject(EMBED_PROVIDER) private readonly embedProvider: AiProvider,
    private readonly config: ConfigService,
    private readonly usage: AiUsageService,
    private readonly tickets: TicketsService,
    @InjectConnection() private readonly dataSource: DataSource,
  ) {}

  // extendemos pgvector con SQL crudo, igual que el patrón de search_vector en
  // notas/documentos. Ninguna entidad TypeORM declara columnas `vector`.
  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS vector');
      this.logger.log('Extensión pgvector verificada (DDL crudo idempotente)');
    } catch (e) {
      this.logger.warn(`pgvector no disponible (no bloquea el arranque): ${(e as Error).message}`);
    }
  }

  private cfg<T>(key: string, fallback: T): T {
    const value = this.config.get<T>(key);
    return value === undefined || value === null ? fallback : value;
  }

  private ensureEnabled(): void {
    if (!this.cfg('ai.enabled', false)) {
      throw new ServiceUnavailableException(
        'IA desactivada (AI_ENABLED=false). El resto del sistema sigue funcionando.',
      );
    }
  }

  private unavailable(e: unknown): ServiceUnavailableException {
    const detail = (e as Error)?.message || 'sin detalle';
    if (this.chatProvider.name === 'ollama' || this.embedProvider.name === 'ollama') {
      return new ServiceUnavailableException(`Ollama no disponible: ${detail}`);
    }
    return new ServiceUnavailableException(`Proveedor de IA no disponible: ${detail}`);
  }

  features() {
    return {
      aiEnabled: this.cfg('ai.enabled', false),
      aiLabEnabled: this.cfg('ai.labEnabled', false),
      chatProvider: this.chatProvider.name,
      embedProvider: this.embedProvider.name,
    };
  }

  async health() {
    this.ensureEnabled();
    const started = Date.now();
    let reachable = false;
    let version: string | null = null;
    let modelsAvailable: string[] = [];
    let modelsLoaded: string[] = [];
    let diagnosticsError: string | null = null;

    const diagnostic = [this.chatProvider, this.embedProvider].find(
      (p): p is AiDiagnosticsProvider => typeof (p as AiDiagnosticsProvider).getVersion === 'function',
    );

    if (diagnostic) {
      try {
        version = await diagnostic.getVersion();
        reachable = version !== null;
      } catch (e) {
        diagnosticsError = (e as Error).message;
      }
      try {
        modelsAvailable = await diagnostic.listModels();
      } catch {
        /* la lista de modelos es informativa */
      }
      try {
        modelsLoaded = await diagnostic.listLoaded();
      } catch {
        /* la lista de modelos cargados es informativa */
      }
    } else {
      reachable = true;
      version = 'mock (sin red)';
      modelsAvailable = [
        this.cfg('ai.modelFast', 'qwen3:4b'),
        this.cfg('ai.embedModel', 'bge-m3'),
      ];
      modelsLoaded = [...modelsAvailable];
    }

    if (!reachable) {
      // Los endpoints de IA devuelven 503 cuando Ollama no responde. El front
      // muestra este mensaje en el cartel de error del laboratorio.
      throw this.unavailable(new Error(diagnosticsError || 'sin respuesta'));
    }

    const chatModel = this.cfg('ai.modelFast', 'qwen3:4b');
    const embedModel = this.cfg('ai.embedModel', 'bge-m3');
    return {
      enabled: this.cfg('ai.enabled', false),
      provider: { chat: this.chatProvider.name, embed: this.embedProvider.name },
      ollamaUrl: this.cfg('ai.ollamaUrl', ''),
      reachable,
      version,
      modelsAvailable,
      modelsLoaded,
      chatModelOk: modelsAvailable.some((m) => m === chatModel || m.startsWith(`${chatModel}:`)),
      embedModelOk: modelsAvailable.some((m) => m === embedModel || m.startsWith(`${embedModel}:`)),
      latencyMs: Date.now() - started,
      diagnosticsError,
    };
  }

  async chat(
    prompt: string,
    user: AuthenticatedUser,
    opts: { model?: string; feature?: string } = {},
  ): Promise<ChatView> {
    this.ensureEnabled();
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Respondé siempre en español, de forma breve y concreta.' },
      { role: 'user', content: prompt },
    ];
    return this.performChat(messages, opts.model, user.id, opts.feature || 'lab_chat');
  }

  private async performChat(
    messages: ChatMessage[],
    modelOverride: string | undefined,
    userId: string | null,
    feature: string,
  ): Promise<ChatView> {
    const model = modelOverride || this.cfg('ai.modelFast', 'qwen3:4b');
    try {
      const result = await this.chatProvider.chat(messages, { model });
      await this.usage.record({
        userId,
        feature,
        provider: result.provider,
        model: result.model,
        tokensIn: result.usage.promptTokens,
        tokensOut: result.usage.completionTokens,
        durationMs: result.usage.totalMs,
        tokensPerSecond: result.usage.tokensPerSecond,
        ok: true,
      });
      return {
        response: result.text,
        metrics: {
          tokensIn: result.usage.promptTokens,
          tokensOut: result.usage.completionTokens,
          seconds: Number((result.usage.totalMs / 1000).toFixed(2)),
          tokensPerSecond: result.usage.tokensPerSecond,
          loadMs: Number(result.usage.loadMs.toFixed(1)),
          provider: result.provider,
          model: result.model,
        },
      };
    } catch (e) {
      await this.usage.record({
        userId,
        feature,
        provider: this.chatProvider.name,
        model,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        tokensPerSecond: null,
        ok: false,
        errorMessage: (e as Error).message,
      });
      throw this.unavailable(e);
    }
  }

  async embed(text: string, user: AuthenticatedUser) {
    this.ensureEnabled();
    const expected = this.cfg('ai.embedDim', 1024);
    try {
      const result = await this.embedProvider.embed([text]);
      const dimension = result.dimension || result.embeddings[0]?.length || 0;
      if (dimension !== expected) {
        throw new Error(
          `Dimensión de embedding ${dimension} != AI_EMBED_DIM=${expected}. Revisá el modelo configurado.`,
        );
      }
      await this.usage.record({
        userId: user.id,
        feature: 'lab_embed',
        provider: result.provider,
        model: result.model,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: result.durationMs,
        tokensPerSecond: null,
        ok: true,
      });
      return {
        dimension,
        first5: firstValues(result.embeddings[0] || []),
        ms: result.durationMs,
        provider: result.provider,
        model: result.model,
      };
    } catch (e) {
      await this.usage.record({
        userId: user.id,
        feature: 'lab_embed',
        provider: this.embedProvider.name,
        model: this.cfg('ai.embedModel', 'bge-m3'),
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        tokensPerSecond: null,
        ok: false,
        errorMessage: (e as Error).message,
      });
      throw this.unavailable(e);
    }
  }

  async similarity(a: string, b: string, user: AuthenticatedUser) {
    this.ensureEnabled();
    const expected = this.cfg('ai.embedDim', 1024);
    try {
      const result = await this.embedProvider.embed([a, b]);
      const dimension = result.dimension || result.embeddings[0]?.length || 0;
      if (dimension !== expected) {
        throw new Error(
          `Dimensión de embedding ${dimension} != AI_EMBED_DIM=${expected}. Revisá el modelo configurado.`,
        );
      }
      const value = cosineSimilarity(result.embeddings[0], result.embeddings[1]);
      await this.usage.record({
        userId: user.id,
        feature: 'lab_similarity',
        provider: result.provider,
        model: result.model,
        tokensIn: 0,
        tokensOut: 0,
        durationMs: result.durationMs,
        tokensPerSecond: null,
        ok: true,
      });
      return { similarity: Number(value.toFixed(4)), percent: Number((value * 100).toFixed(1)), dimension, ms: result.durationMs };
    } catch (e) {
      await this.usage.record({
        userId: user.id,
        feature: 'lab_similarity',
        provider: this.embedProvider.name,
        model: this.cfg('ai.embedModel', 'bge-m3'),
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 0,
        tokensPerSecond: null,
        ok: false,
        errorMessage: (e as Error).message,
      });
      throw this.unavailable(e);
    }
  }

  private async ticketContext(id: string, actor: AuthenticatedUser) {
    const ticket = await this.tickets.findOne(id, actor);
    const messageBodies = [
      ...(ticket.messages || []),
      ...(ticket.mergedMessages || []),
    ]
      .map((m) => cleanTicketText(m.body))
      .filter((body) => body.length > 0);

    const parts = [
      `Título: ${ticket.title ?? ''}`,
      `Descripción: ${cleanTicketText(ticket.description)}`,
      `Estado real: ${ticket.status ?? ''} | Prioridad real: ${ticket.priority ?? ''} | Categoría real: ${ticket.category ?? ''}`,
      ...messageBodies.map((body, i) => `Mensaje ${i + 1}:\n${body}`),
    ];
    return {
      ticket,
      text: truncateForContext(parts.join('\n\n'), this.cfg('ai.numCtx', 8192)),
    };
  }

  private ticketSnapshot(ticket: Awaited<ReturnType<TicketsService['findOne']>>) {
    return {
      id: ticket.id,
      numero: publicTicketNumber(ticket.ticketNumber, ticket.createdAt),
      titulo: ticket.title,
      estado: ticket.status,
      prioridad: ticket.priority,
      categoria: ticket.category,
      tecnico: ticket.technician?.user?.name ?? null,
      mensajes: (ticket.messages?.length ?? 0) + (ticket.mergedMessages?.length ?? 0),
    };
  }

  async summarizeTicket(id: string, user: AuthenticatedUser) {
    this.ensureEnabled();
    const { ticket, text } = await this.ticketContext(id, user);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Sos asistente de soporte. Respondé SOLO un JSON válido con las claves ' +
          'pedido, probado, falta y cliente, en español. No inventes datos que no estén en el ticket.',
      },
      { role: 'user', content: `Resumí este ticket:\n\n${text}` },
    ];
    const result = await this.performChat(
      messages,
      this.cfg('ai.modelSmart', this.cfg('ai.modelFast', 'qwen3:4b')),
      user.id,
      'lab_summarize',
    );
    const parsed = extractJsonObject(result.response);
    const summary = parsed
      ? {
          pedido: String(parsed.pedido ?? ''),
          probado: String(parsed.probado ?? ''),
          falta: String(parsed.falta ?? ''),
          cliente: String(parsed.cliente ?? ''),
        }
      : {
          pedido: result.response.slice(0, 500),
          probado: '',
          falta: '',
          cliente: '',
        };
    // No se guarda nada: este endpoint sólo lee y devuelve el resultado.
    return { ticket: this.ticketSnapshot(ticket), summary, metrics: result.metrics };
  }

  async classifyTicket(id: string, user: AuthenticatedUser) {
    this.ensureEnabled();
    const { ticket, text } = await this.ticketContext(id, user);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Clasificá tickets de soporte. Respondé SOLO un JSON válido con las claves ' +
          'categoria, prioridad, especialidad, duracionEstimada y animo, en español.',
      },
      { role: 'user', content: `Clasificá este ticket:\n\n${text}` },
    ];
    const result = await this.performChat(
      messages,
      this.cfg('ai.modelSmart', this.cfg('ai.modelFast', 'qwen3:4b')),
      user.id,
      'lab_classify',
    );
    const parsed = extractJsonObject(result.response);
    return {
      ticket: this.ticketSnapshot(ticket),
      ai: parsed,
      raw: parsed ? null : result.response.slice(0, 600),
      metrics: result.metrics,
    };
  }

  async benchmark(user: AuthenticatedUser) {
    this.ensureEnabled();
    const chatPrompts = [
      '¿Qué es un switch de red? Una frase.',
      '¿Para qué sirve un firewall? Una frase.',
      '¿Qué es una IP fija? Una frase.',
      '¿Cómo se llama el cable de red más común? Una frase.',
      '¿Qué hace un router? Una frase.',
    ];
    const embedTexts = [
      'impresora del laboratorio no imprime',
      'la impresora no sale nada por la impresora',
      'el equipo no enciende',
      'fallo de conexión a internet',
      'no puedo abrir el sistema',
    ];

    const chatSeconds: number[] = [];
    const tps: number[] = [];
    const chatDetails: Array<{ prompt: string; seconds: number; tokensPerSecond: number | null }> = [];
    for (const prompt of chatPrompts) {
      const r = await this.chat(prompt, user, { feature: 'lab_benchmark' });
      chatSeconds.push(r.metrics.seconds);
      if (r.metrics.tokensPerSecond !== null) tps.push(r.metrics.tokensPerSecond);
      chatDetails.push({
        prompt,
        seconds: r.metrics.seconds,
        tokensPerSecond: r.metrics.tokensPerSecond,
      });
    }

    const embedSeconds: number[] = [];
    for (const text of embedTexts) {
      const r = await this.embed(text, user);
      embedSeconds.push(Number((r.ms / 1000).toFixed(2)));
    }

    const stats = (values: number[]) =>
      values.length
        ? {
            average: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)),
            min: Number(Math.min(...values).toFixed(2)),
            max: Number(Math.max(...values).toFixed(2)),
          }
        : { average: 0, min: 0, max: 0 };

    return {
      chat: {
        seconds: stats(chatSeconds),
        tokensPerSecond: stats(tps),
        details: chatDetails,
      },
      embeddings: { seconds: stats(embedSeconds) },
      provider: { chat: this.chatProvider.name, embed: this.embedProvider.name },
      model: {
        chat: this.cfg('ai.modelFast', 'qwen3:4b'),
        embed: this.cfg('ai.embedModel', 'bge-m3'),
      },
    };
  }
}
