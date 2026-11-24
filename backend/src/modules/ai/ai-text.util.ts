// Helpers puros (sin IO) para preparar texto y parsear respuestas del modelo.
// Están separados para poder probarlos con Jest sin levantar Nest.

// qwen3 puede "pensar en voz alta". Aunque enviamos think:false, recortamos
// cualquier bloque <think>...</think> que se cuele en la respuesta.
export function stripThinkTags(input: string): string {
  return input
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    // qwen3:4b suele emitir el razonamiento SIN la etiqueta de apertura pero
    // con el cierre (p.ej. "...llo.</think>\n\nrespuesta"). Sin este recorte el
    // razonamiento se filtra al usuario aunque think:false vaya en la request.
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

// Quita firmas y texto citado de mensajes de email antes de mandarlos al modelo.
export function cleanTicketText(input?: string | null): string {
  if (!input) return '';
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    // Texto citado.
    if (/^>+/.test(t)) continue;
    // Marcadores fuertes de firma / inicio del mensaje citado: cortamos acá.
    if (/^(--|__)\s*$/.test(t)) break;
    if (/^(enviado desde|sent from my|on .+ wrote:|el \d{1,2} de \w+ \d{4}.+escribió:)/i.test(t)) break;
    if (/^(saludos|atte\.?|un saludo|quedo a la espera)/i.test(t) && t.length < 60) break;
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Estimación conservadora: ~3 caracteres por token en español. El objetivo es
// no pasarnos del num_ctx del modelo con tickets largos.
export function truncateForContext(text: string, numCtx: number): string {
  const maxChars = Math.max(1000, Math.floor(numCtx * 3));
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}\n[... texto truncado por límite de contexto]`;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function firstValues(values: number[], count = 5): number[] {
  return values.slice(0, count).map((v) => Number(v.toFixed(6)));
}

// Normaliza para comparar opciones ("Crítica" == "critica" == "CRITICA").
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PALABRAS_ES = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'que',
  'con', 'por', 'para', 'en', 'al', 'se', 'su', 'sus', 'mi', 'tu', 'nos', 'me', 'te',
  'es', 'son', 'soy', 'esta', 'este', 'estos', 'estas', 'no', 'si', 'pero', 'como',
  'cuando', 'donde', 'quien', 'cual', 'mas', 'menos', 'muy', 'tambien', 'ya', 'debe',
  'responder', 'respuesta', 'respondé', 'argentina', 'claro', 'breve', 'asistente',
  'soporte', 'tecnico', 'ticket', 'cliente', 'equipo', 'red', 'impresora', 'hola',
  'ayuda', 'necesita', 'problema', 'solucion', 'paso', 'reiniciar', 'revisar', 'estado',
  'nuevo', 'normal', 'alta', 'baja', 'critica', 'categoria', 'prioridad', 'especialidad',
  'duracion', 'estimada', 'animo', 'pedido', 'probado', 'falta', 'sirve', 'gracias',
]);

const PALABRAS_EN = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'from', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'this', 'that',
  'these', 'those', 'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their', 'he',
  'she', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
  'will', 'may', 'might', 'must', 'need', 'needs', 'want', 'wants', 'ask', 'asked',
  'answer', 'response', 'provide', 'based', 'given', 'however', 'therefore', 'not',
  'yes', 'okay', 'let', 'me', 'user', 'query', 'question', 'device', 'router', 'printer',
  'help', 'please', 'first', 'next', 'finally', 'summary', 'classify', 'category',
  'priority', 'estimate', 'output', 'only', 'valid', 'json', 'single', 'sentence',
]);

// Heurística conservadora: sólo marcamos "otro idioma" cuando hay al menos dos
// palabras funcionales inglesas y superan a las españolas. Los acentos y ¿/¡
// descartan el inglés de entrada, y las respuestas muy cortas no se marcan.
export function isProbablyEnglish(input: string): boolean {
  const text = stripThinkTags(input).toLowerCase();
  if (/[áéíóúñü¿¡]/.test(text)) return false;
  const words = text.match(/[a-z]+/g) || [];
  let es = 0;
  let en = 0;
  for (const palabra of words) {
    const variantes = [palabra];
    if (palabra.length > 3 && palabra.endsWith('s')) variantes.push(palabra.slice(0, -1));
    if (variantes.some((v) => PALABRAS_ES.has(v))) es += 1;
    if (variantes.some((v) => PALABRAS_EN.has(v))) en += 1;
  }
  return en >= 2 && en > es;
}

// El modelo a veces explica la ausencia de datos en lugar de dejar el campo
// vacío. Lo convertimos a "Sin datos" para que la salida sea consistente.
const EXPLICACION_SIN_DATOS =
  /^(?:no se (?:ha|haya)\s+)?(?:realizado|proporcionado|especificado|informado|hecho|indicado)\b|^no se especifica\b|^no se (?:proporciona|proporcionaron|indica|indican|informa|informan)\b|^no hay (?:informacion|datos)\b/;

export function sinDatosSiCorresponde(value: unknown): string {
  const texto = String(value ?? '').trim();
  if (!texto) return '';
  return EXPLICACION_SIN_DATOS.test(normalizeText(texto)) ? 'Sin datos' : texto;
}

// Los modelos chicos a veces devuelven JSON con texto alrededor o en code fence.
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = stripThinkTags(text)
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Detecta que el modelo "copió y pegó" el hilo en lugar de redactar. Se usa
// sólo sobre la respuesta ya parseada, antes de armar el borrador con saludo
// y firma propios. Es conservadora: cualquier frase de 16 palabras seguidas
// que aparezca en el hilo se considera copia.
export function copiaHiloDelTicket(respuesta: string, hilo: string): boolean {
  const salida = stripThinkTags(respuesta).trim();
  if (!salida) return true;

  // Marcadores del transcript y del menú del bot que nunca deben aparecer en
  // un mensaje listo para enviar al cliente.
  if (/(^|\n)\s*(cliente|contacto)\s*:/i.test(salida)) return true;
  if (/\bequipo\s+solid[oa]\s*:/i.test(salida)) return true;
  if (/(^|\n)\s*[1-9](?:\uFE0F)?\u20E3\s+\S/m.test(salida)) return true;
  if (/(^|\n)\s*[1-9][\).-]\s+\S/m.test(salida)) return true;
  const normalizada = normalizeText(salida);
  if (/\[cid:/i.test(salida) || normalizada.includes('cid part')) return true;
  if (normalizada.includes('elegi una opcion escribiendo el numero')) return true;
  // Frases propias de los mensajes automáticos del bot: nunca van en un
  // borrador escrito por el equipo, aunque el modelo las inventara de memoria.
  if (
    /(registramos tu consulta|fuera de (nuestro )?horario de atencion|plantilla aprobada|no se pudo enviar por whatsapp)/.test(
      normalizada,
    )
  ) {
    return true;
  }

  const palabrasSalida = normalizada.split(/\s+/).filter(Boolean);
  const palabrasHilo = normalizeText(hilo).split(/\s+/).filter(Boolean);
  const N = 16;
  if (palabrasSalida.length < N || palabrasHilo.length < N) return false;

  const secuencias = new Set<string>();
  for (let i = 0; i <= palabrasHilo.length - N; i += 1) {
    secuencias.add(palabrasHilo.slice(i, i + N).join(' '));
  }
  for (let i = 0; i <= palabrasSalida.length - N; i += 1) {
    if (secuencias.has(palabrasSalida.slice(i, i + N).join(' '))) return true;
  }
  return false;
}

// El modelo tiende a completar plazos con números genéricos ("24 horas"). Se
// permiten sólo si la misma expresión aparece en el hilo del ticket actual.
// También se descartan datos internos que no son parte de la conversación.
export function inventaDatoDelHilo(respuesta: string, hilo: string): boolean {
  const salida = normalizeText(stripThinkTags(respuesta));
  const contexto = normalizeText(hilo);
  const plazos = salida.match(/\b\d+\s*(horas?|hs?|minutos?|dias?|semanas?|meses?)\b/g) || [];
  if (plazos.some((plazo) => !contexto.includes(plazo))) return true;
  const acciones =
    salida.match(
      /\b(?:ya )?(?:le |te |nos |les |se )?(envi[eéo]|enviamos|resolv[ií]|resolvimos|solucion[eé]|solucionamos)\b/g,
    ) || [];
  if (acciones.some((accion) => !contexto.includes(accion))) return true;
  return /prioridad[^.\n]{0,30}(normal|alta|baja|critica)|estado[^.\n]{0,30}\bnuevo\b|contacto (asignado|registrado)|registrado (correctamente )?en el sistema|no se ha asignado un tecnico|soporte por whatsapp (ha sido )?activado|numero de ticket|ticket #\d+/.test(
    salida,
  );
}
