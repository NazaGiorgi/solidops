import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

// Criterio ÚNICO (el ya documentado en docs/IA-OLLAMA.md §10.3) para separar
// tickets de personas de avisos automáticos: backups, alertas, notificaciones,
// correos de monitoreo, etc. Lo consumen el asistente IA para no ofrecer
// "Proponer respuesta" en avisos automáticos y para no listarlos como
// "Posibles relacionados". No se modifica ninguna fila: es sólo lectura.
//
// Es una estimación por patrón: algunos correos de monitoreo pueden quedar del
// lado de personas y asuntos genéricos ("consulta", "test") del lado automático.
export const PERSON_TICKET_SOURCES = ['whatsapp', 'manual', 'portal'] as const;

export const AUTOMATIC_SUBJECT_PATTERN =
  '(backup|respaldo|health|smart error|correcto|incorrecto|notificac|alerta|automat|tu ticket|encuesta|newsletter|amistad|novedades|starlink|mail delivery failed|verify your account|datos de prioridad|firma digital|actualizaci.n de precios|towebs|linkedin|facebook|active backup|copia de seguridad|mikrotik|proxmox|zfs|volumen|se ha cerrado incorrectamente|no puede conectarse|undelivered mail|nuevo inicio de sesi.n|sin capacidad|fault|error)';

export interface AutomaticNoticeCandidate {
  source?: string | null;
  subjectKey?: string | null;
  messages?: Array<{ authorType?: string | null }>;
  hasClientMessage?: boolean;
}

function hasClientMessage(ticket: AutomaticNoticeCandidate): boolean {
  if (typeof ticket.hasClientMessage === 'boolean') return ticket.hasClientMessage;
  return (ticket.messages || []).some((m) => m.authorType === 'cliente');
}

export function isAutomaticNotice(ticket: AutomaticNoticeCandidate): boolean {
  if (PERSON_TICKET_SOURCES.includes((ticket.source || '') as (typeof PERSON_TICKET_SOURCES)[number])) {
    return false;
  }
  const subject = ticket.subjectKey || '';
  const esPersona =
    ticket.source === 'email' &&
    hasClientMessage(ticket) &&
    !new RegExp(AUTOMATIC_SUBJECT_PATTERN, 'i').test(subject);
  return !esPersona;
}

// Devuelve la condición SQL que identifica a una PERSONA, con parámetros
// prefijados para poder combinarla con otros filtros sin colisiones.
export function personTicketCondition(alias = 't', prefix = 'autoNotice'): {
  sql: string;
  params: Record<string, unknown>;
} {
  const existeCliente = `EXISTS (
    SELECT 1 FROM ticket_messages m
    WHERE m.ticket_id = ${alias}.id AND m.author_type = 'cliente'
  )`;
  return {
    sql: `(
      ${alias}.source IN (:...${prefix}Sources)
      OR (
        ${alias}.source = 'email'
        AND ${existeCliente}
        AND ${alias}.subject_key !~* :${prefix}Pattern
      )
    )`,
    params: {
      [`${prefix}Sources`]: [...PERSON_TICKET_SOURCES],
      [`${prefix}Pattern`]: AUTOMATIC_SUBJECT_PATTERN,
    },
  };
}

export function excludeAutomaticNotices<T extends SelectQueryBuilder<ObjectLiteral>>(
  qb: T,
  alias = 't',
  prefix = 'autoNotice',
): T {
  const { sql, params } = personTicketCondition(alias, prefix);
  // La condición es de PERSONA: la mantenemos (no la negamos) para descartar
  // backups, alertas y correos de sistema.
  qb.andWhere(sql, params);
  return qb;
}
