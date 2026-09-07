'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAuth } from '../../lib/auth';
import { useEffect, useState, useRef } from 'react';
import { useNotificationsSocket } from '../../lib/use-notifications';
import { useAgendaReminders } from '../../components/use-agenda-reminders';
import { useNewTicketToast } from '../../components/use-new-ticket-toast';
import { BrandLogo } from '../../components/brand-logo';
import { api } from '../../lib/api';

interface NavItem {
  href: string;
  label: string;
  perm?: string;
  perms?: string[];
  // Restrict to specific role names (used for the admin-only "Administración" item).
  roles?: string[];
  // Optional sub-links rendered as indented items under this entry.
  children?: { href: string; label: string; perm?: string }[];
}

const NAV: NavItem[] = [
  { href: '/mi-dia', label: 'Mi día', perm: 'tickets:read' },
  { href: '/dashboard', label: 'Dashboard', perm: 'dashboard:general' },
  { href: '/tickets', label: 'Tickets', perm: 'tickets:read' },
  { href: '/clientes', label: 'Clientes', perm: 'customers:read' },
  { href: '/cuentas-portal', label: 'Cuentas del portal', perm: 'customers:update' },
  { href: '/agenda', label: 'Agenda', perm: 'calendar:read' },
  { href: '/tecnicos', label: 'Técnicos', perm: 'technicians:read' },
  { href: '/usuarios', label: 'Usuarios', perm: 'users:read' },
  { href: '/reportes', label: 'Reportes', perm: 'dashboard:general' },
  { href: '/notas', label: 'Notas', perm: 'notes:read' },
  { href: '/documentos', label: 'Documentos', perm: 'documents:read' },
  { href: '/taller', label: 'Taller', perm: 'workshop:read' },
  { href: '/notificaciones', label: 'Notificaciones', perm: 'notifications:read' },
  { href: '/auditoria', label: 'Auditoría', perm: 'audit:read' },
  { href: '/casillas', label: 'Casillas de correo', perm: 'users:read' },
  {
    href: '/administracion/roles',
    label: 'Administración',
    roles: ['Administrador'],
    children: [
      { href: '/administracion/roles', label: 'Roles y permisos' },
      { href: '/administracion/configuracion', label: 'Configuración general' },
      { href: '/administracion/boxes', label: 'Boxes de tickets' },
      { href: '/usuarios', label: 'Usuarios', perm: 'users:read' },
      { href: '/casillas', label: 'Casillas de correo', perm: 'users:read' },
    ],
  },
];

interface NotificationEvent {
  id: string;
  readAt: string | null;
}

// Grupos/bandejas mostradas en el menú lateral bajo "Tickets". 'nativo' =
// tickets creados en SolidOps sin legacy_group. Se cargan del backend.
interface TrayGroup {
  tray: string;
  count: number;
}

// Catálogo de boxes (ticket_groups): el sidebar muestra TODOS los boxes activos
// del catálogo (aunque estén vacíos), ordenados por sortOrder, con su count.
interface TicketGroup {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
}

// Orden preferido de bandejas en el menú (soporte primero, luego el resto por
// contador). El backend ya devuelve por count DESC; acá normalizamos el orden de
// display para que L1/L2/L3 y nativos queden arriba.
const TRAY_LABELS: Record<string, string> = {
  nativo: 'Nativos',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  Users: 'Users',
  Taller: 'Taller',
  Ventas: 'Ventas',
  'Mesa de ayuda': 'Mesa de ayuda',
};
// Bandejas de groupCounts (por legacy_group) que están cubiertas por una SavedView
// "Backups MK" (por remitente) y se muestran como entradas duplicadas. Se ocultan
// del sidebar para que solo quede la vista unificada (que incluye ambos criterios).
const HIDDEN_TRAY_GROUPS = new Set(['Backups MK']);

// Vistas guardadas (replicas de las Overviews de Zammad) mostradas en el sidebar.
interface TrayView {
  id: string;
  name: string;
  prio: number;
  userScoped: boolean;
  count: number;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, hasPerm } = useAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [ticketsAttention, setTicketsAttention] = useState(0);
  const [trayGroups, setTrayGroups] = useState<TrayGroup[]>([]);
  const [ticketGroups, setTicketGroups] = useState<TicketGroup[]>([]);
  const [savedViews, setSavedViews] = useState<TrayView[]>([]);
  // Live notifications + unread count.
  useNotificationsSocket((n: NotificationEvent) => {
    if (!n.readAt) setUnread((c) => c + 1);
  });
  // Notificación flotante (toast) estilo Zammad al llegar un ticket nuevo.
  useNewTicketToast();
  // [DIAG] contador de MOUNT real (useEffect con [] corre una vez por mount).
  const mountRef = useRef(0);
  useEffect(() => {
    mountRef.current += 1;
    // eslint-disable-next-line no-console
    console.log('[shell] MOUNT n=' + mountRef.current, 't=' + Date.now(), 'path=' + pathname);
  }, []);
  // [DIAG] contador de RENDER (cuerpo). Si RENDER sube pero MOUNT no => render-loop (no remount).
  const g = (globalThis as unknown as { __shellRender?: number });
  g.__shellRender = (g.__shellRender || 0) + 1;
  // eslint-disable-next-line no-console
  console.log('[shell] RENDER t=' + Date.now(), 'render=' + g.__shellRender,
    'user=' + (!!user), 'unread=' + unread, 'attention=' + ticketsAttention,
    'groups=' + trayGroups.length, 'views=' + savedViews.length, 'path=' + pathname);
  useAgendaReminders();

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[shell] LOAD-EFFECT ran t=' + Date.now());
    if (!user) return;
    api
      .get<number>('/notifications/unread-count')
      .then((n) => setUnread(Number(n)))
      .catch(() => {});
    api
      .get<{ open: number; new: number; critical: number }>('/tickets/attention-count')
      .then((c) => setTicketsAttention(Number(c.open) + Number(c.critical)))
      .catch(() => {});
    api
      .get<TrayGroup[]>('/tickets/groups')
      .then((g) => setTrayGroups(g || []))
      .catch(() => {});
    api
      .get<TicketGroup[]>('/ticket-groups')
      .then((g) => setTicketGroups(g || []))
      .catch(() => {});
    api
      .get<TrayView[]>('/tickets/views')
      .then((v) => setSavedViews(v || []))
      .catch(() => {});
  }, [user, pathname]);

  const visibleNav = NAV.filter((n) => {
    if (!user) return false;
    if (n.roles && !n.roles.includes(user.role)) return false;
    if (n.perm && !hasPerm(n.perm)) return false;
    return true;
  });

  if (!user) return <>{children}</>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <BrandLogo alt="SolidOps" size={26} />
          <small>tickets · agenda · clientes</small>
        </div>
        {visibleNav.map((n) => {
          const active = pathname.startsWith(n.href);
          const badge =
            n.href === '/notificaciones' ? unread
            : n.href === '/tickets' ? ticketsAttention
            : 0;
          return (
            <div key={n.href}>
              <Link
                href={n.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
              >
                <span>{n.label}</span>
                {badge > 0 && (
                  <span className="pill pill-red" style={{ marginLeft: 'auto' }}>
                    {badge}
                  </span>
                )}
              </Link>
              {n.children && (
                <div className="sidebar-sub">
                  {n.children
                    .filter((c) => !c.perm || hasPerm(c.perm))
                    .map((c) => {
                      const cActive = pathname.startsWith(c.href);
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          className={`sidebar-link sidebar-link-sub ${cActive ? 'active' : ''}`}
                        >
                          {c.label}
                        </Link>
                      );
                    })}
                </div>
              )}
              {n.href === '/tickets' && (
                <Suspense fallback={null}>
                  <TicketSidebarLinks groups={trayGroups} catalog={ticketGroups} views={savedViews} hasPerm={hasPerm} />
                </Suspense>
              )}
            </div>
          );
        })}
        <div className="sidebar-footer">
          <div className="flex-between">
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {user.role}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={logout}>
              salir
            </button>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

// Renderiza la lista de bandejas + vistas guardadas de Tickets bajo el ítem
// "Tickets" del sidebar. Cada bandeja/vista enlaza a /tickets?tray=... / ?view=...,
// reusando los filtros de la pantalla de Tickets.
//
// IMPORTANTE (bug de "ítem activo desactualizado"): el estado 'activo' se lee con
// useSearchParams() (reactivo), NO con window.location.search durante el render.
// Comparado con la versión anterior (leer window.location en el cuerpo):
//   - Como Shell no se re-renderiza al navegar client-side (su usePathname() sigue
//     siendo "/tickets"), el value de tray/view quedaba congelado en el render
//     previo y el indicador activo quedaba desincronizado (ej. resaltaba "Nativos"
//     mientras se mostraba "Users"). useSearchParams se actualiza al navegar, por
//     lo que el resaltado siempre coincide con la bandeja/vista realmente mostrada.
function TicketSidebarLinks({
  groups,
  catalog,
  views,
  hasPerm,
}: {
  groups: TrayGroup[];
  catalog: TicketGroup[];
  views: TrayView[];
  hasPerm: (p: string) => boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const isTickets = pathname.startsWith('/tickets');
  const tray = params.get('tray');
  const view = params.get('view');

  if (!hasPerm('tickets:read')) return null;

  // Mapa de counts por bandeja (desde groupCounts).
  const counts = new Map(groups.map((g) => [g.tray, g.count]));

  // El sidebar muestra TODOS los boxes activos del catálogo (aunque estén
  // vacíos), ordenados por sortOrder. Es lo que permite ver un box recién
  // creado sin moverle tickets todavía. Se excluye el bucket sintético 'nativo'
  // (tickets sin legacy_group) del catálogo, ya que no es un box real; se suma
  // aparte si tiene tickets (como hoy).
  const sorted: TrayGroup[] = catalog
    .filter((c) => c.active)
    .filter((c) => !HIDDEN_TRAY_GROUPS.has(c.name))
    .map((c) => ({ tray: c.name, count: counts.get(c.name) ?? 0 }))
    .sort((a, b) => {
      const sa = catalog.find((c) => c.name === a.tray)?.sortOrder ?? 0;
      const sb = catalog.find((c) => c.name === b.tray)?.sortOrder ?? 0;
      if (sa !== sb) return sa - sb;
      return a.tray.localeCompare(b.tray);
    });

  // Añade el bucket sintético 'nativo' (tickets sin legacy_group) al comienzo,
  // como hoy, si tiene tickets o para que siempre sea accesible.
  if (counts.has('nativo') || true) {
    const idx = sorted.findIndex((g) => g.tray === 'nativo');
    const nativo = { tray: 'nativo', count: counts.get('nativo') ?? 0 };
    if (idx >= 0) sorted[idx] = nativo;
    else sorted.unshift(nativo);
  }

  const sortedViews = [...views].sort((a, b) => a.prio - b.prio);

  return (
    <div className="sidebar-sub">
      {sorted.map((g) => {
        const active = isTickets && tray === g.tray;
        return (
          <Link
            key={g.tray}
            href={`/tickets?tray=${encodeURIComponent(g.tray)}`}
            className={`sidebar-link sidebar-link-sub ${active ? 'active' : ''}`}
          >
            <span>{TRAY_LABELS[g.tray] || g.tray}</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {g.count}
            </span>
          </Link>
        );
      })}
      {sortedViews.length > 0 && (
        <div
          className="sidebar-sub"
          style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4, paddingTop: 4 }}
        >
          {sortedViews.map((v) => {
            const active = isTickets && view === v.id;
            return (
              <Link
                key={v.id}
                href={`/tickets?view=${v.id}`}
                className={`sidebar-link sidebar-link-sub ${active ? 'active' : ''}`}
              >
                <span>{v.userScoped ? `· ${v.name}` : v.name}</span>
                <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                  {v.count}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
