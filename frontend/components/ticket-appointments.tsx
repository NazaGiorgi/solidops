'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';
import { Card, Empty, Pill } from './ui';
import { formatDate, formatTime } from '../lib/helpers';

interface Appointment {
  id: string;
  subject: string | null;
  type: string;
  status: string;
  startAt: string;
  endAt: string;
  reminderMinutes: number | null;
  technician?: { user?: { name?: string } } | null;
  technicianLinks?: Array<{ technicianId: string; technician?: { user?: { name?: string } } | null }>;
  ticket?: { id: string } | null;
}
interface TechnicianOption { id: string; name?: string; user?: { name?: string } }

export function TicketAppointments({ ticketId }: { ticketId: string }) {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  function load() {
    api.get<Appointment[]>(`/appointments?ticketId=${ticketId}`).then(setAppts).catch(() => setAppts([])).finally(() => setLoading(false));
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticketId]);

  const list = [...appts].sort((a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime());

  return (
    <Card title="Citas agendadas" meta={`${appts.length}`}>
      <div className="flex-between mb-16" style={{ gap: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {appts.length === 0 ? 'Sin citas vinculadas a este ticket' : 'Visitas y citas programadas'}
        </span>
        <button className="btn btn-sm" onClick={() => setCreating(true)}>+ agendar cita</button>
      </div>
      {loading ? (
        <div className="empty">cargando…</div>
      ) : list.length === 0 ? (
        <Empty message="Sin citas" />
      ) : (
        <div className="stack">
          {list.map((a) => (
            <div key={a.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="flex-between">
                <strong>{a.subject || (a.type === 'visita' ? 'Visita' : 'Cita')}</strong>
                <Link href={`/agenda?appointment=${a.id}`} className="link" style={{ fontSize: 13 }}>ver en agenda →</Link>
              </div>
              <div className="card-meta">
                {formatDate(a.startAt)} {formatTime(a.startAt)} · {PillStatus(a.status)}
              </div>
              <div className="flex wrap" style={{ gap: 4, marginTop: 4 }}>
                {(a.technicianLinks?.length ? a.technicianLinks : []).map((l) => (
                  <Pill key={l.technicianId} style="pill-gray">👤 {l.technician?.user?.name || 'técnico'}</Pill>
                ))}
              </div>
              {a.ticket && <div className="card-meta" style={{ marginTop: 4 }}>🔗 ticket #{a.ticket.id.slice(0, 8)}</div>}
            </div>
          ))}
        </div>
      )}
      {creating && <AppointmentForm ticketId={ticketId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </Card>
  );
}

function PillStatus(s: string) {
  const m: Record<string, { label: string; style: string }> = {
    programado: { label: 'programado', style: 'pill-blue' },
    completado: { label: 'completado', style: 'pill-green' },
    cancelado: { label: 'cancelado', style: 'pill-gray' },
    pospuesto: { label: 'pospuesto', style: 'pill-amber' },
  };
  const e = m[s] || { label: s, style: 'pill-gray' };
  return <Pill style={e.style}>{e.label}</Pill>;
}

function AppointmentForm({ ticketId, onClose, onSaved }: { ticketId: string; onClose: () => void; onSaved: () => void }) {
  const [subject, setSubject] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [selected, setSelected] = useState<string[]>([]);
  const [techs, setTechs] = useState<TechnicianOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showTechs, setShowTechs] = useState(false);
  const [techQuery, setTechQuery] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    api
      .get<TechnicianOption[]>('/technicians')
      .then((ts) => setTechs(ts || []))
      .catch(() => setTechs([]));
  }, []);

  const techName = (t: TechnicianOption) => t.name || t.user?.name || 'Técnico sin nombre';
  const techOptions = techs.map((t) => ({ id: t.id, label: techName(t) }));
  const filtered = techOptions.filter((t) => !techQuery || t.label.toLowerCase().includes(techQuery.toLowerCase()));

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || !time) { setError('Elegí fecha y hora'); return; }
    if (selected.length === 0) { setError('Elegí al menos un técnico'); return; }
    setBusy(true); setError('');
    const start = new Date(`${date}T${time}`);
    const end = new Date(start.getTime() + duration * 60000);
    try {
      await api.post('/appointments', {
        type: 'visita',
        ticketId,
        customerId: (await api.get<any>(`/tickets/${ticketId}`)).customerId ?? null,
        technicianId: selected[0],
        technicianIds: selected,
        subject: subject.trim() || 'Visita técnica',
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        reminderMinutes: 30,
        isPrivate,
      });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head flex-between">
          <h3 className="card-title" style={{ margin: 0 }}>Agendar cita</h3>
          <button className="notice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body stack" style={{ gap: 10 }}>
            {error && <div className="notice notice-error">{error}</div>}
            <div className="field">
              <label>Título (opcional)</label>
              <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ej. Visita técnica" />
            </div>
            <div className="grid-2">
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="field">
              <label>Duración</label>
              <select className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                <option value={30}>30 min</option>
                <option value={60}>1 h</option>
                <option value={90}>1 h 30</option>
                <option value={120}>2 h</option>
              </select>
            </div>
            <div className="field">
              <label>Técnicos asignados ({selected.length})</label>
              <div className="multi-select" style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="input"
                  style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                  onClick={() => setShowTechs((v) => !v)}
                >
                  {selected.length === 0
                    ? 'Elegí de la lista…'
                    : selected
                        .map((id) => {
                          const o = techOptions.find((x) => x.id === id);
                          return o ? o.label : '—';
                        })
                        .join(', ')}
                  <span className="card-meta" style={{ float: 'right' }}>▾</span>
                </button>
                {showTechs && (
                  <div
                    style={{
                      position: 'absolute', left: 0, right: 0, top: 'calc(100% + 2px)',
                      background: 'var(--bg, #fff)', border: '1px solid var(--border)',
                      borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,.08)', zIndex: 20,
                      maxHeight: 220, overflow: 'auto',
                    }}
                  >
                    <input
                      className="input"
                      placeholder="filtrar técnicos…"
                      value={techQuery}
                      onChange={(e) => setTechQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ border: 'none', borderBottom: '1px solid var(--border)', borderRadius: 0, position: 'sticky', top: 0, width: '100%' }}
                      autoFocus
                    />
                    {filtered.length === 0 && (
                      <div className="card-meta" style={{ padding: '10px 12px' }}>sin resultados</div>
                    )}
                    {filtered.map((o) => (
                      <label
                        key={o.id}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                          cursor: 'pointer', background: selected.includes(o.id) ? 'var(--bg-hover, #f2f2f3)' : 'none',
                        }}
                      >
                        <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              {selected.length > 0 && (
                <div className="flex wrap" style={{ gap: 4, marginTop: 6 }}>
                  {selected.map((id) => {
                    const o = techOptions.find((x) => x.id === id);
                    return <Pill key={id} style="pill-blue">{o?.label || 'técnico'} <button type="button" className="link" style={{ background:'none', border:'none', padding:0, color:'inherit' }} onClick={() => toggle(id)}>×</button></Pill>;
                  })}
                </div>
              )}
            </div>
            <label className="flex" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
              <span className="muted" style={{ fontSize: 13 }}>Privado (solo yo lo veo)</span>
            </label>
          </div>
          <div className="modal-foot flex justify-end" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>cancelar</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'agendando…' : 'agendar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
