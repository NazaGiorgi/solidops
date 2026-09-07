// ---------------------------------------------------------------------------
// Shared enums for Fase 1. Kept as string enums so values stored in Postgres
// are readable and DB-agnostic.
// ---------------------------------------------------------------------------

export enum RoleName {
  ADMINISTRADOR = 'Administrador',
  SUPERVISOR = 'Supervisor',
  COORDINADOR = 'Coordinador',
  TECNICO = 'Técnico',
  CONSULTA = 'Consulta',
}

export enum TechnicianLevel {
  JUNIOR = 'junior',
  MID = 'mid',
  SENIOR = 'senior',
  LEAD = 'lead',
}

export enum TechnicianStatus {
  DISPONIBLE = 'disponible',
  OCUPADO = 'ocupado',
  FUERA_DE_HORARIO = 'fuera_de_horario',
}

export enum ContactPreferredChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  TELEFONO = 'telefono',
}

export enum TicketStatus {
  NUEVO = 'nuevo',
  ABIERTO = 'abierto',
  ASIGNADO = 'asignado',
  EN_PROGRESO = 'en_progreso',
  ESPERANDO_CLIENTE = 'esperando_cliente',
  RESUELTO = 'resuelto',
  CERRADO = 'cerrado',
}

export enum TicketPriority {
  BAJA = 'baja',
  NORMAL = 'normal',
  ALTA = 'alta',
  CRITICA = 'critica',
}

export enum TicketAuthorType {
  CLIENTE = 'cliente',
  TECNICO = 'tecnico',
  SISTEMA = 'sistema',
}

export enum TicketChannel {
  EMAIL = 'email',
  PORTAL = 'portal',
  WHATSAPP = 'whatsapp',
}

export enum SlaStatus {
  VERDE = 'verde',
  AMARILLO = 'amarillo',
  ROJO = 'rojo',
}

export enum AppointmentType {
  REUNION = 'reunion',
  VISITA = 'visita',
  GUARDIA = 'guardia',
  TAREA = 'tarea',
}

export enum AppointmentStatus {
  PROGRAMADO = 'programado',
  COMPLETADO = 'completado',
  CANCELADO = 'cancelado',
  POSPUESTO = 'pospuesto',
}

export enum TaskStatus {
  PENDIENTE = 'pendiente',
  EN_PROGRESO = 'en_progreso',
  HECHA = 'hecha',
  CANCELADA = 'cancelada',
  POSPUESTA = 'pospuesta',
}

export enum RecurrenceRule {
  NONE = 'none',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum NotificationType {
  TICKET_ASIGNADO = 'ticket_asignado',
  SLA_EN_RIESGO = 'sla_en_riesgo',
  TAREA_ATRASADA = 'tarea_atrasada',
  WHATSAPP_MESSAGE = 'whatsapp_message',
  EMAIL_MESSAGE = 'email_message',
}

export enum EquipmentType {
  PC = 'pc',
  NOTEBOOK = 'notebook',
  IMPRESORA = 'impresora',
  ROUTER = 'router',
  RELOJ_FICHADOR = 'reloj_fichador',
  DVR = 'dvr',
  OTRO = 'otro',
}

export enum WorkshopEquipmentStatus {
  RECIBIDO = 'recibido',
  EN_DIAGNOSTICO = 'en_diagnostico',
  DIAGNOSTICADO = 'diagnosticado',
  EN_REPARACION = 'en_reparacion',
  LISTO_PARA_RETIRAR = 'listo_para_retirar',
  ENTREGADO = 'entregado',
}

export enum WorkshopQuoteStatus {
  PENDIENTE = 'pendiente',
  APROBADO = 'aprobado',
  RECHAZADO = 'rechazado',
}

export enum AuditAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  STATUS_CHANGE = 'status_change',
  PRIORITY_CHANGE = 'priority_change',
  ASSIGNMENT_CHANGE = 'assignment_change',
  LOGIN = 'login',
  LOGOUT = 'logout',
  PASSWORD_RESET_REQUEST = 'password_reset_request',
  PASSWORD_RESET = 'password_reset',
  VIEW = 'view',
  DOWNLOAD = 'download',
}

export enum AuditEntityType {
  USER = 'user',
  ROLE = 'role',
  TECHNICIAN = 'technician',
  CUSTOMER = 'customer',
  CONTACT = 'contact',
  SITE = 'site',
  CONTRACT = 'contract',
  TICKET = 'ticket',
  TICKET_MESSAGE = 'ticket_message',
  TICKET_GROUP = 'ticket_group',
  APPOINTMENT = 'appointment',
  TASK = 'task',
  NOTIFICATION = 'notification',
  MAILBOX = 'mailbox',
  MAILBOX_RULE = 'mailbox_rule',
  ASSET = 'asset',
  DOCUMENT = 'document',
  NOTE = 'note',
  NOTE_BOX = 'note_box',
  NOTE_TAG = 'note_tag',
  SYSTEM_SETTINGS = 'system_settings',
  WORKSHOP_EQUIPMENT = 'workshop_equipment',
  PRICE_LIST_ITEM = 'price_list_item',
  WORKSHOP_QUOTE = 'workshop_quote',
}

export const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.NUEVO,
  TicketStatus.ABIERTO,
  TicketStatus.ASIGNADO,
  TicketStatus.EN_PROGRESO,
  TicketStatus.ESPERANDO_CLIENTE,
];
