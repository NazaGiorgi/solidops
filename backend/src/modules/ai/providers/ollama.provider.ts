import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiDiagnosticsProvider,
  AiTimeoutError,
  ChatMessage,
  ChatOptions,
  ChatResult,
  EmbedResult,
  JsonSchema,
} from '../ai.types';
import { stripThinkTags } from '../ai-text.util';

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
}

interface OllamaGenerateResponse {
  response?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
  total_duration?: number;
  load_duration?: number;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

interface OllamaListResponse {
  models?: Array<{ name?: string }>;
}

interface OllamaVersionResponse {
  version?: string;
}

@Injectable()
export class OllamaAiProvider implements AiDiagnosticsProvider {
  readonly name = 'ollama';
  private readonly logger = new Logger(OllamaAiProvider.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (config.get<string>('ai.ollamaUrl') || 'http://ollama:11434').replace(/\/+$/, '');
    this.timeoutMs = config.get<number>('ai.chatTimeoutMs') || 180000;
  }

  // Un AbortController por pedido, con un deadline ABSOLUTO. El reintento por
  // red comparte el mismo controller: aunque falle, nunca suma tiempo extra.
  // Los timeouts NO se reintentan.
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs: number = this.timeoutMs,
  ): Promise<T> {
    const limite = Math.max(0, Math.min(timeoutMs, this.timeoutMs));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limite);
    let lastError: unknown;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (controller.signal.aborted) throw new AiTimeoutError(limite);
        try {
          const res = await fetch(`${this.baseUrl}${path}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new Error(`Ollama HTTP ${res.status}: ${detail.slice(0, 300)}`);
          }
          return (await res.json()) as T;
        } catch (e) {
          lastError = e;
          if (controller.signal.aborted) throw new AiTimeoutError(limite);
          // Sólo reintentamos fallos de red; 4xx/5xx ya obtuvieron respuesta.
          if (!(e instanceof TypeError) || attempt === 1) throw e;
          this.logger.warn(`Fallo de red con Ollama (${path}); reintentando una vez`);
        }
      }
      throw lastError ?? new AiTimeoutError(limite);
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const model = opts.model || this.config.get<string>('ai.modelFast') || 'qwen3:4b';
    const numCtx = opts.numCtx || this.config.get<number>('ai.numCtx') || 8192;
    const started = Date.now();
    const data = await this.request<OllamaChatResponse>('POST', '/api/chat', {
      model,
      messages,
      stream: false,
      // qwen3 soporta think:false. Modelos que no lo conocen lo ignoran.
      think: false,
      options: {
        num_ctx: numCtx,
        temperature: opts.temperature ?? 0.2,
        num_predict: opts.maxTokens ?? (this.config.get<number>('ai.maxTokens') || 2048),
      },
    }, opts.timeoutMs ?? this.timeoutMs);

    const promptTokens = Number(data.prompt_eval_count || 0);
    const completionTokens = Number(data.eval_count || 0);
    const evalNs = Number(data.eval_duration || 0);
    const totalNs = Number(data.total_duration || 0);
    const loadNs = Number(data.load_duration || 0);

    return {
      text: stripThinkTags(data.message?.content ?? ''),
      usage: {
        promptTokens,
        completionTokens,
        loadMs: loadNs ? loadNs / 1e6 : 0,
        totalMs: totalNs ? totalNs / 1e6 : Date.now() - started,
        tokensPerSecond:
          evalNs > 0 ? Number(((completionTokens / (evalNs / 1e9))).toFixed(2)) : null,
      },
      provider: this.name,
      model,
    };
  }

  // qwen3:4b razona siempre (think:false no lo desactiva) y con /api/chat se
  // comía todo el presupuesto de tokens antes de escribir el JSON. /api/generate
  // con `format` obliga a producir el objeto directamente: ~30 s en CPU.
  async generateJson(
    prompt: string,
    schema: JsonSchema,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const model = opts.model || this.config.get<string>('ai.modelSmart') || 'qwen3:4b';
    const numCtx = Math.min(opts.numCtx || this.config.get<number>('ai.numCtx') || 8192, 2048);
    const started = Date.now();
    const data = await this.request<OllamaGenerateResponse>('POST', '/api/generate', {
      model,
      prompt,
      stream: false,
      think: false,
      format: schema,
      options: {
        num_ctx: numCtx,
        temperature: opts.temperature ?? 0.2,
        num_predict: opts.maxTokens ?? 512,
      },
    }, opts.timeoutMs ?? this.timeoutMs);
    const completionTokens = Number(data.eval_count || 0);
    const evalNs = Number(data.eval_duration || 0);
    const totalNs = Number(data.total_duration || 0);
    const loadNs = Number(data.load_duration || 0);
    return {
      text: stripThinkTags(data.response ?? ''),
      usage: {
        promptTokens: Number(data.prompt_eval_count || 0),
        completionTokens,
        loadMs: loadNs ? loadNs / 1e6 : 0,
        totalMs: totalNs ? totalNs / 1e6 : Date.now() - started,
        tokensPerSecond: evalNs > 0 ? Number((completionTokens / (evalNs / 1e9)).toFixed(2)) : null,
      },
      provider: this.name,
      model,
    };
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const model = this.config.get<string>('ai.embedModel') || 'bge-m3';
    const started = Date.now();
    const data = await this.request<OllamaEmbedResponse>('POST', '/api/embed', {
      model,
      input: texts,
    });
    const embeddings = data.embeddings || [];
    return {
      embeddings,
      dimension: embeddings[0]?.length || 0,
      durationMs: Date.now() - started,
      provider: this.name,
      model,
    };
  }

  async getVersion(): Promise<string | null> {
    const data = await this.request<OllamaVersionResponse>('GET', '/api/version', undefined, 8000);
    return data.version ?? null;
  }

  async listModels(): Promise<string[]> {
    const data = await this.request<OllamaListResponse>('GET', '/api/tags', undefined, 8000);
    return (data.models || []).map((m) => m.name).filter((n): n is string => !!n);
  }

  async listLoaded(): Promise<string[]> {
    const data = await this.request<OllamaListResponse>('GET', '/api/ps', undefined, 8000);
    return (data.models || []).map((m) => m.name).filter((n): n is string => !!n);
  }
}
