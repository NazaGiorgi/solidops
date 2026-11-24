import { ConfigService } from '@nestjs/config';
import { AiTimeoutError } from '../ai.types';
import { MockAiProvider } from './mock.provider';
import { OllamaAiProvider } from './ollama.provider';

function config(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    'ai.ollamaUrl': 'http://ollama:11434',
    'ai.chatTimeoutMs': 1000,
    'ai.modelFast': 'qwen3:4b',
    'ai.numCtx': 8192,
    'ai.embedModel': 'bge-m3',
    'ai.embedDim': 1024,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('OllamaAiProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('manda stream:false, think:false, num_ctx y temperatura 0.2; limpia <think>', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        message: { content: '<think>no mostrar</think>Respuesta final' },
        prompt_eval_count: 10,
        eval_count: 20,
        eval_duration: 1_000_000_000,
        total_duration: 2_000_000_000,
        load_duration: 500_000_000,
      }),
    );
    const provider = new OllamaAiProvider(config());
    const result = await provider.chat([{ role: 'user', content: 'hola' }]);

    expect(result.text).toBe('Respuesta final');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(20);
    expect(result.usage.tokensPerSecond).toBe(20);
    expect(result.usage.loadMs).toBe(500);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ollama:11434/api/chat');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      think: false,
      options: { num_ctx: 8192, temperature: 0.2 },
    });
  });

  it('generateJson usa el mismo num_ctx del pedido (8192) y formato JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        response: '{"categoria":"Taller"}',
        prompt_eval_count: 40,
        eval_count: 8,
      }),
    );
    const provider = new OllamaAiProvider(config());
    await provider.generateJson('clasificá', {
      type: 'object',
      properties: { categoria: { type: 'string' } },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ollama:11434/api/generate');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'qwen3:4b',
      stream: false,
      think: false,
      format: { type: 'object' },
      options: { num_ctx: 8192, temperature: 0.2 },
    });
  });

  it('reintenta una vez ante error de red', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response({ message: { content: 'ok' } }));
    const provider = new OllamaAiProvider(config());
    const result = await provider.chat([{ role: 'user', content: 'hola' }]);
    expect(result.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborta el fetch con AbortController y NO reintenta el timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const provider = new OllamaAiProvider(config({ 'ai.chatTimeoutMs': 30 }));

    let error: unknown;
    try {
      await provider.chat([{ role: 'user', content: 'hola' }], { timeoutMs: 20 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AiTimeoutError);
    expect((error as Error).message).toBe('La IA tardó demasiado, probá de nuevo');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('NO reintenta un error HTTP 404', async () => {
    fetchMock.mockResolvedValue(response({ error: 'model not found' }, false, 404));
    const provider = new OllamaAiProvider(config());
    await expect(provider.chat([{ role: 'user', content: 'hola' }])).rejects.toThrow(
      /Ollama HTTP 404/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('valida dimensión de embeddings', async () => {
    fetchMock.mockResolvedValueOnce(response({ embeddings: [[0.1, 0.2, 0.3]] }));
    const provider = new OllamaAiProvider(config());
    const result = await provider.embed(['texto']);
    expect(result.dimension).toBe(3);
    expect(result.embeddings[0]).toHaveLength(3);
    expect(fetchMock.mock.calls[0][0]).toBe('http://ollama:11434/api/embed');
  });
});

describe('MockAiProvider', () => {
  it('responde JSON de clasificación sin red', async () => {
    const provider = new MockAiProvider(config());
    const result = await provider.chat([{ role: 'user', content: 'clasificá este ticket' }]);
    expect(JSON.parse(result.text)).toHaveProperty('categoria');
    expect(result.provider).toBe('mock');
  });

  it('devuelve una respuesta util para el schema del borrador', async () => {
    const provider = new MockAiProvider(config());
    const result = await provider.generateJson('ticket', {
      type: 'object',
      properties: { respuesta: { type: 'string' } },
      required: ['respuesta'],
    });
    expect(JSON.parse(result.text).respuesta).toContain('revisamos tu consulta');
  });

  it('devuelve pasos citando la fuente para el schema de la solución', async () => {
    const provider = new MockAiProvider(config());
    const result = await provider.generateJson('Ticket fuente TK-2026-40033', {
      type: 'object',
      properties: { pasos: { type: 'array', items: { type: 'string' } } },
      required: ['pasos'],
    });
    expect(JSON.parse(result.text).pasos[0]).toContain('(Fuente: TK-2026-40033)');
  });

  it('genera embeddings determinísticos de la dimensión configurada', async () => {
    const provider = new MockAiProvider(config());
    const [a, b, repeated] = (
      await provider.embed(['impresora no imprime', 'el equipo no enciende', 'impresora no imprime'])
    ).embeddings;
    expect(a).toHaveLength(1024);
    expect(a).toEqual(repeated);
    expect(a).not.toEqual(b);
  });
});
