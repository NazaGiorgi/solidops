import { simpleParser } from 'mailparser';

// Procesamiento MIME robusto de emails entrantes usando `mailparser` (simpleParser),
// el parser MIME maduro/estándar de Node (el mismo que usan los sistemas de tickets
// profesionales). Reemplaza el parser casero anterior.
//
// Mailparser decodifica correctamente Content-Transfer-Encoding (quoted-printable,
// base64), charsets (UTF-8, ISO-8859-1, Windows-1252…), multipart/alternative
// (provee text y html), multipart/related y adjuntos (imágenes inline con cid).
// NO hay que re-inventar la decodificación ni corregir caracteres manualmente.

export interface ParsedAttachment {
  cid: string | null;
  filename: string | null;
  mimeType: string;
  data: Buffer;
  sizeBytes: number;
  disposition: 'inline' | 'attachment';
}

export interface ParsedMime {
  text: string;
  html: string | null;
  images: Map<string, { data: Buffer; mimeType: string }>;
  attachments: ParsedAttachment[];
}

// Normaliza un Content-ID de attachment de mailparser (puede venir con <>, "cid:", etc.)
export function normalizeCid(cid: string | null | undefined): string | null {
  if (!cid) return null;
  return String(cid)
    .replace(/^cid:/i, '')
    .replace(/^</, '')
    .replace(/>$/, '')
    .replace(/^".*"$/, (s) => s.slice(1, -1))
    .trim()
    .toLowerCase();
}

export async function parseMime(raw: Buffer): Promise<ParsedMime> {
  const parsed = await simpleParser(raw);

  // Texto plano (siempre texto; si solo hay HTML, mailparser lo coloca en html y
  // text queda como la versión en texto del HTML).
  const text = (parsed.text ?? '').replace(/\r\n/g, '\n');
  // HTML sanitizado (mailparser no sanitiza; lo hacemos nosotros).
  const html = parsed.html ? sanitizeHtml(parsed.html.replace(/\r\n/g, '\n')) : null;

  const images = new Map<string, { data: Buffer; mimeType: string }>();
  const attachments: ParsedAttachment[] = [];

  for (const a of parsed.attachments || []) {
    const data = a.content as Buffer | undefined;
    if (!data) continue;
    const cid = normalizeCid(a.cid ?? a.contentId);
    const mimeType = a.contentType || 'application/octet-stream';
    const disposition = (a.contentDisposition || '').toLowerCase();

    if (cid && (disposition === 'inline' || a.contentDisposition === 'inline' || (mimeType.startsWith('image/') && a.contentDisposition !== 'attachment'))) {
      // Imagen incrustada por Content-ID (multipart/related) → mapa images.
      if (!images.has(cid)) images.set(cid, { data, mimeType });
    } else {
      attachments.push({
        cid,
        filename: a.filename || null,
        mimeType,
        data,
        sizeBytes: data.length,
        disposition: disposition === 'inline' ? 'inline' : 'attachment',
      });
    }
  }

  return { text, html, images, attachments };
}

// Sanitizador de HTML seguro para contenido de emails externos (no confiable).
// Elimina scripts/estilos/iframes, atributos de eventos (on*), javascript: y tags
// no permitidos; conserva el formato de email normal. Exportado para reutilizarlo
// en el backfill de mensajes migrados de Zammad (poblado de body_html).
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr', 'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'a', 'code', 'pre', 'blockquote',
  'small', 'mark', 'del', 'ins', 'font',
]);

export function sanitizeHtml(html: string): string {
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[^>]*>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<meta[^>]*>/gi, '');
  out = out
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\sjavascript:/gi, '');
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/gi, (m, tag) => {
    const t = tag.toLowerCase();
    if (ALLOWED_TAGS.has(t)) return m;
    return '';
  });
  out = out.replace(/\shref=("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, val) => {
    const v = val.replace(/^["']|["']$/g, '');
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(v)) return ` href="${v}"`;
    return '';
  });
  out = out.replace(/\ssrc=("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, val) => {
    const v = val.replace(/^["']|["']$/g, '');
    if (/^(https?:|data:image\/)/i.test(v)) return ` src="${v}"`;
    return '';
  });
  return out;
}
