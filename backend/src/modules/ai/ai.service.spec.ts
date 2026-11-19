import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AiService } from './ai.service';
import { AiUsageService } from './ai-usage.service';
import {
  AiDiagnosticsProvider,
  AiProvider,
  AiTimeoutError,
  ChatMessage,
  ChatResult,
  EmbedResult,
} from './ai.types';
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

function respuesta(texto: string): ChatResult {
  return {
    text: texto,
    usage: {
      promptTokens: 4,
      completionTokens: 8,
      loadMs: 12,
      totalMs: 1000,
      tokensPerSecond: 8,
    },
    provider: 'mock',
    model: 'qwen3:4b',
  };
}

function structuredProvider(texto: string): AiProvider {
  return {
    name: 'mock',
    chat: jest.fn(async () => respuesta(texto)),
    embed: jest.fn(async () => ({}) as EmbedResult),
    generateJson: jest.fn(async () => respuesta(texto)),
  };
}

const ticketDePrueba = {
  id: 'ticket-1',
  ticketNumber: 123,
  createdAt: new Date('2026-11-19T12:00:00Z'),
  title: 'Sin conexión en el laboratorio',
  description: 'El equipo del laboratorio no conecta a internet.',
  status: 'nuevo',
  priority: 'normal',
  category: null,
  messages: [],
  mergedMessages: [],
  technician: null,
};

function build(
  chat: AiProvider,
  embed: AiProvider,
  cfg = config(),
  recorded: Array<Record<string, unknown>> = [],
  filasCatalogo?: unknown[][],
) {
  const usage = {
    record: jest.fn(async (input: Record<string, unknown>) => {
      recorded.push(input);
    }),
  } as unknown as AiUsageService;
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('CREATE EXTENSION')) return [];
      return filasCatalogo?.shift() ?? [];
    }),
  } as unknown as DataSource;
  const tickets = {
    findOne: jest.fn(async () => ticketDePrueba),
  } as unknown as TicketsService;
  const service = new AiService(chat, embed, cfg, usage, tickets, dataSource);
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

  it('todos los mensajes arrancan con el sistema en español y terminan con el refuerzo', async () => {
    const proveedor = chatProvider({ text: 'Hola, ¿en qué puedo ayudar?' });
    const { service } = build(proveedor, embedProvider(3));
    await service.chat('¿Qué es un switch?', user);

    const mensajes = (proveedor.chat as jest.Mock).mock.calls[0][0] as ChatMessage[];
    expect(mensajes[0].content.startsWith(
      'Sos un asistente de soporte técnico de SolidOps. Respondé SIEMPRE en español de Argentina, claro y breve, aunque el texto del ticket esté en otro idioma.',
    )).toBe(true);
    for (const mensaje of mensajes) {
      expect(mensaje.content.trimEnd().endsWith('Respondé en español.')).toBe(true);
    }
  });

  it('reintenta una vez en español cuando la primera respuesta sale en inglés', async () => {
    const proveedor = chatProvider();
    (proveedor.chat as jest.Mock)
      .mockResolvedValueOnce(respuesta('The switch connects devices on the network.'))
      .mockResolvedValueOnce(respuesta('El switch conecta dispositivos en la red.'));
    const recorded: Array<Record<string, unknown>> = [];
    const { service } = build(proveedor, embedProvider(3), config(), recorded);

    const resultado = await service.chat('¿Qué es un switch?', user);
    expect(proveedor.chat).toHaveBeenCalledTimes(2);
    expect(resultado.response).toContain('El switch conecta');
    expect(resultado.aviso).toBeUndefined();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ ok: true, feature: 'lab_chat' });
  });

  it('si vuelve a salir en inglés, muestra el aviso y lo registra en ai_usage_log', async () => {
    const proveedor = chatProvider({ text: 'The switch connects devices.' });
    const recorded: Array<Record<string, unknown>> = [];
    const { service } = build(proveedor, embedProvider(3), config(), recorded);

    const resultado = await service.chat('¿Qué es un switch?', user);
    expect(proveedor.chat).toHaveBeenCalledTimes(2);
    expect(resultado.response).toMatch(/^respuesta en otro idioma:/);
    expect(resultado.aviso).toBe('respuesta en otro idioma');
    expect(recorded[0]).toMatchObject({
      ok: false,
      errorMessage: 'respuesta en otro idioma',
      feature: 'lab_chat',
    });
  });

  it('el prompt de resumen incluye el ejemplo con el formato esperado', async () => {
    const proveedor = structuredProvider('{"pedido":"Restablecer internet","probado":"Reiniciar el modem","falta":"Confirmar con el cliente","cliente":"Por email"}');
    const { service } = build(proveedor, embedProvider(3));
    await service.summarizeTicket('ticket-1', user);

    const prompt = (proveedor.generateJson as jest.Mock).mock.calls[0][0] as string;
    expect(prompt).toContain('Sos un asistente de soporte técnico de SolidOps');
    expect(prompt).toContain('Ejemplo de resumen');
    expect(prompt).toContain('"pedido"');
    expect(prompt).toContain('Sin datos');
    expect(prompt).toContain('no los copies');
    expect(prompt).toContain('Nunca escribas frases explicativas como "No se ha realizado ningún probado"');
    expect(prompt.trimEnd().endsWith('Respondé en español.')).toBe(true);
  });

  it('el resumen convierte explicaciones de "sin datos" devueltas por el modelo', async () => {
    const proveedor = structuredProvider(
      '{"pedido":"Reparar impresora","probado":"No se ha realizado ningún probado",' +
        '"falta":"No se especifica si se instaló el repuesto","cliente":"Adriana"}',
    );
    const { service } = build(proveedor, embedProvider(3));
    const resultado = await service.summarizeTicket('ticket-1', user);

    expect(resultado.summary).toEqual({
      pedido: 'Reparar impresora',
      probado: 'Sin datos',
      falta: 'Sin datos',
      cliente: 'Adriana',
    });
    expect(resultado.textoModelo).toContain('No se ha realizado ningún probado');
  });

  it('clasificación valida categorías y prioridades contra los valores de la base', async () => {
    const proveedor = structuredProvider(
      '{"categoria":"MikroTik","prioridad":"urgente","especialidad":"Redes","duracionEstimada":"2 horas","animo":"Con tranquilidad, lo resolvemos."}',
    );
    const filas = [
      [{ valor: 'Red / Conectividad' }, { valor: 'Taller' }],
      [{ valor: 'baja' }, { valor: 'normal' }, { valor: 'critica' }],
    ];
    const { service } = build(proveedor, embedProvider(3), config(), [], filas);
    const resultado = await service.classifyTicket('ticket-1', user);

    expect(resultado.ai).toMatchObject({
      categoria: 'sin coincidencia',
      prioridad: 'sin coincidencia',
    });
    const prompt = (proveedor.generateJson as jest.Mock).mock.calls[0][0] as string;
    expect(prompt).toContain('Categorías existentes en SolidOps');
    expect(prompt).toContain('Prioridades existentes en SolidOps');
    expect(prompt).toContain('Ejemplo de clasificación');
  });

  it('clasificación acepta valores de la base con tildes y devuelve el nombre en español', async () => {
    const proveedor = structuredProvider(
      '{"categoria":"Taller","prioridad":"crítica","especialidad":"Hardware","duracionEstimada":"2 horas","animo":"Con tranquilidad, lo resolvemos."}',
    );
    const filas = [
      [{ valor: 'Red / Conectividad' }, { valor: 'Taller' }],
      [{ valor: 'baja' }, { valor: 'normal' }, { valor: 'critica' }],
    ];
    const { service } = build(proveedor, embedProvider(3), config(), [], filas);
    const resultado = await service.classifyTicket('ticket-1', user);

    expect(resultado.ai).toMatchObject({ categoria: 'Taller', prioridad: 'crítica' });
  });

  it('el ejemplo de clasificación es ficticio y el schema cierra animo y minutos', async () => {
    const proveedor = structuredProvider(
      '{"categoria":"Taller","prioridad":"normal","especialidad":"Redes","duracionEstimada":45,"animo":"tranquilo"}',
    );
    const filas = [[{ valor: 'Taller' }], [{ valor: 'normal' }]];
    const { service } = build(proveedor, embedProvider(3), config(), [], filas);
    await service.classifyTicket('ticket-1', user);

    const prompt = (proveedor.generateJson as jest.Mock).mock.calls[0][0] as string;
    expect(prompt).toContain('CATEGORIA_FICTICIA');
    expect(prompt).toContain('ANIMO_FICTICIO');
    expect(prompt).toContain('"duracionEstimada":123');
    expect(prompt).toContain('no los copies');
    expect(prompt).not.toContain('Con tranquilidad, lo resolvemos.');
    expect(prompt).not.toContain('"duracionEstimada":"2 horas"');
    expect(prompt).toContain('tranquilo, apurado, molesto, preocupado, neutral');
    expect(prompt).toContain('número entero de minutos');

    const schema = (proveedor.generateJson as jest.Mock).mock.calls[0][1];
    expect(schema.properties.animo.enum).toEqual([
      'tranquilo',
      'apurado',
      'molesto',
      'preocupado',
      'neutral',
    ]);
    expect(schema.properties.duracionEstimada.type).toBe('integer');
  });

  it('normaliza animo y minutos aunque el proveedor devuelva texto libre', async () => {
    const proveedor = structuredProvider(
      '{"categoria":"Taller","prioridad":"normal","especialidad":"Redes","duracionEstimada":"2 horas","animo":"Con tranquilidad, lo resolvemos."}',
    );
    const filas = [[{ valor: 'Taller' }], [{ valor: 'normal' }]];
    const { service } = build(proveedor, embedProvider(3), config(), [], filas);
    const resultado = await service.classifyTicket('ticket-1', user);

    expect(resultado.ai).toMatchObject({
      animo: 'sin coincidencia',
      duracionEstimada: 'Sin datos',
    });
    expect(resultado.textoModelo).toContain('2 horas');
  });

  it('acepta animo de la lista cerrada y duracion en minutos', async () => {
    const proveedor = structuredProvider(
      '{"categoria":"Taller","prioridad":"normal","especialidad":"Redes","duracionEstimada":45,"animo":"apurado"}',
    );
    const filas = [[{ valor: 'Taller' }], [{ valor: 'normal' }]];
    const { service } = build(proveedor, embedProvider(3), config(), [], filas);
    const resultado = await service.classifyTicket('ticket-1', user);

    expect(resultado.ai).toMatchObject({ animo: 'apurado', duracionEstimada: 45 });
  });

  it('corta la llamada por timeout y muestra el mensaje exacto', async () => {
    const proveedor = chatProvider(undefined, new AiTimeoutError(5000));
    const recorded: Array<Record<string, unknown>> = [];
    const { service } = build(
      proveedor,
      embedProvider(3),
      config({ 'ai.chatTimeoutMs': 5000 }),
      recorded,
    );

    await expect(service.chat('hola', user)).rejects.toThrow(
      'La IA tardó demasiado, probá de nuevo',
    );
    expect(proveedor.chat).toHaveBeenCalledTimes(1);
    expect((proveedor.chat as jest.Mock).mock.calls[0][1]).toMatchObject({ timeoutMs: 5000 });
    expect(recorded[0]).toMatchObject({
      ok: false,
      errorMessage: 'La IA tardó demasiado, probá de nuevo',
    });
  });

  it('el reintento por idioma recibe sólo el tiempo restante del presupuesto', async () => {
    const proveedor = chatProvider();
    (proveedor.chat as jest.Mock)
      .mockResolvedValueOnce(respuesta('The switch connects devices.'))
      .mockResolvedValueOnce(respuesta('El switch conecta dispositivos.'));
    const reloj = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockImplementation(() => 3500);
    try {
      const { service } = build(
        proveedor,
        embedProvider(3),
        config({ 'ai.chatTimeoutMs': 5000 }),
      );
      await service.chat('hola', user);

      const llamadas = (proveedor.chat as jest.Mock).mock.calls;
      expect(llamadas).toHaveLength(2);
      expect(llamadas[0][1].timeoutMs).toBe(5000);
      expect(llamadas[1][1].timeoutMs).toBe(2500);
    } finally {
      reloj.mockRestore();
    }
  });

  it('no reintenta si ya se agotó el presupuesto de 5 segundos', async () => {
    const proveedor = chatProvider({ text: 'The switch connects devices.' });
    const recorded: Array<Record<string, unknown>> = [];
    const reloj = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockImplementation(() => 6000);
    try {
      const { service } = build(
        proveedor,
        embedProvider(3),
        config({ 'ai.chatTimeoutMs': 5000 }),
        recorded,
      );
      await expect(service.chat('hola', user)).rejects.toThrow(
        'La IA tardó demasiado, probá de nuevo',
      );
      expect(proveedor.chat).toHaveBeenCalledTimes(1);
      expect(recorded[0]).toMatchObject({
        ok: false,
        errorMessage: 'La IA tardó demasiado, probá de nuevo',
      });
    } finally {
      reloj.mockRestore();
    }
  });

  it('si el reintento agota el tiempo restante, también muestra el mensaje de timeout', async () => {
    const proveedor = chatProvider();
    (proveedor.chat as jest.Mock)
      .mockResolvedValueOnce(respuesta('The switch connects devices.'))
      .mockRejectedValueOnce(new AiTimeoutError(2500));
    const recorded: Array<Record<string, unknown>> = [];
    const { service } = build(
      proveedor,
      embedProvider(3),
      config({ 'ai.chatTimeoutMs': 5000 }),
      recorded,
    );

    await expect(service.chat('hola', user)).rejects.toThrow(
      'La IA tardó demasiado, probá de nuevo',
    );
    expect(proveedor.chat).toHaveBeenCalledTimes(2);
    expect(recorded[0]).toMatchObject({
      ok: false,
      errorMessage: 'La IA tardó demasiado, probá de nuevo',
    });
  });
});
