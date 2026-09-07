'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../lib/portal-auth';

// Contexto del filtro de estado del portal (compartido entre el sidebar y la
// página de tickets). Evita duplicar el estado y permite que el sidebar controle
// el filtro sin pasar por URL params (más simple, sin Suspense).
const PortalFilterContext = createContext<{ filter: string; setFilter: (f: string) => void } | null>(null);
export function usePortalFilter() {
  const ctx = useContext(PortalFilterContext);
  if (!ctx) throw new Error('usePortalFilter must be used within PortalShell');
  return ctx;
}

export const PORTAL_FILTER_MAP: Record<string, string> = {
  all: '',
  abiertos: 'abierto,asignado,nuevo,en_progreso,esperando_cliente',
  resueltos: 'resuelto,cerrado',
};

const ESTADO_ITEMS = [
  { key: 'all', label: 'Todos', icon: '🗂' },
  { key: 'abiertos', label: 'Abiertos', icon: '📬' },
  { key: 'resueltos', label: 'Resueltos', icon: '✅' },
];

interface PortalReports {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  slaStatus: Record<string, number>;
}

// Shell del Portal de Clientes: sidebar fijo a la izquierda + contenido principal.
// Solo se muestra cuando hay sesión de portal (user); en login / !user se renderiza
// el contenido tal cual (sin sidebar).
export function PortalShell({ children }: { children: React.ReactNode }) {
  const { user, logout, loading } = usePortalAuth();
  const [filter, setFilter] = useState('all');
  const [reports, setReports] = useState<PortalReports | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<PortalReports>('/portal/reports')
      .then(setReports)
      .catch(() => {});
  }, [user]);

  if (loading) return <div className="empty">cargando…</div>;

  const byStatus = reports?.byStatus || {};
  const sum = (keys: string[]) => keys.reduce((a, k) => a + (Number(byStatus[k]) || 0), 0);
  const counts: Record<string, number> = {
    all: sum(Object.keys(byStatus)),
    abiertos: sum(['abierto', 'asignado', 'nuevo', 'en_progreso', 'esperando_cliente']),
    resueltos: sum(['resuelto', 'cerrado']),
  };

  return (
    <PortalFilterContext.Provider value={{ filter, setFilter }}>
      {!user ? (
        // Login / sin sesión: se renderiza el contenido tal cual (sin sidebar).
        children
      ) : (
        <div className="portal-app">
          <aside className="portal-sidebar">
            <div className="portal-sidebar-brand">
              <div className="portal-sidebar-logo">Solido Portal</div>
              <small>Portal de clientes</small>
            </div>

            <div className="portal-sidebar-section">
              <div className="portal-sidebar-title">Estado</div>
              {ESTADO_ITEMS.map((it) => (
                <Link
                  key={it.key}
                  href="/portal"
                  className={`portal-sidebar-item ${filter === it.key ? 'active' : ''}`}
                  onClick={() => setFilter(it.key)}
                >
                  <span className="portal-sidebar-icon">{it.icon}</span>
                  <span>{it.label}</span>
                  <span className="portal-sidebar-count">{counts[it.key] ?? 0}</span>
                </Link>
              ))}
            </div>

            <div className="portal-sidebar-section">
              <div className="portal-sidebar-title">Accesos</div>
              <Link href="/portal/presupuestos" className="portal-sidebar-item">
                <span className="portal-sidebar-icon">💰</span>
                <span>Presupuestos del taller</span>
              </Link>
            </div>

            <div className="portal-sidebar-footer">
              <button className="portal-sidebar-logout" onClick={logout}>
                Salir
              </button>
            </div>
          </aside>

          <main className="portal-main">{children}</main>
        </div>
      )}
    </PortalFilterContext.Provider>
  );
}
