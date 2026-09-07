import { api } from './api';

// Tipos que reflejan las respuestas del módulo Taller del backend
// (backend/src/modules/workshop/*). Los enums de estado viven en
// backend/src/common/enums/index.ts; acá se replican para el frontend.

export const EQUIPMENT_TYPES = [
  { value: 'pc', label: 'PC' },
  { value: 'notebook', label: 'Notebook' },
  { value: 'impresora', label: 'Impresora' },
  { value: 'router', label: 'Router' },
  { value: 'reloj_fichador', label: 'Reloj fichador' },
  { value: 'dvr', label: 'DVR' },
  { value: 'otro', label: 'Otro' },
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]['value'];

export const EQUIPMENT_STATUSES = [
  'recibido',
  'en_diagnostico',
  'diagnosticado',
  'en_reparacion',
  'listo_para_retirar',
  'entregado',
] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const STATUS_LABELS: Record<EquipmentStatus, string> = {
  recibido: 'Recibido',
  en_diagnostico: 'En diagnóstico',
  diagnosticado: 'Diagnosticado',
  en_reparacion: 'En reparación',
  listo_para_retirar: 'Listo para retirar',
  entregado: 'Entregado',
};

// Pill CSS por estado.
export const STATUS_PILLS: Record<EquipmentStatus, string> = {
  recibido: 'pill-gray',
  en_diagnostico: 'pill-blue',
  diagnosticado: 'pill-blue',
  en_reparacion: 'pill-amber',
  listo_para_retirar: 'pill-blue',
  entregado: 'pill-green',
};

export const QUOTE_STATUSES = ['pendiente', 'aprobado', 'rechazado'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
};

export const QUOTE_STATUS_PILLS: Record<QuoteStatus, string> = {
  pendiente: 'pill-amber',
  aprobado: 'pill-green',
  rechazado: 'pill-red',
};

export function money(v: number | string | null | undefined): string {
  return isNaN(Number(v)) ? '—' : '$' + Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 });
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export interface StatusHistoryEntry {
  status: EquipmentStatus;
  at: string;
  byUserId?: string | null;
  note?: string | null;
}

export interface CustomerRef {
  id: string;
  name: string;
}
export interface ContactRef {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}
export interface SiteRef {
  id: string;
  name: string;
  address?: string | null;
}

export interface QuoteItem {
  id?: string;
  priceListItemId?: string | null;
  name: string;
  isLabor?: boolean;
  quantity: number;
  unitPrice: string | number;
  lineTotal: string | number;
}

export interface WorkshopQuote {
  id: string;
  equipmentId: string;
  number: string;
  status: QuoteStatus;
  notes?: string | null;
  subtotal: number;
  total: number;
  sentAt: string | null;
  createdById?: string | null;
  respondedAt?: string | null;
  items: QuoteItem[];
}

export interface WorkshopEquipment {
  id: string;
  ticketId?: string | null;
  customerId: string;
  contactId?: string | null;
  customerLabel?: string | null;
  // Nombre real del cliente resuelto por el backend en list() (fallback a customerLabel).
  customerName?: string | null;
  // Número de orden del ticket vinculado (reutiliza el id del Ticket), ej. "#a1b2c3d4".
  ticketNumber?: string | null;
  equipmentType: EquipmentType;
  otherType?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  accessories?: string | null;
  physicalCondition?: string | null;
  reportedFault: string;
  diagnosis?: string | null;
  status: EquipmentStatus;
  receivedAt: string;
  deliveredAt?: string | null;
  statusHistory: StatusHistoryEntry[];
  // decorate() del backend
  statusLabel: string;
  equipmentTypeLabel: string;
  // findOne() agrega:
  ticket?: { id: string; number?: number; title?: string } | null;
  customer?: CustomerRef | null;
  contact?: ContactRef | null;
  site?: SiteRef | null;
  quote?: WorkshopQuote | null;
  quoteItems?: QuoteItem[];
}

export interface PriceListItem {
  id: string;
  name: string;
  active: boolean;
  isLabor: boolean;
  price: number;
  description?: string | null;
}

export const workshopApi = {
  list: (params: { customerId?: string; status?: string; search?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.customerId) qs.set('customerId', params.customerId);
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    const s = qs.toString();
    return api.get<WorkshopEquipment[]>(`/workshop/equipments${s ? '?' + s : ''}`);
  },
  findOne: (id: string) => api.get<WorkshopEquipment>(`/workshop/equipments/${id}`),
  create: (body: Record<string, unknown>) => api.post<WorkshopEquipment>(`/workshop/equipments`, body),
  update: (id: string, body: Record<string, unknown>) =>
    api.patch<WorkshopEquipment>(`/workshop/equipments/${id}`, body),
  setStatus: (id: string, status: EquipmentStatus) =>
    api.post<WorkshopEquipment>(`/workshop/equipments/${id}/status`, { status }),
  quotes: (id: string) => api.get<WorkshopQuote[]>(`/workshop/equipments/${id}/quotes`),
  createQuote: (id: string, body: Record<string, unknown>) =>
    api.post<WorkshopEquipment>(`/workshop/equipments/${id}/quotes`, body),
  sendQuote: (id: string, quoteId: string) =>
    api.post<WorkshopEquipment>(`/workshop/equipments/${id}/quotes/${quoteId}/send`),
  respondQuote: (id: string, quoteId: string, decision: 'aprobado' | 'rechazado') =>
    api.post<WorkshopEquipment>(`/workshop/equipments/${id}/quotes/${quoteId}/respond`, { decision }),
  catalog: (onlyActive = false) =>
    api.get<PriceListItem[]>(`/workshop/catalog${onlyActive ? '?onlyActive=true' : ''}`),
  createCatalogItem: (body: Record<string, unknown>) => api.post<PriceListItem>(`/workshop/catalog`, body),
  updateCatalogItem: (id: string, body: Record<string, unknown>) =>
    api.patch<PriceListItem>(`/workshop/catalog/${id}`, body),
  receptionPdfUrl: (id: string) => `/api/workshop/equipments/${id}/reception.pdf`,
  quotePdfUrl: (id: string, quoteId: string) => `/api/workshop/equipments/${id}/quotes/${quoteId}.pdf`,
  // Lista de clientes con sus contactos (para cambiar el contacto de un equipo).
  customers: () => api.get<CustomerOpt[]>(`/customers`),
};

export interface ContactOpt {
  id: string;
  name: string;
  email?: string | null;
}
export interface CustomerOpt {
  id: string;
  name: string;
  contacts: ContactOpt[];
}

export function openAuthorized(url: string) {
  // Los PDFs requieren el token en el header Authorization (no se pueden abrir
  // en una pestaña nueva sin él), así que se descargan con fetch autenticado y
  // se muestran desde un blob.
  import('./api').then(({ API_URL, getToken }) => {
    const token = getToken();
    fetch(`${API_URL}${url}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('No se pudo generar el PDF');
        return res.blob();
      })
      .then((blob) => {
        const obj = URL.createObjectURL(blob);
        window.open(obj, '_blank');
      })
      .catch(() => {});
  });
}

// --- Pickers de cliente (reutilizados por el alta de equipo) ----------------

// Dominios de correo personal (misma lista que backend/src/common/utils/email-domain.ts).
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'gmail.com.ar', 'googlemail.com', 'hotmail.com', 'hotmail.com.ar',
  'hotmail.es', 'outlook.com', 'outlook.com.ar', 'outlook.es', 'live.com',
  'live.com.ar', 'msn.com', 'yahoo.com', 'yahoo.com.ar', 'yahoo.com.mx',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me',
  'zoho.com', 'yopmail.com', 'fibertel.com.ar', 'speedy.com.ar', 'telecentro.com.ar',
  'arnet.com.ar', 'ciudad.com.ar',
]);

export const PARTICULARS_BUCKET = 'Clientes particulares';

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d.length > 0 ? d : null;
}

export function isPersonalEmail(email: string | null | undefined): boolean {
  const d = emailDomain(email);
  return !!d && PERSONAL_EMAIL_DOMAINS.has(d);
}

// Un cliente se muestra como "Cliente particular" según el patrón del sistema:
// el bucket genérico "Clientes particulares" o un cliente cuyos contactos usan,
// en su mayoría, correos personales. El resto se muestra como "Empresa · N contactos".
export function customerSubtitle(name: string | undefined, emails: (string | null | undefined)[]): string {
  if (name === PARTICULARS_BUCKET) return 'Cliente particular';
  const vals = emails.filter(Boolean) as string[];
  if (vals.length === 0) return 'Cliente particular';
  const personal = vals.filter((e) => isPersonalEmail(e)).length;
  const particular = personal === vals.length;
  return particular ? 'Cliente particular' : `Empresa · ${vals.length} contactos`;
}

export function initials(name: string | undefined | null): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// API del portal (presupuestos del cliente).
export interface PortalQuote {
  id: string;
  number: string;
  total: number;
  notes?: string | null;
  sentAt: string;
  status: QuoteStatus;
  equipmentId: string;
  equipment: {
    id: string;
    typeLabel: string;
    brand?: string | null;
    model?: string | null;
  };
  items: QuoteItem[];
}

export const portalQuoteApi = {
  list: () => api.get<PortalQuote[]>('/portal/quotes'),
  respond: (id: string, decision: 'aprobado' | 'rechazado') =>
    api.post<{ id: string; status: QuoteStatus }>(`/portal/quotes/${id}/respond`, { decision }),
};