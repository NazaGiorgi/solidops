import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import { AiDiagnosticsProvider, AiProvider, ChatResult, EmbedResult } from './ai.types';
import { TicketsService } from '../tickets/tickets.service';

const user = { id: 'user-1', role: 'Administrador' } as never;

function config(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    'ai.enabled': true,
    'ai.labEnabled': true,
    'ai.modelFast': 'qwen3:4b',
    'ai.modelSmart': 'qwen3:4b',
    'ai.embedModel': 'bge-m3',
    'ai.embedDim': 3,
    'ai.numCtx': 8192,
    'ai.ollamaUrl': 'http://ollama:11434',
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function chatProvider(result?: Partial<ChatResult>, error?: Error): AiProvider {
  return {
    name: 'mock',
    chat: jest.fn(async () => {
      if (error) throw error;
      return {
        text: 'respuesta',
        usage: {
          promptTokens: 4,
          completionTokens: 8,
          loadMs: 12,
          totalMs: 1000,
          tokensPerSecond: 8,
        },
        provider: 'mock',
        model: 'qwen3:4b',
        ...result,
      } as ChatResult;
    }),
    embed: jest.fn(async () => ({}) as EmbedResult),
  };
}

function embedProvider(dimension: number, vectors?: number[][]): AiProvider {
  return {
    name: 'mock',
    chat: jest.fn(async () => ({}) as ChatResult),
    embed: jest.fn(async () => ({
      embeddings: vectors ?? [[1, 0, 0], [0.9, 0.1, 0]],
      dimension,
      durationMs: 25,
      provider: 'mock',
      model: 'bge-m3',
    })),
  };
}

function build(
  chat: AiProvider,
  embed: AiProvider,
  cfg = config(),
  recorded: Array<Record<string, unknown>> = [],
) {
  const usage = {
    record: jest.fn(async (input: Record<string, unknown>) => {
      recorded.push(input);
    }),
  } as unknown as AiUsageService;
  const dataSource = { query: jest.fn(async () => []) } as unknown as DataSource;
  const service = new AiService(
    chat,
    embed,
    cfg,
    usage,
    {} as TicketsService,
    dataSource,
  );
  return { service, usage, dataSource, recorded };
}

describe('AiService', () => {
  it('onModuleInit crea pgvector con SQL crudo', async () => {
    const { service, dataSource } = build(chatProvider(), embedProvider(3));
    await service.onModuleInit();
    expect(dataSource.query).toHaveBeenCalledWith('CREATE EXTENSION IF NOT EXISTS vector');
  });

  it('con AI_ENABLED=false todo endpoint de IA da 503', async () => {
    const { service } = build(chatProvider(), embedProvider(3), config({ 'ai.enabled': false }));
    await expect(service.health()).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.chat('hola', user)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.embed('hola', user)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('chat registra métricas sin prompt ni respuesta', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const { service } = build(chatProvider(), embedProvider(3), config(), recorded);
    const result = await service.chat('hola', user);
    expect(result.response).toBe('respuesta');
    expect(result.metrics).toMatchObject({
      tokensIn: 4,
      tokensOut: 8,
      seconds: 1,
      tokensPerSecond: 8,
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ feature: 'lab_chat', ok: true, userId: 'user-1' });
    expect(JSON.stringify(recorded[0])).not.toContain('hola');
    expect(JSON.stringify(recorded[0])).not.toContain('respuesta');
  });

  it('Ollama caído da 503 y deja una fila ok=false', async () => {
    const recorded: Array<Record<string, unknown>> = [];
    const failing = chatProvider(undefined, new Error('fetch failed'));
    const { service } = build(failing, embedProvider(3), config(), recorded);
    await expect(service.chat('hola', user)).rejects.toThrow(/no disponible/i);
    expect(recorded[0]).toMatchObject({ ok: false, errorMessage: 'fetch failed' });
  });

  it('embed rechaza dimensión distinta de AI_EMBED_DIM', async () => {
    const { service } = build(chatProvider(), embedProvider(2));
    await expect(service.embed('hola', user)).rejects.toThrow(/Dimensión de embedding 2/);
  });

  it('similitud coseno: frases parecidas puntúan más alto', async () => {
    const close = build(
      chatProvider(),
      embedProvider(3, [[1, 0, 0], [0.95, 0.1, 0]]),
    );
    const far = build(chatProvider(), embedProvider(3, [[1, 0, 0], [0, 1, 0]]));
    const a = await close.service.similarity('a', 'b', user);
    const b = await far.service.similarity('a', 'b', user);
    expect(a.similarity).toBeGreaterThan(b.similarity);
    expect(a.percent).toBeGreaterThan(90);
  });

  it('health con proveedor sin red responde ok; con provider que falla, 503', async () => {
    const ok = build(chatProvider(), embedProvider(3));
    expect(await ok.service.health()).toMatchObject({ reachable: true, version: 'mock (sin red)' });

    const broken: AiDiagnosticsProvider = {
      name: 'ollama',
      chat: jest.fn(),
      embed: jest.fn(),
      getVersion: jest.fn(async () => {
        throw new Error('fetch failed');
      }),
      listModels: jest.fn(async () => []),
      listLoaded: jest.fn(async () => []),
    };
    const down = build(broken, embedProvider(3));
    await expect(down.service.health()).rejects.toThrow(/Ollama no disponible/);
  });
});
