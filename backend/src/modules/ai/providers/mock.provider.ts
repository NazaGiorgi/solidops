import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  EmbedResult,
  JsonSchema,
} from '../ai.types';
import { extractJsonObject } from '../ai-text.util';

// Proveedor sin red: respuestas armadas y embeddings determinísticos por hash.
// Sirve para probar el cableado del laboratorio sin Ollama ni conexión.
@Injectable()
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  constructor(private readonly config: ConfigService) {}

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const prompt = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const lower = prompt.toLowerCase();
    let text = 'Respuesta simulada (proveedor mock, sin red ni modelo real).';
    if (lower.includes('switch')) {
      text = 'Un switch de red conecta dispositivos y reenvía tramas entre ellos.';
    } else if (lower.includes('resum')) {
      text =
        'Pedido: se informa una falla.\nProbado: se describen las acciones realizadas.\n' +
        'Falta: definir el siguiente paso.\nCliente: se mantiene informado.';
    } else if (lower.includes('clasif') || lower.includes('categor')) {
      text =
        '{"categoria":"Redes","prioridad":"Media","especialidad":"Redes",' +
        '"duracionEstimada":"1 a 2 horas","animo":"Neutro"}';
    }

    const model = opts.model || this.config.get<string>('ai.modelFast') || 'mock';
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = Math.ceil(text.length / 4);
    const totalMs = 5;
    return {
      text,
      usage: {
        promptTokens,
        completionTokens,
        loadMs: 0,
        totalMs,
        tokensPerSecond: Number((completionTokens / (totalMs / 1000)).toFixed(2)),
      },
      provider: this.name,
      model,
    };
  }

  async generateJson(
    prompt: string,
    schema: JsonSchema,
    opts: ChatOptions = {},
  ): Promise<ChatResult> {
    const chat = await this.chat([{ role: 'user', content: prompt }], opts);
    const parsed = extractJsonObject(chat.text) ?? {};
    const result: Record<string, string> = {};
    for (const key of Object.keys(schema.properties)) {
      result[key] = String(parsed[key] ?? '');
    }
    return { ...chat, text: JSON.stringify(result) };
  }

  async embed(texts: string[]): Promise<EmbedResult> {
    const dimension = this.config.get<number>('ai.embedDim') || 1024;
    const model = this.config.get<string>('ai.embedModel') || 'bge-m3';
    const started = Date.now();
    const embeddings = texts.map((text) => this.vectorFor(text, dimension));
    return {
      embeddings,
      dimension,
      durationMs: Date.now() - started,
      provider: this.name,
      model,
    };
  }

  private vectorFor(text: string, dimension: number): number[] {
    const vector = new Array<number>(dimension).fill(0);
    const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 200);
    for (let d = 0; d < dimension; d += 1) {
      let sum = 0;
      for (const token of tokens) {
        let hash = (2166136261 ^ d) >>> 0;
        for (let i = 0; i < token.length; i += 1) {
          hash ^= token.charCodeAt(i);
          hash = Math.imul(hash, 16777619) >>> 0;
        }
        sum += (hash / 0xffffffff) * 2 - 1;
      }
      vector[d] = sum;
    }
    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
