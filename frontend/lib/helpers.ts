// Shared formatting + status/priority -> pill color mapping helpers.

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDay(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

// Número de ticket humano-legible: TK-{año}-{número}. El año es el del momento
// en que el ticket fue creado (created_at); el número es el contador global.
export function ticketNumberDisplay(t?: { ticketNumber?: number | null; createdAt?: string | null } | null): string {
  if (!t || !t.ticketNumber) return '';
  const year = t.createdAt ? new Date(t.createdAt).getFullYear() : new Date().getFullYear();
  return `TK-${year}-${t.ticketNumber}`;
}

// Map a ticket status to a semantic pill style.
export const STATUS_PILLS: Record<string, string> = {
  nuevo: 'pill-blue',
  abierto: 'pill-blue',
  asignado: 'pill-gray',
  en_progreso: 'pill-amber',
  esperando_cliente: 'pill-gray',
  resuelto: 'pill-green',
  cerrado: 'pill-gray',
};

export const PRIORITY_PILLS: Record<string, string> = {
  baja: 'pill-gray',
  normal: 'pill-blue',
  alta: 'pill-amber',
  critica: 'pill-red',
};

export const SLA_PILLS: Record<string, string> = {
  verde: 'pill-green',
  amarillo: 'pill-amber',
  rojo: 'pill-red',
};

export const TECH_STATUS_PILLS: Record<string, string> = {
  disponible: 'pill-green',
  ocupado: 'pill-amber',
  fuera_de_horario: 'pill-gray',
};

export const APPOINTMENT_TYPE_PILLS: Record<string, string> = {
  reunion: 'pill-blue',
  visita: 'pill-amber',
  guardia: 'pill-gray',
  tarea: 'pill-gray',
};

export const TASK_STATUS_PILLS: Record<string, string> = {
  pendiente: 'pill-amber',
  en_progreso: 'pill-blue',
  hecha: 'pill-green',
  cancelada: 'pill-gray',
  pospuesta: 'pill-amber',
};

// Human labels (sentence case).
export const STATUS_LABELS: Record<string, string> = {
  nuevo: 'nuevo',
  abierto: 'abierto',
  asignado: 'asignado',
  en_progreso: 'en progreso',
  esperando_cliente: 'esperando cliente',
  resuelto: 'resuelto',
  cerrado: 'cerrado',
};

export const PRIORITY_LABELS: Record<string, string> = {
  baja: 'baja',
  normal: 'normal',
  alta: 'alta',
  critica: 'crítica',
};

export const LEVEL_LABELS: Record<string, string> = {
  junior: 'junior',
  mid: 'mid',
  senior: 'senior',
  lead: 'lead',
};

export const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  reunion: 'reunión',
  visita: 'visita',
  guardia: 'guardia',
  tarea: 'tarea',
};

export const APPOINTMENT_STATUS_PILLS: Record<string, string> = {
  programado: 'pill-blue',
  completado: 'pill-green',
  cancelado: 'pill-gray',
  pospuesto: 'pill-amber',
};

export const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  programado: 'programado',
  completado: 'completado',
  cancelado: 'cancelado',
  pospuesto: 'pospuesto',
};

export const TASK_STATUS_LABELS: Record<string, string> = {
  pendiente: 'pendiente',
  en_progreso: 'en progreso',
  hecha: 'hecha',
  cancelada: 'cancelada',
  pospuesta: 'pospuesta',
};

export const CHANNEL_LABELS: Record<string, string> = {
  email: 'email',
  portal: 'portal',
  whatsapp: 'WhatsApp',
};

// Canal de origen del TICKET (columna `source`): email / portal / whatsapp / manual.
export const SOURCE_ICONS: Record<string, string> = {
  email: '✉️',
  portal: '🌐',
  whatsapp: '💬',
  manual: '🖊️',
};
export function sourceIcon(source?: string | null): string {
  return SOURCE_ICONS[source || ''] || '📄';
}
export function sourceLabel(source?: string | null): string {
  switch (source) {
    case 'email': return 'Email';
    case 'portal': return 'Portal';
    case 'whatsapp': return 'WhatsApp';
    case 'manual': return 'Manual';
    default: return source || '';
  }
}
