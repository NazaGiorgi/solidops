import {
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
import { TicketAuthorType, TicketPriority } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Ticket } from '../../entities/ticket.entity';
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
  cleanTicketText,
  cosineSimilarity,
  extractJsonObject,
  firstValues,
  isProbablyEnglish,
  normalizeText,
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

  private async ticketContext(id: string, actor: AuthenticatedUser) {
    const ticket = await this.tickets.findOne(id, actor);
    const relacionados = [...(ticket.messages || []), ...(ticket.mergedMessages || [])];

    // El autor sale de la base, no del texto. Sólo dos etiquetas visibles para
    // el modelo: mensajes del cliente y mensajes del equipo SolidOps (técnico o
    // sistema). Así no confunde al técnico que escribe con el cliente.
    const messageBodies = relacionados
      .map((m) => {
        const body = cleanTicketText(m.body);
        if (!body) return '';
        const etiqueta =
          m.authorType === TicketAuthorType.CLIENTE ? 'CLIENTE' : 'EQUIPO SOLIDO';
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
    const { ticket, text, contacto } = await this.ticketContext(id, user);
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
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: mensajeSistema(
          'Redactá un borrador de respuesta para el cliente a partir del hilo del ticket.\n\n' +
            'No inventes horarios, visitas, precios, plazos ni acciones que no estén escritas en el ticket. ' +
            'Si hace falta un dato que no está, dejá un marcador visible entre corchetes, por ejemplo [completar horario].\n\n' +
            'No incluyas saludo ni firma: el sistema los agrega con el contacto real de la base y la firma "Equipo Solido".\n\n' +
            ajuste +
            (borradorActual ? `\n\nBorrador anterior que hay que ajustar:\n${borradorActual}` : ''),
        ),
      },
      { role: 'user', content: conRefuerzo(`Ticket:\n\n${text}`) },
    ];
    const result = await this.guardedChat(
      messages,
      undefined,
      this.cfg('ai.modelFast', 'qwen3:4b'),
      user.id,
      feature,
    );

    let lineas = stripThinkTags(result.textoModelo)
      .trim()
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim());
    if (/^(hola|estimad|buenos? d)/i.test(lineas[0] || '')) lineas = lineas.slice(1);
    while (lineas.length && /^(equipo solido|gracias|saludos|atte\.?)/i.test(lineas[lineas.length - 1] || '')) {
      lineas = lineas.slice(0, -1);
    }
    const cuerpo = lineas.join('\n').trim();
    const saludo = contacto ? `Hola ${contacto},` : 'Hola,';
    const draft = `${saludo}\n\n${cuerpo}\n\n${FIRMA_BORRADOR}`;

    return {
      ticket: this.ticketSnapshot(ticket),
      contacto: contacto ?? null,
      draft,
      textoModelo: result.textoModelo,
      metrics: result.metrics,
      ...(result.aviso ? { aviso: result.aviso } : {}),
    };
  }

  // "Posibles relacionados": mismo cliente, últimos 90 días, título/primer
  // mensaje parecido (FTS de Postgres). No hay tabla de embeddings de tickets,
  // así que no hay similitud vectorial disponible todavía. Sólo lectura.
  async relatedTickets(id: string, user: AuthenticatedUser, feature = 'ticket_related') {
    this.ensureEnabled();
    const inicio = Date.now();
    try {
      const actual = await this.tickets.findOne(id, user);
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

      if (actual.customerId) {
        const texto = [actual.title, this.primerMensajeCliente(actual)]
          .filter(Boolean)
          .join(' ')
          .trim();
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
          .andWhere('t.created_at >= :relDesde', {
            relDesde: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          })
          .andWhere('t.shadow = :relShadow', { relShadow: false })
          .andWhere('t.merged_into_id IS NULL');

        if (!user.permissions?.includes('tickets:assign') && !user.technicianId) {
          qb.andWhere('t.created_by_user_id = :relUid', { relUid: user.id });
        }
        excludeAutomaticNotices(qb, 't', 'relAuto');

        if (texto) {
          const primerMsg = `(SELECT tm.body FROM ticket_messages tm WHERE tm.ticket_id = t.id AND tm.author_type = 'cliente' ORDER BY tm.created_at ASC LIMIT 1)`;
          const vector = `to_tsvector('spanish', coalesce(t.title, '') || ' ' || coalesce(${primerMsg}, ''))`;
          const termino =
            texto.split(/\s+/).find((p) => p.length >= 4)?.replace(/[^\p{L}\p{N}]/gu, '') || texto;
          qb.andWhere(
            `(${vector} @@ plainto_tsquery('spanish', :relQ) OR t.title ILIKE :relIlike OR t.subject_key ILIKE :relIlike)`,
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
