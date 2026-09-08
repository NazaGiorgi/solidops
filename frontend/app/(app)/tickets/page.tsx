'use client';
import { Suspense, useEffect, useCallback, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { useAuth } from '../../../lib/auth';
import { PageHeader, Card, Empty } from '../../../components/ui';
import { TicketList } from '../../../components/ticket-list';
import { ErrorNotice } from '../../../components/error-notice';
import { STATUS_LABELS } from '../../../lib/helpers';

interface Ticket {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaStatus?: string;
  createdAt: string;
  source?: string | null;
  customer?: { name: string } | null;
  technician?: { user?: { name?: string } } | null;
  technicianId?: string | null;
  mergedIntoId?: string | null;
  shadow?: boolean;
  workshop?: { equipmentId: string; contactName?: string | null } | null;
}

export default function TicketsPage() {
  // El estado del acordeón de la sección vive ACÁ. No usamos useSearchParams ni
  // Suspense en este componente (la lectura de params se hace de forma simple en
  // TicketsContent), así TicketsContent NO re-suspende y el acordeón es estable.
  const [ticketsExpanded, setTicketsExpanded] = useState(true);
  const onToggle = useCallback(() => setTicketsExpanded((v) => !v), []);

  return (
    <Shell>
      {/* useSearchParams suspende el render de TicketsContent si no hay un Suspense
          por encima. Envolvemos solo este subárbol: el estado del acordeón
          (ticketsExpanded) vive en TicketsPage, fuera del Suspense, así que NO se
          pierde (a diferencia de cuando el estado vivía dentro y se re-montaba). */}
      <Suspense fallback={<div className="empty">cargando…</div>}>
        <TicketsContent expanded={ticketsExpanded} onToggle={onToggle} />
      </Suspense>
    </Shell>
  );
}

function TicketsContent({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Leemos los query params con useSearchParams: a diferencia de leer
  // window.location.search en el cuerpo del render, este hook SE ACTUALIZA al
  // navegar (client-side), re-renderizando el componente. Sin esto, al navegar
  // desde el SIDEBAR (<Link href="/tickets?tray=Users">) el componente no se
  // re-renderizaba, `tray` quedaba con el valor viejo y `load()` nunca corría
  // (solo F5 lo arreglaba). El estado del acordeón NO usa search params, así que
  // no se pierde.
  const useSP = useSearchParams();
  const tray = useSP.get('tray') || 'support';
  const view = useSP.get('view') || undefined;
  const customerId = useSP.get('customerId') || undefined;
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const [status, setStatus] = useState('');
  const [merge, setMerge] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [showShadow, setShowShadow] = useState(false);
  const [ticketGroups, setTicketGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveGroupId, setMoveGroupId] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Array<{ id: string; name: string }>>('/ticket-groups')
      .then((gs) => setTicketGroups(gs || []))
      .catch(() => {});
  }, []);

  const TRAY_OPTIONS = [
    { v: 'support', l: 'Soporte (L1/L2/L3)' },
    { v: 'general', l: 'General (ruido migrado)' },
    { v: 'L1', l: 'Bandeja L1' },
    { v: 'L2', l: 'Bandeja L2' },
    { v: 'L3', l: 'Bandeja L3' },
    { v: 'Users', l: 'Users' },
    { v: 'Backups MK', l: 'Backups MK' },
    { v: 'Taller', l: 'Taller' },
    { v: 'Ventas', l: 'Ventas' },
    { v: 'Mesa de ayuda', l: 'Mesa de ayuda' },
    { v: 'nativo', l: 'Nativos (SolidOps)' },
    { v: 'all', l: 'Todas' },
  ];

  function load() {
    const query: string[] = [];
    if (customerId) query.push(`customerId=${customerId}`);
    if (status) query.push(`status=${status}`);
    if (merge) query.push(`merge=${merge}`);
    if (view) query.push(`view=${encodeURIComponent(view)}`);
    else if (tray) query.push(`tray=${encodeURIComponent(tray)}`);
    if (search) query.push(`search=${encodeURIComponent(search)}`);
    if (showShadow) query.push('shadow=true');
    if (page) query.push(`page=${page}`);
    if (pageSize) query.push(`take=${pageSize}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    api
      .get<{ items: Ticket[]; total: number; page: number }>(`/tickets${qs}`)
      .then((res) => {
        // El backend ahora devuelve { items, total, page } (paginado). Maneja
        // ambas formas por robustez: si viniera un array plano (versión vieja),
        // se adapta.
        const data = Array.isArray(res) ? { items: res, total: res.length, page: 1 } : res;
        setTickets(data?.items || []);
        setTotal(data?.total ?? 0);
        if (data?.page) setPage(data.page);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, merge, tray, view, customerId, showShadow, page]);

  function changeTray(next: string) {
    const params = new URLSearchParams(useSP.toString());
    if (next === 'support') params.delete('tray');
    else params.set('tray', next);
    params.delete('view');
    const qs = params.toString();
    setPage(1);
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      const allSelected = tickets.length > 0 && tickets.every((t) => prev.has(t.id));
      const next = new Set<string>();
      if (!allSelected) tickets.forEach((t) => next.add(t.id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setMoveOpen(false);
    setMoveGroupId('');
    setDeleteOpen(false);
  }

  async function bulkMove() {
    if (!moveGroupId) return;
    setError('');
    try {
      const res = await api
        .patch<{ moved: number; count: number }>('/tickets/bulk-move', {
          ticketIds: Array.from(selectedIds),
          groupId: moveGroupId,
        })
        .then((r: unknown) => r as { moved: number; count: number });
      const groupName = ticketGroups.find((g) => g.id === moveGroupId)?.name || 'box';
      setNotice(`Se movieron ${res.moved} tickets a "${groupName}"`);
      setTimeout(() => setNotice(''), 2500);
      clearSelection();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function bulkDelete() {
    setError('');
    try {
      const res = await api
        .delete<{ deleted: number; count: number }>('/tickets/bulk-delete', {
          ticketIds: Array.from(selectedIds),
        })
        .then((r: unknown) => r as { deleted: number; count: number });
      setNotice(`Se eliminaron ${res.deleted} tickets`);
      setTimeout(() => setNotice(''), 2500);
      clearSelection();
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Tickets"
        subtitle="Todos los tickets de soporte"
        action={
          <button className="btn btn-primary" onClick={() => setNewOpen(true)}>
            + nuevo ticket
          </button>
        }
      />
      {newOpen && <NewTicketForm onClose={() => setNewOpen(false)} onCreated={() => load()} />}
      {notice && <div className="notice" style={{ marginBottom: 10 }}>{notice}</div>}
      {error && <div style={{ marginBottom: 10 }}><ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} /></div>}

      {/* Barra de acciones masivas con ALTURA SIEMPRE RESERVADA: aparece/desaparece
          sin desplazar la lista (si se monta/desmonta, las filas se mueven bajo el
          cursor y los clics caen en el elemento equivocado). */}
      <div
        className="flex wrap"
        style={{
          gap: 8,
          alignItems: 'center',
          marginBottom: 14,
          padding: '8px 12px',
          minHeight: 42,
          background: selectedIds.size > 0 ? 'var(--bg-subtle)' : 'transparent',
          borderRadius: 8,
          border: selectedIds.size > 0 ? '1px solid var(--border-strong)' : '1px solid transparent',
        }}
      >
        <span className="muted" style={{ fontSize: 13 }}>{selectedIds.size} seleccionados</span>
        <button className="btn btn-sm" disabled={selectedIds.size === 0} onClick={() => setMoveOpen((v) => !v)}>
          Mover a…
        </button>
        <button className="btn btn-danger btn-sm" disabled={selectedIds.size === 0} onClick={() => setDeleteOpen((v) => !v)}>
          Eliminar
        </button>
        {deleteOpen && selectedIds.size > 0 && (
          <>
            <span className="muted" style={{ fontSize: 13 }}>
              ¿Seguro que querés eliminar {selectedIds.size} tickets? Esta acción los oculta de todos los listados.
            </span>
            <button className="btn btn-primary btn-sm" onClick={bulkDelete}>
              sí, eliminar
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleteOpen(false)}>
              cancelar
            </button>
          </>
        )}
        {moveOpen && selectedIds.size > 0 && (
          <>
            <select className="select" style={{ maxWidth: 220 }} value={moveGroupId} onChange={(e) => setMoveGroupId(e.target.value)}>
              <option value="">elegir box…</option>
              {ticketGroups.filter((g) => g.name !== tray).map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-sm" onClick={bulkMove} disabled={!moveGroupId}>mover</button>
          </>
        )}
        <button className="btn btn-ghost btn-sm" disabled={selectedIds.size === 0} onClick={clearSelection}>cancelar selección</button>
      </div>

      <Card>
        <button
          type="button"
          className="ticket-section-toggle"
          onClick={() => {
            // [DIAG] el click llega y el estado se pasa al padre (fuera de Suspense).
            console.log('TICKETS CLICK');
            onToggle();
          }}
          aria-expanded={expanded}
          aria-controls="tickets-list"
        >
          <span className="ticket-section-title">TICKETS</span>
          <span className={`ticket-section-chevron ${expanded ? 'open' : ''}`} aria-hidden="true">
            {expanded ? '▲' : '▼'}
          </span>
        </button>

        <div className="flex wrap mb-16" style={{ marginTop: 10 }}>
          <select className="select" style={{ maxWidth: 180 }} value={tray} onChange={(e) => changeTray(e.target.value)}>
            {TRAY_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.l}
              </option>
            ))}
          </select>
          <input
            className="input"
            style={{ maxWidth: 300 }}
            placeholder="buscar por título o número (TK-2026-123)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <select className="select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">todos los estados</option>
            {Object.keys(STATUS_LABELS).map((k) => (
              <option key={k} value={k}>
                {STATUS_LABELS[k]}
              </option>
            ))}
          </select>
          <select className="select" style={{ maxWidth: 180 }} value={merge} onChange={(e) => setMerge(e.target.value)}>
            <option value="">todas las fusiones</option>
            <option value="parents">solo padres con fusión</option>
            <option value="children">solo hijos fusionados</option>
            <option value="exclude">excluir fusionados</option>
          </select>
          <button
            className={`btn btn-sm ${showShadow ? 'btn-primary' : ''}`}
            onClick={() => setShowShadow((v) => !v)}
            title="Ver los tickets en modo sombra (Zammad aún procesa la casilla)"
          >
            ☁ modo sombra
          </button>
        </div>

        {expanded && (
          <div id="tickets-list">
            {loading ? (
              <div className="empty">cargando…</div>
            ) : tickets.length === 0 ? (
              <Empty message="No hay tickets para los filtros elegidos" />
            ) : (
              <>
                <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                  <label className="flex" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={tickets.length > 0 && tickets.every((t) => selectedIds.has(t.id))} onChange={toggleAll} />
                    <span className="muted">seleccionar todos ({tickets.length})</span>
                  </label>
                </div>
                <TicketList
                  tickets={tickets}
                  mineIds={
                    new Set(
                      tickets
                        .filter((t) => !!user?.technicianId && t.technicianId === user.technicianId)
                        .map((t) => t.id),
                    )
                  }
                  selectedIds={selectedIds}
                  onToggle={toggleSelected}
                />
                <div className="flex wrap justify-between" style={{ marginTop: 12, gap: 8, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 13 }}>
                    mostrando {tickets.length} de {total} · página {page}
                  </span>
                  <div className="flex" style={{ gap: 6 }}>
                    <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                      ‹ anterior
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={page * pageSize >= total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      siguiente ›
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </Card>
    </>
  );
}

function NewTicketForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [sales, setSales] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Array<{ id: string; name: string }>>('/customers')
      .then(setCustomers)
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/tickets', sales);
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: string, v: string) => setSales((s) => ({ ...s, [k]: v }));

  return (
    <div className="card mb-16">
      <h3 className="card-title">Nuevo ticket</h3>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      <form onSubmit={submit} className="grid-3">
        <div className="field">
          <label>Cliente</label>
          <select className="select" required value={sales.customerId || ''} onChange={(e) => set('customerId', e.target.value)}>
            <option value="">elegir cliente…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Título</label>
          <input className="input" required value={sales.title || ''} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="field">
          <label>Prioridad</label>
          <select className="select" value={sales.priority || 'normal'} onChange={(e) => set('priority', e.target.value)}>
            <option value="baja">baja</option>
            <option value="normal">normal</option>
            <option value="alta">alta</option>
            <option value="critica">crítica</option>
          </select>
        </div>
        <div className="field">
          <label>Descripción</label>
          <textarea className="textarea" value={sales.description || ''} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="flex justify-end" style={{ gridColumn: 'span 3', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            cancelar
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'creando…' : 'crear ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
