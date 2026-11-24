import {
  BadRequestException,
  Inject,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TicketAuthorType, TicketPriority, TicketStatus } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Ticket } from '../../entities/ticket.entity';
import { TicketMessage } from '../../entities/ticket-message.entity';
import {
  excludeAutomaticNotices,
  isAutomaticNotice,
} from '../../common/utils/automatic-ticket-notice.util';
import { publicTicketNumber } from '../../common/utils/ticket-number.util';
import { TicketsService } from '../tickets/tickets.service';
import { AiUsageService } from './ai-usage.service';
import {
  AiDiagnosticsProvider,
  AiProvider,
  AiTimeoutError,
  CHAT_PROVIDER,
  ChatMessage,
  ChatResult,
  EMBED_PROVIDER,
  JsonSchema,
} from './ai.types';
import {
  citasTicket,
  cleanTicketText,
  copiaHiloDelTicket,
  cosineSimilarity,
  extractJsonObject,
  firstValues,
  inventaDatoDelHilo,
  isProbablyEnglish,
  maskSecrets,
  nombresPropiosExternos,
  normalizeText,
  parecidoTextos,
  sinDatosSiCorresponde,
  stripThinkTags,
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
  aviso?: string;
  // Texto exacto devuelto por el modelo (sin el prefijo de aviso).
  textoModelo: string;
}

// Antecedente encontrado SIN IA: ticket cerrado de una persona, con mensajes
// del equipo y credenciales enmascaradas. Se usa como fuente de la solución.
export interface Precedente {
  id: string;
  numero: string;
  titulo: string;
  estado: string;
  fecha: string;
  mismoCliente: boolean;
  mensajesEquipo: string[];
}

export interface PasoSolucion {
  texto: string;
  // El panel lo muestra para que se sepa si el paso viene del mismo cliente o
  // de un antecedente genérico de otro.
  origen: 'mismo cliente' | 'otro cliente';
  fuente: { id: string; numero: string; titulo: string };
}

// Arranca textualmente igual en TODOS los mensajes de sistema del módulo.
const SISTEMA_ES =
  'Sos un asistente de soporte técnico de SolidOps. Respondé SIEMPRE en español de Argentina, claro y breve, aunque el texto del ticket esté en otro idioma.';
const REFUERZO_ES = 'Respondé en español.';
const AVISO_IDIOMA = 'respuesta en otro idioma';
const SIN_COINCIDENCIA = 'sin coincidencia';
const FIRMA_BORRADOR = 'Equipo Solido';

const EJEMPLO_RESUMEN = [
  'Ejemplo de resumen (solo muestra el formato; los valores son ficticios, no los copies):',
  '{"pedido":"TEXTO_FICTICIO_DEL_PEDIDO",' +
    '"probado":"Sin datos",' +
    '"falta":"TEXTO_FICTICIO_DE_LO_QUE_FALTA",' +
    '"cliente":"Sin datos"}',
].join('\n');

const REGLA_SIN_DATOS =
  'Si el ticket no tiene información para un campo, devolvé la cadena vacía "" o "Sin datos". ' +
  'Nunca escribas frases explicativas como "No se ha realizado ningún probado" ' +
  'ni "No se especifica".';

// Descripciones sólo para las categorías que ya existen en la base. No se crea
// ninguna categoría nueva: si el modelo necesita hardware/PC, debe elegir
// "Taller", que es la que existe.
const CATEGORIA_DESCRIPCIONES: Record<string, string> = {
  'red conectividad':
    'Red / Conectividad: internet, routers, switches, WiFi, VPN y problemas de conectividad.',
  soporte:
    'soporte: soporte general y consultas de software o equipos sin una categoría más específica.',
  taller:
    'Taller: equipos, monitores, fuentes, impresoras rotas y reparación de PC/hardware.',
};

const URGENTE = /urgent|no podemos trabajar|sin sistema|parad[oa]/i;

function mensajeSistema(detalle: string): string {
  // El texto exigido va primero, el refuerzo siempre al final.
  return `${SISTEMA_ES}${detalle ? `\n\n${detalle}` : ''}\n\n${REFUERZO_ES}`;
}

function conRefuerzo(contenido: string): string {
  const texto = contenido.trimEnd();
  return texto.endsWith(REFUERZO_ES) ? texto : `${texto}\n\n${REFUERZO_ES}`;
}

function etiquetaPrioridad(valor: string): string {
  return valor === 'critica' ? 'crítica' : valor;
}

function describirCategorias(categorias: string[]): string {
  if (!categorias.length) return '(sin categorías cargadas)';
  return categorias
    .map(
      (categoria) =>
        CATEGORIA_DESCRIPCIONES[normalizeText(categoria)] ??
        `${categoria}: categoría existente en la base (sin descripción adicional).`,
    )
    .join('\n');
}

const SUMMARY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    pedido: { type: 'string' },
    probado: { type: 'string' },
    falta: { type: 'string' },
    cliente: { type: 'string' },
  },
  required: ['pedido', 'probado', 'falta', 'cliente'],
};

const REPLY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    respuesta: {
      type: 'string',
      description: 'Sólo el mensaje listo para enviar al cliente, sin saludos ni firma',
    },
  },
  required: ['respuesta'],
};

const SOLUTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    pasos: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Entre 1 y 5 acciones concretas. Cada paso cita al final su fuente: (Fuente: TK-AAAA-NNNNN).',
    },
  },
  required: ['pasos'],
};

// Piso de parecido entre el ticket actual y un antecedente. Debajo de acá el
// ticket cerrado se ignora aunque el full-text lo haya traído.
const SIMILITUD_MINIMA = 0.2;

const ANIMOS = ['tranquilo', 'apurado', 'molesto', 'preocupado', 'neutral'] as const;

const CLASSIFY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    categoria: { type: 'string' },
    prioridad: { type: 'string' },
    especialidad: { type: 'string' },
    duracionEstimada: {
      type: 'integer',
      description: 'Duración estimada en minutos, como número entero',
    },
    animo: {
      type: 'string',
      enum: [...ANIMOS],
      description: 'Estado de ánimo del cliente: una de las opciones permitidas',
    },
  },
  required: ['categoria', 'prioridad', 'especialidad', 'duracionEstimada', 'animo'],
};

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
    if (e instanceof AiTimeoutError) {
      return new ServiceUnavailableException('La IA tardó demasiado, probá de nuevo');
    }
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
      aiTicketsEnabled: this.cfg('ai.ticketsEnabled', false),
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
      { role: 'system', content: mensajeSistema('Respondé de forma breve y concreta.') },
      { role: 'user', content: conRefuerzo(prompt) },
    ];
    return this.guardedChat(messages, undefined, opts.model, user.id, opts.feature || 'lab_chat');
  }

  private async recordedChatResult(
    result: ChatResult,
    userId: string | null,
    feature: string,
    aviso: string | null = null,
  ): Promise<ChatView> {
    // El aviso de idioma también queda en ai_usage_log (ok=false + mensaje).
    await this.usage.record({
      userId,
      feature,
      provider: result.provider,
      model: result.model,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      durationMs: result.usage.totalMs,
      tokensPerSecond: result.usage.tokensPerSecond,
      ok: aviso === null,
      errorMessage: aviso,
    });
    return {
      response: aviso ? `${aviso}: ${result.text}` : result.text,
      textoModelo: result.text,
      metrics: {
        tokensIn: result.usage.promptTokens,
        tokensOut: result.usage.completionTokens,
        seconds: Number((result.usage.totalMs / 1000).toFixed(2)),
        tokensPerSecond: result.usage.tokensPerSecond,
        loadMs: Number(result.usage.loadMs.toFixed(1)),
        provider: result.provider,
        model: result.model,
      },
      ...(aviso ? { aviso } : {}),
    };
  }

  // Resumen y clasificación necesitan un objeto, no prosa. Si el proveedor
  // tiene salida estructurada la usamos; si no, caemos al chat de siempre.
  private async registrarFallo(
    model: string,
    userId: string | null,
    feature: string,
    errorMessage: string,
  ): Promise<void> {
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
      errorMessage,
    });
  }

  private async callModel(
    messages: ChatMessage[],
    schema: JsonSchema | undefined,
    model: string,
    timeoutMs?: number,
  ): Promise<ChatResult> {
    // El deadline se propaga al proveedor; allí un AbortController corta el
    // fetch aunque Ollama siga generando tokens.
    const opts = { model, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
    const generate = schema ? this.chatProvider.generateJson?.bind(this.chatProvider) : undefined;
    if (generate) {
      try {
        const prompt = messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
        return await generate(prompt, schema!, opts);
      } catch (e) {
        if (e instanceof AiTimeoutError) throw e;
        this.logger.warn(`Salida estructurada fallida; usando chat: ${(e as Error).message}`);
      }
    }
    return this.chatProvider.chat(messages, opts);
  }

  private reforzar(messages: ChatMessage[]): ChatMessage[] {
    return [
      ...messages.map((m) => ({ ...m, content: conRefuerzo(m.content) })),
      {
        role: 'user',
        content: `Tu respuesta anterior salió en otro idioma. Repetila en español de Argentina, claro y breve.\n\n${REFUERZO_ES}`,
      },
    ];
  }

  private sumarUso(primero: ChatResult, segundo: ChatResult): ChatResult {
    const totalMs = primero.usage.totalMs + segundo.usage.totalMs;
    const tokens = primero.usage.completionTokens + segundo.usage.completionTokens;
    return {
      ...segundo,
      usage: {
        ...segundo.usage,
        promptTokens: primero.usage.promptTokens + segundo.usage.promptTokens,
        completionTokens: tokens,
        loadMs: primero.usage.loadMs + segundo.usage.loadMs,
        totalMs,
        tokensPerSecond: totalMs > 0 ? Number(((tokens / (totalMs / 1000))).toFixed(2)) : null,
      },
    };
  }

  // Un solo intento extra con la instrucción reforzada. Si sigue en inglés,
  // se devuelve con aviso y se registra en ai_usage_log.
  private async guardedChat(
    messages: ChatMessage[],
    schema: JsonSchema | undefined,
    modelOverride: string | undefined,
    userId: string | null,
    feature: string,
  ): Promise<ChatView> {
    const model = modelOverride || this.cfg('ai.modelFast', 'qwen3:4b');
    // Un único reloj para la llamada original y el reintento por idioma.
    const presupuesto = Math.max(0, this.cfg('ai.chatTimeoutMs', 180000));
    const inicio = Date.now();
    let result: ChatResult;
    try {
      result = await this.callModel(messages, schema, model, presupuesto);
    } catch (e) {
      await this.registrarFallo(model, userId, feature, (e as Error).message);
      throw this.unavailable(e);
    }

    let aviso: string | null = null;
    if (isProbablyEnglish(result.text)) {
      const restante = presupuesto - (Date.now() - inicio);
      if (restante <= 0) {
        await this.registrarFallo(model, userId, feature, 'La IA tardó demasiado, probá de nuevo');
        throw this.unavailable(new AiTimeoutError(presupuesto));
      }
      try {
        const reintento = await this.callModel(this.reforzar(messages), schema, model, restante);
        result = this.sumarUso(result, reintento);
        if (isProbablyEnglish(reintento.text)) aviso = AVISO_IDIOMA;
      } catch (e) {
        if (e instanceof AiTimeoutError) {
          await this.registrarFallo(model, userId, feature, e.message);
          throw this.unavailable(e);
        }
        aviso = `${AVISO_IDIOMA}; reintento en español falló: ${(e as Error).message}`;
      }
    }
    return this.recordedChatResult(result, userId, feature, aviso);
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

  // Sólo SELECT: las opciones válidas salen de los valores que ya existen en
  // SolidOps. Nunca se escribe en la base desde el laboratorio.
  private async opcionesClasificacion(): Promise<{
    categorias: string[];
    prioridades: string[];
    especialidades: string[];
  }> {
    let categorias: string[] = [];
    let prioridades: string[] = [];
    let especialidades: string[] = [];
    try {
      const [filasCategoria, filasPrioridad, filasEspecialidad] = await Promise.all([
        this.dataSource.query(
          "SELECT DISTINCT category AS valor FROM tickets WHERE category IS NOT NULL AND btrim(category) <> '' ORDER BY 1",
        ),
        this.dataSource.query(
          "SELECT DISTINCT priority AS valor FROM tickets WHERE priority IS NOT NULL AND btrim(priority) <> '' ORDER BY 1",
        ),
        this.dataSource.query(
          "SELECT DISTINCT jsonb_array_elements_text(specialties) AS valor FROM technicians WHERE specialties IS NOT NULL ORDER BY 1",
        ),
      ]);
      const limpiar = (filas: unknown[]): string[] =>
        filas
          .map((fila) => String((fila as { valor?: unknown })?.valor ?? '').trim())
          .filter(Boolean);
      categorias = limpiar(filasCategoria as unknown[]);
      prioridades = limpiar(filasPrioridad as unknown[]);
      especialidades = limpiar(filasEspecialidad as unknown[]);
    } catch (e) {
      this.logger.warn(
        `No se pudieron leer categorías/prioridades/especialidades: ${(e as Error).message}`,
      );
    }
    if (!prioridades.length) prioridades = Object.values(TicketPriority);
    return { categorias, prioridades, especialidades };
  }

  private coincidirOpcion(
    valor: unknown,
    opciones: string[],
    conEtiquetaEspanola = false,
  ): string {
    const texto = String(valor ?? '').trim();
    if (!texto) return SIN_COINCIDENCIA;
    const normalizado = normalizeText(texto);
    const encontrado = opciones.find((opcion) => normalizeText(opcion) === normalizado);
    if (!encontrado) return SIN_COINCIDENCIA;
    return conEtiquetaEspanola ? etiquetaPrioridad(encontrado) : encontrado;
  }

  private minutos(valor: unknown): number | string {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 0 ? Math.round(numero) : 'Sin datos';
  }

  private async ticketContext(
    id: string,
    actor: AuthenticatedUser,
    omitirBot = false,
  ) {
    const ticket = await this.tickets.findOne(id, actor);
    const relacionados = [...(ticket.messages || []), ...(ticket.mergedMessages || [])];

    // El autor sale de la base, no del texto. Tres etiquetas: CLIENTE (persona),
    // EQUIPO SOLIDO (técnico humano) y BOT (sistema / mensajes automáticos de
    // WhatsApp). Los bots nunca se presentan como si hubiera escrito el equipo.
    // Para el borrador se omiten directamente: así no puede imitarlos.
    const messageBodies = relacionados
      .filter((m) => !(omitirBot && m.authorType === TicketAuthorType.SISTEMA))
      .map((m) => {
        const body = cleanTicketText(m.body);
        if (!body) return '';
        let etiqueta = 'EQUIPO SOLIDO';
        if (m.authorType === TicketAuthorType.CLIENTE) etiqueta = 'CLIENTE';
        else if (m.authorType === TicketAuthorType.SISTEMA) etiqueta = 'BOT';
        return `${etiqueta}: ${body.replace(/\n/g, '\n  ')}`;
      })
      .filter(Boolean);

    const razonSocial = ticket.customer?.name?.trim() || null;
    const contacto = ticket.contact?.name?.trim() || null;
    const cliente = contacto || razonSocial || null;

    const parts = [
      `Título: ${ticket.title ?? ''}`,
      `Descripción: ${cleanTicketText(ticket.description)}`,
      `Estado real: ${ticket.status ?? ''} | Prioridad real: ${ticket.priority ?? ''} | Categoría real: ${ticket.category ?? ''}`,
      `Cliente real (base de datos): ${razonSocial ?? 'Sin datos'}`,
      `Contacto real (base de datos): ${contacto ?? 'Sin datos'}`,
      'El campo "cliente" del resumen debe copiar literalmente el Contacto real; si no hay contacto, el Cliente real. No lo adivines del texto.',
      ...messageBodies,
    ];
    // El contexto del prompt acompaña al num_ctx del proveedor (8192). Con
    // qwen3:4b-instruct en GPU caben los 17 mensajes de un ticket largo sin
    // recortar; el techo evita overrides que no entren en 6 GB de VRAM.
    const contextTokens = Math.min(this.cfg('ai.numCtx', 8192), 8192);
    return {
      ticket,
      text: truncateForContext(parts.join('\n\n'), contextTokens),
      cliente,
      razonSocial,
      contacto,
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
      cliente: ticket.customer?.name ?? null,
      contacto: ticket.contact?.name ?? null,
      tecnico: ticket.technician?.user?.name ?? null,
      mensajes: (ticket.messages?.length ?? 0) + (ticket.mergedMessages?.length ?? 0),
    };
  }

  private primerMensajeCliente(ticket: Awaited<ReturnType<TicketsService['findOne']>>): string {
    const mensajes = [...(ticket.messages || []), ...(ticket.mergedMessages || [])];
    const primero = mensajes.find((m) => m.authorType === TicketAuthorType.CLIENTE);
    return cleanTicketText(primero?.body);
  }

  // `feature` permite reutilizar EXACTAMENTE esta lógica desde el Laboratorio
  // (lab_summarize) y desde el panel del ticket (ticket_summary).
  async summarizeTicket(id: string, user: AuthenticatedUser, feature = 'lab_summarize') {
    this.ensureEnabled();
    const { ticket, text, cliente } = await this.ticketContext(id, user);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: mensajeSistema(
          'Resumí el ticket en español de Argentina. Respondé SOLO un JSON válido con las claves ' +
            'pedido, probado, falta y cliente. No inventes datos que no estén en el ticket.\n\n' +
            REGLA_SIN_DATOS +
            '\n\n' +
            EJEMPLO_RESUMEN,
        ),
      },
      { role: 'user', content: conRefuerzo(`Resumí este ticket:\n\n${text}`) },
    ];
    const result = await this.guardedChat(
      messages,
      SUMMARY_SCHEMA,
      this.cfg('ai.modelSmart', this.cfg('ai.modelFast', 'qwen3:4b')),
      user.id,
      feature,
    );
    const parsed = extractJsonObject(result.response);
    const summary = parsed
      ? {
          pedido: sinDatosSiCorresponde(parsed.pedido),
          probado: sinDatosSiCorresponde(parsed.probado),
          falta: sinDatosSiCorresponde(parsed.falta),
          // El cliente no es una inferencia del modelo: viene de la base.
          cliente: cliente ?? 'Sin datos',
        }
      : {
          pedido: result.response.slice(0, 500),
          probado: '',
          falta: '',
          cliente: '',
        };
    // No se guarda nada: este endpoint sólo lee y devuelve el resultado.
    return {
      ticket: this.ticketSnapshot(ticket),
      summary,
      // Texto exacto del modelo, sin parsear ni prefijos de aviso.
      textoModelo: result.textoModelo,
      metrics: result.metrics,
      ...(result.aviso ? { aviso: result.aviso } : {}),
    };
  }

  async classifyTicket(id: string, user: AuthenticatedUser, feature = 'lab_classify') {
    this.ensureEnabled();
    const { ticket, text } = await this.ticketContext(id, user);
    const opciones = await this.opcionesClasificacion();
    const esUrgente = URGENTE.test(text);
    const schema: JsonSchema = {
      ...CLASSIFY_SCHEMA,
      properties: {
        ...CLASSIFY_SCHEMA.properties,
        categoria: {
          ...CLASSIFY_SCHEMA.properties.categoria,
          description: opciones.categorias.join(', ') || '(sin categorías cargadas)',
        },
        prioridad: {
          ...CLASSIFY_SCHEMA.properties.prioridad,
          description: opciones.prioridades.join(', '),
        },
        especialidad: {
          ...CLASSIFY_SCHEMA.properties.especialidad,
          enum: opciones.especialidades,
          description: 'Una de las especialidades de técnicos que existen en la base',
        },
      },
    };
    const ejemploClasificacion = [
      'Ejemplo de clasificación (solo muestra el formato; TODOS sus valores son ficticios, no los copies):',
      '{"categoria":"CATEGORIA_FICTICIA","prioridad":"PRIORIDAD_FICTICIA",' +
        '"especialidad":"ESPECIALIDAD_FICTICIA","duracionEstimada":123,' +
        '"animo":"ANIMO_FICTICIO"}',
    ].join('\n');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: mensajeSistema(
          'Clasificá tickets de soporte técnico. Respondé SOLO un JSON válido con las claves ' +
            'categoria, prioridad, especialidad, duracionEstimada y animo, en español de Argentina.\n\n' +
            'Categorías existentes en SolidOps (leídas de la base; usá SOLO una de estas):\n' +
            `${describirCategorias(opciones.categorias)}\n\n` +
            `Prioridades existentes en SolidOps (leídas de la base): ${opciones.prioridades
              .map(etiquetaPrioridad)
              .join(', ')}.\n\n` +
            'Reglas de prioridad: si el texto dice "urgente", "no podemos trabajar", ' +
            '"sin sistema" o "parado" → prioridad "alta". ' +
            'Si el texto dice "urgente", el campo "animo" debe ser "apurado".\n\n' +
            `Especialidades de técnicos existentes en SolidOps (leídas de la base; usá SOLO una): ${
              opciones.especialidades.join(', ') || '(sin especialidades cargadas)'
            }.\n\n` +
            `El campo "animo" debe ser UNO de: ${ANIMOS.join(', ')}. ` +
            'El campo "duracionEstimada" es un número entero de minutos (por ejemplo 45).\n\n' +
            REGLA_SIN_DATOS +
            '\n\n' +
            `Si lo que inferís no coincide con esas listas, escribí "${SIN_COINCIDENCIA}" en ese campo.\n\n` +
            ejemploClasificacion,
        ),
      },
      { role: 'user', content: conRefuerzo(`Clasificá este ticket:\n\n${text}`) },
    ];
    const result = await this.guardedChat(
      messages,
      schema,
      this.cfg('ai.modelSmart', this.cfg('ai.modelFast', 'qwen3:4b')),
      user.id,
      feature,
    );
    const parsed = extractJsonObject(result.response);
    const prioridadAltaDisponible = opciones.prioridades.some(
      (p) => normalizeText(p) === 'alta',
    );
    const ai = parsed
      ? {
          ...parsed,
          categoria: this.coincidirOpcion(parsed.categoria, opciones.categorias),
          prioridad:
            esUrgente && prioridadAltaDisponible
              ? etiquetaPrioridad('alta')
              : this.coincidirOpcion(parsed.prioridad, opciones.prioridades, true),
          especialidad: this.coincidirOpcion(parsed.especialidad, opciones.especialidades),
          animo: esUrgente ? 'apurado' : this.coincidirOpcion(parsed.animo, [...ANIMOS]),
          duracionEstimada: this.minutos(parsed.duracionEstimada),
        }
      : parsed;
    return {
      ticket: this.ticketSnapshot(ticket),
      ai,
      raw: parsed ? null : result.response.slice(0, 600),
      // Texto exacto del modelo, sin parsear ni prefijos de aviso.
      textoModelo: result.textoModelo,
      metrics: result.metrics,
      ...(result.aviso ? { aviso: result.aviso } : {}),
    };
  }

  // Borrador para el panel del ticket. NUNCA crea mensajes ni despacha email o
  // WhatsApp: devuelve texto para que la persona lo revise, edite y envíe con
  // el botón normal del ticket.
  async replyDraft(
    id: string,
    user: AuthenticatedUser,
    opciones: { tono?: 'base' | 'corto' | 'formal'; borrador?: string } = {},
    feature = 'ticket_reply',
  ) {
    this.ensureEnabled();
    const { ticket, text, contacto } = await this.ticketContext(id, user, true);
    const automatico = isAutomaticNotice({
      source: ticket.source,
      subjectKey: ticket.subjectKey,
      messages: ticket.messages?.map((m) => ({ authorType: m.authorType })),
    });
    if (automatico) {
      throw new ConflictException('Parece un aviso automático: no se propone respuesta');
    }

    const tono = opciones.tono || 'base';
    const ajuste =
      tono === 'corto'
        ? 'Hacelo aún más breve, sin perder el tono cordial.'
        : tono === 'formal'
          ? 'Usá un tono más formal, siempre en español de Argentina.'
          : 'Mantené un tono cordial y breve.';
    const borradorActual = opciones.borrador?.trim();
    const reglaRespuesta =
      'Escribí SOLO el mensaje que el equipo le enviaría al cliente ahora, de 2 a 5 oraciones. ' +
      'No copies la conversación. No repitas "CLIENTE:", "EQUIPO SOLIDO:", "BOT:", el menú del bot ' +
      'ni encabezados copiados como "Cliente:" o "Contacto:". ' +
      'No imites los mensajes automáticos del bot: el menú de opciones, el aviso de fuera de horario ' +
      'ni el "Registramos tu consulta" que aparecen etiquetados como BOT:. ' +
      'Incluí SOLO hechos que aparezcan en la conversación del ticket: no inventes acciones, ' +
      'horarios, visitas, precios, plazos ni resultados que no estén escritos ahí. ' +
      'No afirmes que enviaste o resolviste algo si el hilo sólo lo pide o lo menciona como pendiente. ' +
      'Si hace falta un dato que no está, dejá un marcador visible entre corchetes, por ejemplo [completar horario]. ' +
      'Escribilo en segunda persona, hablándole directamente al cliente: no lo describas en tercera persona. ' +
      'Basate únicamente en el hilo del ticket actual; no reutilices frases de otras conversaciones. ' +
      'Respondé SOLO un JSON válido con la clave "respuesta" y ese mensaje como valor.';
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: mensajeSistema(
          reglaRespuesta +
            '\n\n' +
            'No incluyas saludo ni firma: el sistema los agrega automáticamente con el contacto real ' +
            'de la base. No repitas el nombre del contacto ni datos internos (estado, prioridad, ' +
            'categoría, cliente) en el cuerpo: sólo lo que dice la conversación.\n\n' +
            ajuste +
            (borradorActual ? `\n\nBorrador anterior que hay que ajustar:\n${borradorActual}` : ''),
        ),
      },
      { role: 'user', content: conRefuerzo(`Ticket:\n\n${text}`) },
    ];

    const generar = (mensajes: ChatMessage[]) =>
      this.guardedChat(
        mensajes,
        REPLY_SCHEMA,
        this.cfg('ai.modelFast', 'qwen3:4b'),
        user.id,
        feature,
      );
    const respuestaDe = (salida: string): string => {
      const parsed = extractJsonObject(salida);
      return typeof parsed?.respuesta === 'string' ? parsed.respuesta.trim() : '';
    };
    // El saludo ya incluye el contacto real; el cuerpo no debe repetirlo ni
    // mencionar la razón social que viene de la base (no está en la conversación).
    const nombresInternos = [contacto, ticket.customer?.name]
      .filter((n): n is string => !!n && n.trim().length >= 4)
      .map((n) => normalizeText(n));
    const mencionaInternos = (texto: string): boolean =>
      nombresInternos.some((n) => normalizeText(texto).includes(n));
    const esInvalida = (texto: string): boolean =>
      !texto || copiaHiloDelTicket(texto, text) || inventaDatoDelHilo(texto, text) || mencionaInternos(texto);

    let result = await generar(messages);
    let respuesta = respuestaDe(result.response);
    let intentos = 1;
    if (esInvalida(respuesta)) {
      // Un solo reintento con una instrucción más explícita. No se reintentan
      // errores de red/timeout: esos ya los maneja guardedChat.
      const reintento: ChatMessage[] = [
        ...messages.slice(0, -1),
        {
          role: 'user',
          content: conRefuerzo(
            'La respuesta anterior copió el hilo, invirtió un dato o salió vacía. Reescribila con ' +
              'palabras propias, sin transcripto, sin menú del bot, sin encabezados, sin repetir ' +
              'el nombre del contacto y sin plazos ni datos que no estén en el ticket. ' +
              'Si necesitás un dato, dejá [completar dato]. ' +
              'Debe ser un mensaje nuevo de 2 a 5 oraciones.\n\nTicket:\n\n' +
              text,
          ),
        },
      ];
      result = await generar(reintento);
      respuesta = respuestaDe(result.response);
      intentos = 2;
    }
    if (esInvalida(respuesta)) {
      this.logger.debug(`Borrador rechazado en ${publicTicketNumber(ticket.ticketNumber, ticket.createdAt)}: ${respuesta}`);
      throw new BadRequestException('No se pudo generar un borrador útil, probá de nuevo');
    }

    let lineas = stripThinkTags(respuesta)
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim());
    // Sólo se descarta una línea que sea únicamente el saludo ("Hola Nombre,"),
    // no una frase que empiece con "Hola," y continúe con contenido.
    if (/^(hola|estimad|buenos? d)[^.!?]{0,60}[,:]$/i.test(lineas[0] || '')) lineas = lineas.slice(1);
    // Si el modelo puso "Hola," dentro del cuerpo, se quita sólo ese saludo.
    if (lineas[0]) {
      lineas[0] = lineas[0]
        .replace(/^(hola|estimad[oa]?|buenos? d[ií]as?)\s*[,:]?\s*/i, '')
        .trim()
        .replace(/^([a-záéíóúñ])/, (c) => c.toUpperCase());
      if (!lineas[0]) lineas = lineas.slice(1);
    }
    while (lineas.length && /^(equipo solido|gracias|saludos|atte\.?)/i.test(lineas[lineas.length - 1] || '')) {
      lineas = lineas.slice(0, -1);
    }
    const cuerpo = lineas.join('\n').trim();
    if (!cuerpo) {
      this.logger.debug(`Borrador sin cuerpo tras quitar saludo y firma: ${respuesta}`);
      throw new BadRequestException('No se pudo generar un borrador útil, probá de nuevo');
    }
    const saludo = contacto ? `Hola ${contacto},` : 'Hola,';
    const draft = `${saludo}\n\n${cuerpo}\n\n${FIRMA_BORRADOR}`;

    return {
      ticket: this.ticketSnapshot(ticket),
      contacto: contacto ?? null,
      draft,
      intentos,
      textoModelo: result.textoModelo,
      metrics: result.metrics,
      ...(result.aviso ? { aviso: result.aviso } : {}),
    };
  }

  // Los títulos automáticos de WhatsApp son genéricos ("WhatsApp: Red /
  // Conectividad") y no discriminan: en esos casos se compara sólo el primer
  // mensaje real del cliente.
  private esTituloGenerico(titulo?: string | null): boolean {
    return /^\s*whatsapp\s*:/i.test(titulo ?? '');
  }

  // Comparación compartida por "relacionados" y por la búsqueda de
  // antecedentes: los títulos genéricos de WhatsApp no discriminan, así que se
  // usa el primer mensaje real del cliente.
  private textoComparable(ticket: Awaited<ReturnType<TicketsService['findOne']>>): {
    texto: string;
    termino: string;
  } {
    const tituloComparable = this.esTituloGenerico(ticket.title) ? '' : ticket.title;
    const texto = [tituloComparable, this.primerMensajeCliente(ticket)]
      .filter(Boolean)
      .join(' ')
      .trim();
    const termino =
      texto.split(/\s+/).find((p) => p.length >= 4)?.replace(/[^\p{L}\p{N}]/gu, '') || texto;
    return { texto, termino };
  }

  private sqlTextoComparable(): { titulo: string; vector: string } {
    const primerMsg = `(SELECT tm.body FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.author_type = 'cliente' ORDER BY tm.created_at ASC LIMIT 1)`;
    const titulo =
      `CASE WHEN lower(trim(coalesce(t.title, ''))) LIKE 'whatsapp:%' THEN '' ` +
      `ELSE coalesce(t.title, '') END`;
    return {
      titulo,
      vector: `to_tsvector('spanish', ${titulo} || ' ' || coalesce(${primerMsg}, ''))`,
    };
  }

  // Paso 1 de IA 04. Búsqueda pura en base de datos (sin modelo): tickets
  // cerrados, de personas, con al menos un mensaje del equipo, ordenados con
  // los del MISMO cliente primero y hasta 5. Se descartan los que no tienen un
  // parecido mínimo con el problema actual. Todo texto se enmascara antes de
  // salir de acá: ninguna contraseña llega al prompt ni al frontend.
  async findPrecedents(id: string, user: AuthenticatedUser, feature = 'ticket_precedents') {
    this.ensureEnabled();
    const inicio = Date.now();
    try {
      const actual = await this.tickets.findOne(id, user);
      const { texto, termino } = this.textoComparable(actual);
      const textoActual = [texto, actual.category].filter(Boolean).join(' ');
      const precedentes: Precedente[] = [];

      const qb = this.dataSource
        .getRepository(Ticket)
        .createQueryBuilder('t')
        .select([
          't.id',
          't.title',
          't.ticketNumber',
          't.createdAt',
          't.status',
          't.customerId',
          't.category',
          't.source',
          't.subjectKey',
        ])
        .where('t.id <> :precedenteId', { precedenteId: id })
        .andWhere('t.status = :precedenteEstado', { precedenteEstado: TicketStatus.CERRADO })
        .andWhere('t.shadow = :precedenteShadow', { precedenteShadow: false })
        .andWhere('t.merged_into_id IS NULL')
        .andWhere(
          `EXISTS (SELECT 1 FROM ticket_messages tm WHERE tm.ticket_id = t.id ` +
            `AND tm.author_type = :precedenteAutor)`,
          { precedenteAutor: TicketAuthorType.TECNICO },
        )
        .addSelect(
          'CASE WHEN t.customer_id = :precedenteCustomer THEN 0 ELSE 1 END',
          'mismo_cliente',
        )
        .addOrderBy('mismo_cliente', 'ASC')
        .setParameter('precedenteCustomer', actual.customerId);

      if (!user.permissions?.includes('tickets:assign') && !user.technicianId) {
        qb.andWhere('t.created_by_user_id = :precedenteUid', { precedenteUid: user.id });
      }
      excludeAutomaticNotices(qb, 't', 'precedenteAuto');

      if (texto) {
        const { vector } = this.sqlTextoComparable();
        qb.andWhere(
          `(${vector} @@ plainto_tsquery('spanish', :precedenteQ) OR ` +
            `CASE WHEN lower(trim(coalesce(t.title, ''))) LIKE 'whatsapp:%' THEN '' ` +
            `ELSE coalesce(t.title, '') END ILIKE :precedenteIlike)`,
          { precedenteQ: texto, precedenteIlike: `%${termino}%` },
        );
        qb.addSelect(`ts_rank(${vector}, plainto_tsquery('spanish', :precedenteQ))`, 'precedente_rank');
        qb.addOrderBy('precedente_rank', 'DESC');
      }
      qb.addOrderBy('t.created_at', 'DESC').take(5);

      const filas = await qb.getMany();
      for (const fila of filas) {
        const mensajes = await this.dataSource.getRepository(TicketMessage).find({
          where: { ticketId: fila.id, authorType: TicketAuthorType.TECNICO },
          order: { createdAt: 'ASC' },
          take: 4,
        });
        const cuerpos = mensajes
          .map((m) => maskSecrets(cleanTicketText(m.body)))
          .filter((c) => c.length >= 10);
        if (!cuerpos.length) continue;
        // Relevancia mínima: un ticket cerrado parecido sólo por el texto
        // full-text pero sin tokens de dominio en común no se usa.
        const parecido = parecidoTextos(
          textoActual,
          [fila.title, fila.category, ...cuerpos].filter(Boolean).join(' '),
        );
        if (parecido < SIMILITUD_MINIMA) continue;
        precedentes.push({
          id: fila.id,
          numero: publicTicketNumber(fila.ticketNumber, fila.createdAt),
          titulo: maskSecrets(fila.title),
          estado: fila.status,
          fecha: fila.createdAt.toISOString(),
          mismoCliente: fila.customerId === actual.customerId && !!actual.customerId,
          mensajesEquipo: cuerpos,
        });
      }

      await this.usage.record({
        userId: user.id,
        feature,
        provider: this.chatProvider.name,
        model: this.cfg('ai.modelFast', 'qwen3:4b'),
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - inicio,
        tokensPerSecond: null,
        ok: true,
      });
      return { ticket: this.ticketSnapshot(actual), precedentes };
    } catch (e) {
      await this.usage.record({
        userId: user.id,
        feature,
        provider: this.chatProvider.name,
        model: this.cfg('ai.modelFast', 'qwen3:4b'),
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - inicio,
        tokensPerSecond: null,
        ok: false,
        errorMessage: (e as Error).message,
      });
      throw this.unavailable(e);
    }
  }

  private parsearPasos(
    respuesta: string,
    fuentes: Precedente[],
    contexto: string,
    hiloActual: string,
  ): { pasos: PasoSolucion[]; descartados: string[] } {
    const parsed = extractJsonObject(respuesta);
    const crudos = Array.isArray(parsed?.pasos) ? parsed.pasos : [];
    const numeros = new Set(fuentes.map((f) => f.numero));
    const vistos = new Set<string>();
    const pasos: PasoSolucion[] = [];
    const descartados: string[] = [];
    for (const item of crudos) {
      if (typeof item !== 'string') continue;
      const texto = stripThinkTags(item).replace(/\s+/g, ' ').trim();
      if (texto.length < 15 || texto.length > 400) continue;
      const citas = citasTicket(texto);
      const validas = citas.filter((c) => numeros.has(c));
      // Descarta paso sin fuente o que cite un ticket que no está en la lista.
      if (!validas.length || validas.length !== citas.length) {
        descartados.push(texto);
        continue;
      }
      if (copiaHiloDelTicket(texto, contexto) || inventaDatoDelHilo(texto, contexto)) {
        descartados.push(texto);
        continue;
      }
      const fuente = fuentes.find((f) => f.numero === validas[0])!;
      const origen = fuente.mismoCliente ? 'mismo cliente' : 'otro cliente';
      // Un antecedente de otro cliente se usa sólo en forma genérica: si
      // arrastra un nombre que no está en el ticket actual, se descarta.
      if (origen === 'otro cliente' && nombresPropiosExternos(texto, hiloActual).length) {
        descartados.push(texto);
        continue;
      }
      const clave = normalizeText(texto);
      if (vistos.has(clave)) continue;
      pasos.push({
        texto,
        origen,
        fuente: { id: fuente.id, numero: fuente.numero, titulo: fuente.titulo },
      });
      vistos.add(clave);
      if (pasos.length >= 5) break;
    }
    return { pasos, descartados };
  }

  // Paso 2 de IA 04. Sólo lectura: genera pasos a partir de los antecedentes
  // encontrados sin IA. Nunca guarda mensajes ni envía respuestas.
  async solution(id: string, user: AuthenticatedUser, feature = 'ticket_solution') {
    this.ensureEnabled();
    const inicio = Date.now();
    const { ticket, text } = await this.ticketContext(id, user, true);
    const base = { ticket: this.ticketSnapshot(ticket) };
    // Incluye cliente/contacto de la base para no confundir su nombre con un
    // nombre propio proveniente de otro cliente.
    const hiloActual = [text, base.ticket.cliente, base.ticket.contacto]
      .filter(Boolean)
      .join(' ');
    const automatico = isAutomaticNotice({
      source: ticket.source,
      subjectKey: ticket.subjectKey,
      messages: ticket.messages?.map((m) => ({ authorType: m.authorType })),
    });
    if (automatico) {
      return {
        ...base,
        sinAntecedentes: true,
        motivo: 'Parece un aviso automático: no se propone solución para el cliente.',
        pasos: [] as PasoSolucion[],
        fuentes: [] as Precedente[],
        intentos: 0,
        metrics: { seconds: Number(((Date.now() - inicio) / 1000).toFixed(2)) },
      };
    }

    const { precedentes } = await this.findPrecedents(id, user, 'ticket_precedents');
    const fuentes = precedentes.filter(
      (p) =>
        p.estado === TicketStatus.CERRADO &&
        p.mensajesEquipo.some((m) => m.trim().length >= 15),
    );
    if (!fuentes.length) {
      return {
        ...base,
        sinAntecedentes: true,
        motivo: 'No hay antecedentes cerrados con mensajes del equipo que sirvan de fuente.',
        pasos: [] as PasoSolucion[],
        fuentes: [] as Precedente[],
        intentos: 0,
        metrics: { seconds: Number(((Date.now() - inicio) / 1000).toFixed(2)) },
      };
    }

    const contextoFuentes = fuentes
      .map(
        (f, i) =>
          `FUENTE ${i + 1}: ${f.numero}\n` +
          `Cliente de la fuente: ${f.mismoCliente ? 'mismo cliente' : 'otro cliente'}\n` +
          `Título: ${f.titulo}\n` +
          `Mensajes del equipo (texto enmascarado):\n- ${f.mensajesEquipo.join('\n- ')}`,
      )
      .join('\n\n');
    const reglaPasos =
      'A partir de los antecedentes cerrados, proponé pasos concretos para el ticket actual. ' +
      'Devolvé SOLO un JSON válido con la clave "pasos": un array de entre 1 y 5 textos. ' +
      'Cada paso debe ser una acción breve en español de Argentina, empezar con un verbo ' +
      'y citar al final su ticket fuente exacto entre paréntesis, por ejemplo ' +
      '"(Fuente: TK-AAAA-NNNNN)". Usá SOLO las fuentes listadas: no inventes datos, ' +
      'horarios, resultados ni acciones que no estén en los mensajes del equipo. ' +
      'Cuando la fuente sea de OTRO cliente, escribí la acción en forma general: ' +
      'no incluyas proveedores, IPs, nombres de equipos, personas ni direcciones de ese cliente. ' +
      'Sólo podés nombrar lo que también aparezca en el ticket actual. ' +
      'No repitas saludos, firmas, menú del bot ni credenciales (ya están enmascaradas). ' +
      'Si una fuente no aporta una acción concreta, ignorala.';
    const messages: ChatMessage[] = [
      { role: 'system', content: mensajeSistema(reglaPasos) },
      {
        role: 'user',
        content: conRefuerzo(
          `Ticket actual:\n\n${text}\n\nAntecedentes cerrados (texto enmascarado):\n\n${contextoFuentes}`,
        ),
      },
    ];
    const generar = (mensajes: ChatMessage[]) =>
      this.guardedChat(
        mensajes,
        SOLUTION_SCHEMA,
        this.cfg('ai.modelSmart', 'qwen3:4b'),
        user.id,
        feature,
      );

    let result = await generar(messages);
    let parseo = this.parsearPasos(result.response, fuentes, contextoFuentes, hiloActual);
    let pasos = parseo.pasos;
    let intentos = 1;
    // Un solo reintento: sirve tanto si no hubo pasos válidos como si hubo
    // pasos descartados por citas inválidas o nombres de otro cliente.
    if (!pasos.length || parseo.descartados.length) {
      const rechazados = parseo.descartados.slice(0, 5).map((d) => `- ${d}`).join('\n');
      result = await generar([
        ...messages.slice(0, -1),
        {
          role: 'user',
          content: conRefuerzo(
            'La respuesta anterior no sirvió. Reescribí los pasos rechazados como acciones ' +
              'generales, sin nombres propios de otros clientes y citando una fuente de la lista. ' +
              'Devolvé SOLO el JSON con "pasos": un array de 1 a 5 acciones que empiecen con un ' +
              'verbo y terminen con "(Fuente: TK-AAAA-NNNNN)".\n\n' +
              (rechazados ? `Pasos rechazados:\n${rechazados}\n\n` : '') +
              `Ticket actual:\n\n${text}\n\nAntecedentes:\n\n${contextoFuentes}`,
          ),
        },
      ]);
      parseo = this.parsearPasos(result.response, fuentes, contextoFuentes, hiloActual);
      pasos = parseo.pasos;
      intentos = 2;
    }

    return {
      ...base,
      sinAntecedentes: pasos.length === 0,
      motivo: pasos.length ? undefined : 'Las fuentes no permitieron generar un paso útil.',
      pasos,
      fuentes: fuentes.map((f) => ({
        id: f.id,
        numero: f.numero,
        titulo: f.titulo,
        mismoCliente: f.mismoCliente,
        origen: f.mismoCliente ? 'mismo cliente' : 'otro cliente',
        fecha: f.fecha,
      })),
      intentos,
      // No devolvemos el texto crudo del modelo: puede contener pasos
      // rechazados con nombres propios de otro cliente.
      metrics: result.metrics,
      ...(result.aviso ? { aviso: result.aviso } : {}),
    };
  }

  // "Posibles relacionados": mismo cliente, ±90 días alrededor de la creación
  // del ticket abierto, título/primer mensaje parecido (FTS de Postgres). No hay
  // tabla de embeddings de tickets, así que no hay similitud vectorial todavía.
  // Sólo lectura.
  async relatedTickets(id: string, user: AuthenticatedUser, feature = 'ticket_related') {
    this.ensureEnabled();
    const inicio = Date.now();
    try {
      const actual = await this.tickets.findOne(id, user);
      const creado = new Date(actual.createdAt);
      const automatico = isAutomaticNotice({
        source: actual.source,
        subjectKey: actual.subjectKey,
        messages: actual.messages?.map((m) => ({ authorType: m.authorType })),
      });
      const relacionados: Array<{
        id: string;
        numero: string;
        titulo: string;
        estado: string;
        fecha: string;
      }> = [];

      let consulta = 'Sin customer_id en el ticket: no se hizo la búsqueda.';
      if (actual.customerId) {
        const { texto, termino } = this.textoComparable(actual);
        consulta =
          `customer_id = ${actual.customerId} · ±90 días desde la creación del ticket ` +
          `(${creado.toISOString()}) · ` +
          `shadow = false · merged_into_id IS NULL · sin avisos automáticos · ` +
          `to_tsvector('spanish', título comparable + primer mensaje del cliente) @@ ` +
          `plainto_tsquery('spanish', "${texto || '(sin texto)'}") OR ` +
          `título comparable ILIKE "%${termino}%"`;
        // Esta información va al log del backend en debug, nunca a la interfaz.
        this.logger.debug(`Consulta de tickets relacionados: ${consulta}`);
        const qb = this.dataSource
          .getRepository(Ticket)
          .createQueryBuilder('t')
          .select([
            't.id',
            't.title',
            't.ticketNumber',
            't.createdAt',
            't.status',
            't.customerId',
          ])
          .where('t.customer_id = :relCustomer', { relCustomer: actual.customerId })
          .andWhere('t.id <> :relId', { relId: id })
          .andWhere('t.created_at BETWEEN :relDesde AND :relHasta', {
            relDesde: new Date(creado.getTime() - 90 * 24 * 60 * 60 * 1000),
            relHasta: new Date(creado.getTime() + 90 * 24 * 60 * 60 * 1000),
          })
          .andWhere('t.shadow = :relShadow', { relShadow: false })
          .andWhere('t.merged_into_id IS NULL');

        if (!user.permissions?.includes('tickets:assign') && !user.technicianId) {
          qb.andWhere('t.created_by_user_id = :relUid', { relUid: user.id });
        }
        excludeAutomaticNotices(qb, 't', 'relAuto');

        if (texto) {
          const { titulo: tituloSql, vector } = this.sqlTextoComparable();
          qb.andWhere(
            `(${vector} @@ plainto_tsquery('spanish', :relQ) OR ${tituloSql} ILIKE :relIlike)`,
            { relQ: texto, relIlike: `%${termino}%` },
          );
          qb.addSelect(`ts_rank(${vector}, plainto_tsquery('spanish', :relQ))`, 'rel_rank');
          // TypeORM normaliza el alias a minúsculas al ordenar: usamos el mismo
          // nombre en minúsculas en addSelect y en orderBy.
          qb.orderBy('rel_rank', 'DESC');
        }
        qb.addOrderBy('t.created_at', 'DESC').take(3);

        const filas = await qb.getMany();
        for (const fila of filas) {
          relacionados.push({
            id: fila.id,
            numero: publicTicketNumber(fila.ticketNumber, fila.createdAt),
            titulo: fila.title,
            estado: fila.status,
            fecha: fila.createdAt.toISOString(),
          });
        }
      }

      await this.usage.record({
        userId: user.id,
        feature,
        provider: this.chatProvider.name,
        model: this.cfg('ai.modelFast', 'qwen3:4b'),
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - inicio,
        tokensPerSecond: null,
        ok: true,
      });
      return {
        ticket: this.ticketSnapshot(actual),
        automaticNotice: automatico,
        related: relacionados,
        metrics: { seconds: Number(((Date.now() - inicio) / 1000).toFixed(2)) },
      };
    } catch (e) {
      await this.usage.record({
        userId: user.id,
        feature,
        provider: this.chatProvider.name,
        model: this.cfg('ai.modelFast', 'qwen3:4b'),
        tokensIn: 0,
        tokensOut: 0,
        durationMs: Date.now() - inicio,
        tokensPerSecond: null,
        ok: false,
        errorMessage: (e as Error).message,
      });
      throw this.unavailable(e);
    }
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
