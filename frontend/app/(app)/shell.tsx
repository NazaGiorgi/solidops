'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useAuth } from '../../lib/auth';
import { useEffect, useState, useRef, useCallback, Fragment } from 'react';
import { useNotificationsSocket } from '../../lib/use-notifications';
import { useAgendaReminders } from '../../components/use-agenda-reminders';
import { useNewTicketToast } from '../../components/use-new-ticket-toast';
import { BrandLogo } from '../../components/brand-logo';
import { api } from '../../lib/api';
import { isSoundEnabled, setSoundEnabled, subscribeSound } from '../../lib/sound';
import { useTheme } from '../../lib/theme';

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
// parentId/aggregateCount/childrenCount llegan del backend (/ticket-groups) para
// armar el árbol: un box contenedor suma sus tickets + los de todos sus sub-boxes.
interface TicketGroup {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
  parentId: string | null;
  aggregateCount: number;
  childrenCount: number;
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

// Preferencias de colapso del sidebar (localStorage).
const KEY_TICKETS_COLLAPSED = 'solidops_tickets_sidebar_collapsed';
const KEY_BOX_COLLAPSED = 'solidops_sidebar_box_collapsed';
const KEY_VIEWS_COLLAPSED = 'solidops_sidebar_views_collapsed';

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* best-effort */
  }
}

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
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
  useEffect(() => subscribeSound(() => setSoundOn(isSoundEnabled())), []);
  // Colapso del árbol de bandejas: se hidrata desde localStorage en un useEffect
  // (no en el init) para no divergir entre el render de servidor y el cliente.
  const [ticketsCollapsed, setTicketsCollapsed] = useState(false);
  useEffect(() => {
    setTicketsCollapsed(readFlag(KEY_TICKETS_COLLAPSED));
  }, []);
  const toggleTicketsCollapsed = () => {
    setTicketsCollapsed((c) => {
      writeFlag(KEY_TICKETS_COLLAPSED, !c);
      return !c;
    });
  };
  const reloadCatalog = useCallback(() => {
    api
      .get<TicketGroup[]>('/ticket-groups')
      .then((g) => setTicketGroups(g || []))
      .catch(() => {});
  }, []);
  const { theme, toggle } = useTheme();
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
              {n.href === '/tickets' && hasPerm('tickets:read') ? (
                <div className="sidebar-nav-row">
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
                  <button
                    className="sidebar-nav-chevron"
                    onClick={toggleTicketsCollapsed}
                    title={ticketsCollapsed ? 'Mostrar bandejas' : 'Ocultar bandejas'}
                  >
                    {ticketsCollapsed ? '▸' : '▾'}
                  </button>
                </div>
              ) : (
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
              )}
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
                  <TicketSidebarLinks
                    groups={trayGroups}
                    catalog={ticketGroups}
                    views={savedViews}
                    hasPerm={hasPerm}
                    collapsed={ticketsCollapsed}
                    onReloadCatalog={reloadCatalog}
                  />
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
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSoundEnabled(!soundOn)}
              title={soundOn ? 'Sonido activado — silenciar notificaciones' : 'Sonido silenciado — activar notificaciones'}
            >
              {soundOn ? '🔊' : '🔇'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={toggle}
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
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
  collapsed,
  onReloadCatalog,
}: {
  groups: TrayGroup[];
  catalog: TicketGroup[];
  views: TrayView[];
  hasPerm: (p: string) => boolean;
  collapsed: boolean;
  onReloadCatalog: () => void;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { user } = useAuth();
  const isTickets = pathname.startsWith('/tickets');
  const tray = params.get('tray');
  const view = params.get('view');

  if (!hasPerm('tickets:read')) return null;

  const canManage = user?.role === 'Administrador' || user?.role === 'Supervisor';

  // Mapa de counts por bandeja (desde groupCounts); solo se usa para 'nativo'.
  const counts = new Map(groups.map((g) => [g.tray, g.count]));

  // Árbol de boxes: solo activos y no ocultos por vista (HIDDEN_TRAY_GROUPS).
  // El backend ya ordena el catálogo por sortOrder+name; se respeta ese orden.
  const activeBoxes = catalog.filter((c) => c.active && !HIDDEN_TRAY_GROUPS.has(c.name));
  const activeIds = new Set(activeBoxes.map((b) => b.id));
  const byParent = new Map<string, TicketGroup[]>();
  for (const b of activeBoxes) {
    if (b.parentId && activeIds.has(b.parentId)) {
      const arr = byParent.get(b.parentId) ?? [];
      arr.push(b);
      byParent.set(b.parentId, arr);
    }
  }
  const roots = activeBoxes.filter((b) => !b.parentId || !activeIds.has(b.parentId));

  // Profundidad de cada box (para indentar el menú "Mover a…").
  const depthOf = new Map<string, number>();
  const visit = (bs: TicketGroup[], d: number): void => {
    for (const b of bs) {
      depthOf.set(b.id, d);
      const kids = byParent.get(b.id);
      if (kids) visit(kids, d + 1);
    }
  };
  visit(roots, 0);

  // Descendientes de un box (para no ofrecerlos como destino: evitaría ciclos).
  const descendantsOf = (box: TicketGroup): Set<string> => {
    const out = new Set<string>();
    const stack = [...(byParent.get(box.id) ?? [])];
    while (stack.length) {
      const c = stack.pop() as TicketGroup;
      out.add(c.id);
      const kids = byParent.get(c.id);
      if (kids) stack.push(...kids);
    }
    return out;
  };

  // Colapso de contenedores del sidebar (persistido por box).
  const [collapsedBoxes, setCollapsedBoxes] = useState<Set<string>>(new Set());
  useEffect(() => {
    const saved = new Set<string>();
    for (const b of activeBoxes) {
      if (readFlag(`${KEY_BOX_COLLAPSED}_${b.id}`)) saved.add(b.id);
    }
    setCollapsedBoxes(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog.length]);
  // Colapso de la sección "Vistas" (vistas guardadas / overviews de Zammad),
  // independiente del colapso de boxes. Se hidrata en un effect (no init) para
  // no divergir entre render de servidor y cliente.
  const [viewsCollapsed, setViewsCollapsed] = useState(false);
  useEffect(() => {
    setViewsCollapsed(readFlag(KEY_VIEWS_COLLAPSED));
  }, []);
  const toggleViews = () => {
    setViewsCollapsed((c) => {
      writeFlag(KEY_VIEWS_COLLAPSED, !c);
      return !c;
    });
  };
  const toggleBox = (id: string) => {
    setCollapsedBoxes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        writeFlag(`${KEY_BOX_COLLAPSED}_${id}`, false);
      } else {
        next.add(id);
        writeFlag(`${KEY_BOX_COLLAPSED}_${id}`, true);
      }
      return next;
    });
  };

  // Menú "Mover a…" en línea: un <select> con los destinos posibles.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const moveBox = async (box: TicketGroup, parentId: string | null) => {
    setMenuFor(null);
    try {
      await api.patch(`/ticket-groups/${box.id}/move`, { parentId });
      onReloadCatalog();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[sidebar] no se pudo mover el box', e);
      const msg = e instanceof Error && e.message ? e.message : 'No se pudo mover el box';
      window.alert(msg);
    }
  };

  const sortedViews = [...views].sort((a, b) => a.prio - b.prio);

  const renderTray = (box: TicketGroup): React.ReactElement => {
    const children = byParent.get(box.id) ?? [];
    const isCollapsed = collapsedBoxes.has(box.id);
    const active = isTickets && tray === box.name;
    const descendants = descendantsOf(box);
    return (
      <Fragment key={box.id}>
        <div className="sidebar-tray-row">
          {children.length > 0 ? (
            <button
              className="sidebar-chevron"
              onClick={() => toggleBox(box.id)}
              title={isCollapsed ? 'Expandir' : 'Colapsar'}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="sidebar-chevron" style={{ cursor: 'default' }} />
          )}
          <Link
            href={`/tickets?tray=${encodeURIComponent(box.name)}`}
            className={`sidebar-link sidebar-link-sub sidebar-tray-link ${active ? 'active' : ''}`}
          >
            <span style={{ color: box.color ?? undefined }}>{TRAY_LABELS[box.name] || box.name}</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {box.aggregateCount}
            </span>
          </Link>
          {canManage && (
            <button
              className="sidebar-tray-move"
              onClick={() => setMenuFor(menuFor === box.id ? null : box.id)}
              title="Mover a otro contenedor"
            >
              ⋮
            </button>
          )}
        </div>
        {canManage && menuFor === box.id && (
          <select
            className="sidebar-move-select"
            autoFocus
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return;
              if (v === '__root__') void moveBox(box, null);
              else void moveBox(box, v);
            }}
            onBlur={() => setMenuFor(null)}
          >
            <option value="">Mover a…</option>
            {box.parentId !== null && <option value="__root__">Nivel superior (sin contenedor)</option>}
            {activeBoxes
              .filter((d) => d.id !== box.id && !descendants.has(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {'\u00A0\u00A0'.repeat(depthOf.get(d.id) ?? 0)}
                  {TRAY_LABELS[d.name] || d.name}
                </option>
              ))}
          </select>
        )}
        {children.length > 0 && !isCollapsed && (
          <div className="sidebar-tray-children">{children.map((c) => renderTray(c))}</div>
        )}
      </Fragment>
    );
  };

  return (
    <div className="sidebar-sub">
      {!collapsed && (
        <>
          <Link
            href="/tickets?tray=nativo"
            className={`sidebar-link sidebar-link-sub sidebar-tray-link ${isTickets && tray === 'nativo' ? 'active' : ''}`}
          >
            <span>{TRAY_LABELS.nativo}</span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
              {counts.get('nativo') ?? 0}
            </span>
          </Link>
          {roots.map((r) => renderTray(r))}
          {sortedViews.length > 0 && (
            <div
              className="sidebar-sub"
              style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 4, paddingTop: 4 }}
            >
              <div className="sidebar-tray-row">
                <button
                  className="sidebar-chevron"
                  onClick={toggleViews}
                  aria-expanded={!viewsCollapsed}
                  title={viewsCollapsed ? 'Expandir vistas guardadas' : 'Colapsar vistas guardadas'}
                >
                  {viewsCollapsed ? '▸' : '▾'}
                </button>
                <span className="sidebar-link sidebar-link-sub sidebar-tray-link sidebar-views-label">
                  Vistas
                </span>
              </div>
              {!viewsCollapsed && sortedViews.map((v) => {
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
        </>
      )}
    </div>
  );
}
