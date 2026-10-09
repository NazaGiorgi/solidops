// Helpers de adjuntos compartidos entre el panel de staff y el portal de clientes.
// Espejo del backend (`common/utils/allowed-attachment-mimes.ts`): cualquier
// cambio de formatos toca ambos lados.

export const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

const ALLOWED_DOC_MIMES = [
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
const ALLOWED_DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];

const DOC_ICONS: Record<string, string> = {
  pdf: '📄',
  doc: '📝',
  docx: '📝',
  xls: '📊',
  xlsx: '📊',
  ppt: '📽️',
  pptx: '📽️',
  txt: '📄',
  csv: '📊',
};

export const ALLOWED_ATTACHMENTS_LABEL =
  'imágenes (jpg, png, webp, heic, gif o bmp), PDF, Word (.doc/.docx), Excel (.xls/.xlsx), PowerPoint (.ppt/.pptx), texto (.txt) y CSV (.csv)';

export function isAllowedAttachFile(f: Pick<File, 'name' | 'type'>): boolean {
  const mime = (f.type || '').toLowerCase();
  if (mime.startsWith('image/') || ALLOWED_DOC_MIMES.includes(mime)) return true;
  if (mime === 'application/octet-stream' || mime === '') {
    return ALLOWED_DOC_EXT.includes(f.name.toLowerCase().split('.').pop() || '');
  }
  return false;
}

export function attachKind(f: Pick<File, 'name' | 'type'>): 'image' | 'doc' {
  return (f.type || '').toLowerCase().startsWith('image/') ? 'image' : 'doc';
}

export function attachIcon(f: Pick<File, 'name'>): string {
  return DOC_ICONS[f.name.toLowerCase().split('.').pop() || ''] || '📎';
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}