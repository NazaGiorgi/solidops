// Formatos aceptados al adjuntar archivos a un ticket desde el panel de staff.
//
// Punto de partida/válidos confirmados:
//  - Imágenes: `image/*` (jpg, png, webp, heic, gif, bmp, avif…).
//  - PDF: `application/pdf`.
//  - Word 97-2003: `application/msword` (.doc).
//  - Word OOXML: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (.docx).
//  - Excel 97-2003: `application/vnd.ms-excel` (.xls).
//  - Excel OOXML: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (.xlsx).
//  - PowerPoint 97-2003: `application/vnd.ms-powerpoint` (.ppt).
//  - PowerPoint OOXML: `application/vnd.openxmlformats-officedocument.presentationml.presentation` (.pptx).
//  - Texto plano: `text/plain` (.txt).
//  - CSV: `text/csv` (.csv) — ojo: Excel/Windows suele reportarlo como
//    `application/vnd.ms-excel`, que ya está permitido por la entrada de .xls.
//
// Nota: la ingesta por email (mailbox-worker) NO filtra tipos — sube tal cual lo
// que el remitente adjuntó. Esta lista aplica a la subida desde la UI (staff y
// portal) y a los adjuntos recibidos por WhatsApp.

// Tope único de tamaño para adjuntos a tickets (staff + portal). Coincide con el
// tope de la ingesta de WhatsApp (25 MB).
export const ATTACHMENT_MAX_BYTES = 26214400;

export const ALLOWED_ATTACHMENT_MIMES: string[] = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
];

// Fallback por extensión: algunos clientes/navegadores reportan el mime genérico
// `application/octet-stream` (o vacío) para DOCX/XLSX/etc descargados de la web.
// Se admite por extensión únicamente para la familia office/pdf/txt/csv. Un
// .zip/.exe caído en octet-stream NO tiene entrada acá y sigue rechazado.
const EXT_FALLBACK_MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};

const EXTENSIONS_ACCEPTED = Object.keys(EXT_FALLBACK_MIMES);

// Texto estable para mensajes de error (backend y frontend).
export const ALLOWED_ATTACHMENT_LABEL =
  'imágenes (jpg, png, webp, heic, gif o bmp), PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.ppt/.pptx), texto (.txt) y CSV (.csv)';

export function isAllowedAttachmentMime(mime: string, filename?: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/') || ALLOWED_ATTACHMENT_MIMES.includes(m)) return true;
  // octet-stream o tipo ausente: admitir solo si la extensión es de la familia office/pdf.
  if (m === 'application/octet-stream' || m === '') {
    const ext = (filename || '').toLowerCase().split('.').pop() || '';
    return (EXTENSIONS_ACCEPTED as string[]).includes(ext);
  }
  return false;
}

// Anti-XSS: blanco duro de extensiones nunca permitidas (ejecutables/archivos).
export const FORBIDDEN_ATTACHMENT_EXTENSIONS = [
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'sh', 'apk', 'jar', 'dll', 'reg', 'hta',
];

export function hasForbiddenExtension(filename: string): boolean {
  const ext = (filename || '').toLowerCase().split('.').pop() || '';
  return (FORBIDDEN_ATTACHMENT_EXTENSIONS as string[]).includes(ext);
}