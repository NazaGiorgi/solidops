import { RoleName } from '../enums';

// ---------------------------------------------------------------------------
// RBAC permission model for Fase 1.
//
// A permission is a capability string composed as `<module>:<action>`.
// Roles map to a set of permissions. The RolesGuard checks the permission
// metadata on a route (or falls back to role-name allowlist via @Roles()).
//
// Data access is additionally constrained by row-level `customer_id` where
// appropriate (multi-client, not multi-tenant).
// ---------------------------------------------------------------------------

export const PERMISSIONS = {
  // users
  USERS_READ: 'users:read',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  // technicians
  TECHNICIANS_READ: 'technicians:read',
  TECHNICIANS_UPDATE: 'technicians:update',
  // customers
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_DELETE: 'customers:delete',
  // contracts (SLA assignment)
  CONTRACTS_READ: 'contracts:read',
  CONTRACTS_UPDATE: 'contracts:update',
  // tickets
  TICKETS_READ: 'tickets:read',
  TICKETS_CREATE: 'tickets:create',
  TICKETS_UPDATE: 'tickets:update',
  TICKETS_ASSIGN: 'tickets:assign',
  // calendar
  CALENDAR_READ: 'calendar:read',
  CALENDAR_WRITE: 'calendar:write',
  // dashboard
  DASHBOARD_GENERAL: 'dashboard:general', // supervisor-level aggregate views
  // notifications
  NOTIFICATIONS_READ: 'notifications:read',
  // audit
  AUDIT_READ: 'audit:read',
  // documents (module documental)
  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_WRITE: 'documents:write',
  // notes (módulo de notas tipo Evernote)
  NOTES_READ: 'notes:read',
  NOTES_WRITE: 'notes:write',
  // workshop (módulo de recepción de equipos de taller)
  WORKSHOP_READ: 'workshop:read',
  WORKSHOP_WRITE: 'workshop:write',
  WORKSHOP_QUOTES: 'workshop:quotes',
  WORKSHOP_CATALOG: 'workshop:catalog',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Every known permission code, deduplicated and sorted. Used by the admin UI
// (role editor) and the public permission catalog, so new permissions require
// only adding them to PERMISSIONS above.
export const ALL_PERMISSIONS: string[] = Array.from(new Set(Object.values(PERMISSIONS))).sort();

// Group permission codes by module prefix (before ':') for UI grouping.
export const PERMISSION_GROUPS: Record<string, string[]> = ALL_PERMISSIONS.reduce<Record<string, string[]>>(
  (acc, p) => {
    const mod = p.split(':')[0];
    (acc[mod] = acc[mod] || []).push(p);
    return acc;
  },
  {},
);

// Human-readable label for a permission code.
export const PERMISSION_LABELS: Record<string, string> = {
  'users:read': 'Ver usuarios',
  'users:create': 'Crear usuarios',
  'users:update': 'Editar usuarios',
  'users:delete': 'Eliminar usuarios',
  'technicians:read': 'Ver técnicos',
  'technicians:update': 'Gestionar técnicos',
  'customers:read': 'Ver clientes',
  'customers:create': 'Crear clientes',
  'customers:update': 'Editar clientes',
  'customers:delete': 'Eliminar clientes',
  'contracts:read': 'Ver contratos',
  'contracts:update': 'Editar contratos',
  'tickets:read': 'Ver tickets',
  'tickets:create': 'Crear tickets',
  'tickets:update': 'Editar tickets',
  'tickets:assign': 'Asignar/fusionar tickets',
  'calendar:read': 'Ver agenda',
  'calendar:write': 'Editar agenda',
  'dashboard:general': 'Ver dashboard general',
  'notifications:read': 'Ver notificaciones',
  'audit:read': 'Ver auditoría',
  'documents:read': 'Ver documentos',
  'documents:write': 'Subir/editar documentos',
  'notes:read': 'Ver notas',
  'notes:write': 'Crear/editar notas',
  'workshop:read': 'Ver taller (equipos)',
  'workshop:write': 'Registrar/editar equipos y estados',
  'workshop:quotes': 'Armar presupuestos de taller',
  'workshop:catalog': 'Gestionar catálogo de precios',
};

// Role -> permissions mapping for Fase 1. Fine-tuned per the product's daily flow:
//  - Administrador: everything.
//  - Supervisor: everything except user deletion (and can read audit).
//  - Coordinador: like supervisor but no audit read / no user management.
//  - Técnico: read/create/update tickets, read customers, calendar, assignments.
//  - Consulta: read-only across the operational modules, no writes.
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  [RoleName.ADMINISTRADOR]: Object.values(PERMISSIONS),
  [RoleName.SUPERVISOR]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.TECHNICIANS_READ,
    PERMISSIONS.TECHNICIANS_UPDATE,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CUSTOMERS_CREATE,
    PERMISSIONS.CUSTOMERS_UPDATE,
    PERMISSIONS.CUSTOMERS_DELETE,
    PERMISSIONS.CONTRACTS_READ,
    PERMISSIONS.CONTRACTS_UPDATE,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_ASSIGN,
    PERMISSIONS.CALENDAR_READ,
    PERMISSIONS.CALENDAR_WRITE,
    PERMISSIONS.DASHBOARD_GENERAL,
    PERMISSIONS.NOTIFICATIONS_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.NOTES_READ,
    PERMISSIONS.NOTES_WRITE,
    PERMISSIONS.WORKSHOP_READ,
    PERMISSIONS.WORKSHOP_WRITE,
    PERMISSIONS.WORKSHOP_QUOTES,
    PERMISSIONS.WORKSHOP_CATALOG,
  ],
  [RoleName.COORDINADOR]: [
    PERMISSIONS.TECHNICIANS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CUSTOMERS_CREATE,
    PERMISSIONS.CUSTOMERS_UPDATE,
    PERMISSIONS.CONTRACTS_READ,
    PERMISSIONS.CONTRACTS_UPDATE,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_ASSIGN,
    PERMISSIONS.CALENDAR_READ,
    PERMISSIONS.CALENDAR_WRITE,
    PERMISSIONS.DASHBOARD_GENERAL,
    PERMISSIONS.NOTIFICATIONS_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.NOTES_READ,
    PERMISSIONS.NOTES_WRITE,
    PERMISSIONS.WORKSHOP_READ,
    PERMISSIONS.WORKSHOP_WRITE,
    PERMISSIONS.WORKSHOP_QUOTES,
  ],
  [RoleName.TECNICO]: [
    PERMISSIONS.TECHNICIANS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CUSTOMERS_CREATE,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.CALENDAR_READ,
    PERMISSIONS.CALENDAR_WRITE,
    PERMISSIONS.NOTIFICATIONS_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.NOTES_READ,
    PERMISSIONS.NOTES_WRITE,
    PERMISSIONS.WORKSHOP_READ,
    PERMISSIONS.WORKSHOP_WRITE,
    PERMISSIONS.WORKSHOP_QUOTES,
  ],
  [RoleName.CONSULTA]: [
    PERMISSIONS.TECHNICIANS_READ,
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CONTRACTS_READ,
    PERMISSIONS.TICKETS_READ,
    PERMISSIONS.CALENDAR_READ,
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_WRITE,
    PERMISSIONS.WORKSHOP_READ,
  ],
};

// Helper to build permission list for a role name.
export function permissionsForRole(roleName: RoleName): Permission[] {
  return ROLE_PERMISSIONS[roleName] || [];
}
