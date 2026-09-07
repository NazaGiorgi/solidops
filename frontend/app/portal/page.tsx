'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { usePortalAuth } from '../../lib/portal-auth';
import { usePortalFilter, PORTAL_FILTER_MAP } from './portal-shell';
import { Pill } from '../../components/ui';
import { ErrorNotice } from '../../components/error-notice';
import { PieChartCard, toData, STATUS_COLORS, PRIORITY_COLORS, SLA_COLORS } from '../../components/pie-chart';
import { STATUS_PILLS, STATUS_LABELS, timeAgo, ticketNumberDisplay } from '../../lib/helpers';

interface PortalTicket {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaStatus?: string;
  createdAt: string;
  ticketNumber?: number | null;
  customer?: { name?: string } | null;
  technician?: { user?: { name?: string } } | null;
}

export default function PortalHomePage() {
  const { user, loading } = usePortalAuth();
  const { filter } = usePortalFilter();
  const statusFilter = PORTAL_FILTER_MAP[filter] || '';
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [error, setError] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [reports, setReports] = useState<{
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    slaStatus: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  function load() {
    if (!user) return;
    const qs = new URLSearchParams();
    if (statusFilter) qs.set('status', statusFilter);
    if (debouncedSearch) qs.set('search', debouncedSearch);
    api
      .get<PortalTicket[]>(`/portal/tickets${qs.toString() ? `?${qs.toString()}` : ''}`)
      .then(setTickets)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingTickets(false));
    // Load client reports (their own tickets / SLA) once.
    api
      .get<typeof reports>('/portal/reports')
      .then(setReports)
      .catch(() => {});
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, statusFilter, debouncedSearch]);

  // Client-side filter by title or public number (instant feedback while typing).
  const visible = tickets.filter((t) => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      ticketNumberDisplay(t).toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="empty">cargando…</div>;
  if (!user) {
    return (
      <div className="empty">
        <Link href="/portal/login" className="link">ir al login del portal</Link>
      </div>
    );
  }

  return (
    <>
      {!user.customerId && (
        <div className="notice notice-shadow">
          Tu cuenta todavía no está asociada a una empresa. Un operador de soporte va a revisar tu
          registro y asignarla; mientras tanto no podés crear tickets.
        </div>
      )}

      <div className="portal-main-head">
        <h1 className="portal-main-title">Tickets</h1>
        {user.customerId && (
          <button className="portal-new-btn" onClick={() => setNewOpen(true)}>＋ nuevo ticket</button>
        )}
      </div>

      <div className="portal-search portal-search-inline">
        <span className="search-icon">⌕</span>
        <input
          placeholder="Buscar en tus tickets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}

      {newOpen && <NewPortalTicket onClose={() => setNewOpen(false)} onCreated={() => load()} />}

      {loadingTickets ? (
        <div className="empty">cargando…</div>
      ) : visible.length === 0 ? (
        <div className="empty" style={{ padding: '48px' }}>Todavía no tenés tickets con este filtro</div>
      ) : (
        <div className="portal-tickets-stack">
          {visible.map((t) => (
            <Link key={t.id} href={`/portal/tickets/${t.id}`} className="portal-ticket-card">
              {ticketNumberDisplay(t) && (
                <span className="pill pill-blue portal-ticket-num">{ticketNumberDisplay(t)}</span>
              )}
              <Pill style={STATUS_PILLS[t.status] || 'pill-gray'}>{STATUS_LABELS[t.status] || t.status}</Pill>
              <span className="portal-ticket-subject">{t.title}</span>
              <span className="portal-card-time">{timeAgo(t.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}

      {reports && (
        <div className="portal-reports">
          <h2 className="portal-sub" style={{ fontWeight: 600, margin: '26px 0 12px' }}>Resumen de tus consultas</h2>
          <div className="portal-grid">
            <PieChartCard title="Por estado" data={toData(reports.byStatus, STATUS_COLORS)} />
            <PieChartCard title="Por prioridad" data={toData(reports.byPriority, PRIORITY_COLORS)} />
            <PieChartCard title="Cumplimiento SLA" data={toData(reports.slaStatus, SLA_COLORS)} />
          </div>
        </div>
      )}
    </>
  );
}

function NewPortalTicket({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/portal/tickets', form);
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb-16">
      <h3 className="card-title">Nuevo ticket</h3>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}
      <form onSubmit={submit}>
        <div className="field">
          <label>Título</label>
          <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
        </div>
        <div className="field">
          <label>Descripción</label>
          <textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="flex">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'enviando…' : 'enviar'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>cancelar</button>
        </div>
      </form>
    </div>
  );
}
