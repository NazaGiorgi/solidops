// Helpers puros (sin IO) para preparar texto y parsear respuestas del modelo.
// Están separados para poder probarlos con Jest sin levantar Nest.

// qwen3 puede "pensar en voz alta". Aunque enviamos think:false, recortamos
// cualquier bloque <think>...</think> que se cuele en la respuesta.
export function stripThinkTags(input: string): string {
  return input
    .replace(/<think[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
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
