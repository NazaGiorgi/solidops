// Contrato común de proveedores de IA. Agregar openai/anthropic después no
// requiere tocar servicios ni controladores: basta otro AiProvider y cambiar
// la variable AI_CHAT_PROVIDER / AI_EMBED_PROVIDER.
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  numCtx?: number;
}

export interface UsageMetrics {
  promptTokens: number;
  completionTokens: number;
  loadMs: number;
  totalMs: number;
  tokensPerSecond: number | null;
}

export interface ChatResult {
  text: string;
  usage: UsageMetrics;
  provider: string;
  model: string;
}

export interface EmbedResult {
  embeddings: number[][];
  dimension: number;
  durationMs: number;
  provider: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  embed(texts: string[]): Promise<EmbedResult>;
}

// Extensión opcional para proveedores que pueden responder diagnósticos.
export interface AiDiagnosticsProvider extends AiProvider {
  getVersion(): Promise<string | null>;
  listModels(): Promise<string[]>;
  listLoaded(): Promise<string[]>;
}

export const CHAT_PROVIDER = Symbol('AI_CHAT_PROVIDER');
export const EMBED_PROVIDER = Symbol('AI_EMBED_PROVIDER');
