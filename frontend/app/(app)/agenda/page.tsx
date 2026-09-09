'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { ErrorNotice } from '../../../components/error-notice';
import { ActivityDetailModal, ModalItem } from '../../../components/activity-detail';
import {
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_PILLS,
  TASK_STATUS_PILLS,
  TASK_STATUS_LABELS,
  formatTime,
  formatDay,
} from '../../../lib/helpers';

interface Appointment {
  id: string;
  type: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  technicianId?: string | null;
  technician?: { user?: { name?: string } } | null;
  customer?: { name: string } | null;
  ticket?: { id: string } | null;
  isPrivate?: boolean;
  createdByUserId?: string | null;
  createdBy?: { name?: string } | null;
}
interface Task {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  assignee?: { name?: string } | null;
}
interface Technician {
  id: string;
  user?: { name?: string };
}

type ViewMode = 'day' | 'week' | 'month';

export default function AgendaPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [openItem, setOpenItem] = useState<ModalItem | null>(null);
  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState<Date>(new Date());
  const [techFilter, setTechFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);

  // --- data loading ---------------------------------------------------------
  function rangeFor(mode: ViewMode, a: Date): { from: Date; to: Date; label: string } {
    if (mode === 'day') {
      const start = new Date(a);
      start.setHours(0, 0, 0, 0);
      const end = new Date(a);
      end.setHours(23, 59, 59, 999);
      return { from: start, to: end, label: formatDay(start.toISOString()) };
    }
    if (mode === 'week') {
      const start = startOfWeek(a);
      const end = new Date(start.getTime() + 7 * 86400000);
      return { from: start, to: end, label: `Semana del ${formatDay(start.toISOString())}` };
    }
    const start = new Date(a.getFullYear(), a.getMonth(), 1);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 1);
    return {
      from: start,
      to: end,
      label: a.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }),
    };
  }

  function load() {
    const { from, to } = rangeFor(view, anchor);
    const qs: string[] = [`from=${from.toISOString()}`, `to=${to.toISOString()}`];
    if (techFilter) qs.push(`technicianId=${techFilter}`);
    api
      .get<Appointment[]>(`/appointments?${qs.join('&')}`)
      .then(setAppointments)
      .catch(() => {});
    api
      .get<Task[]>(`/tasks?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then(setTasks)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    api.get<Technician[]>('/technicians').then(setTechnicians).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor, techFilter]);

  // --- drag & drop ----------------------------------------------------------
  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnter(day: Date) {
    setDragOver(day.toISOString());
  }

  function onDragLeave() {
    setDragOver(null);
  }

  async function onDrop(e: React.DragEvent, day: Date) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    const appt = appointments.find((a) => a.id === id);
    if (!appt) return;
    const target = new Date(day);
    // Preserve the original time-of-day, shift to the target day.
    target.setHours(new Date(appt.startAt).getHours(), new Date(appt.startAt).getMinutes(), 0, 0);
    const duration = new Date(appt.endAt).getTime() - new Date(appt.startAt).getTime();
    const tStart = new Date(target.getTime());
    const tEnd = new Date(target.getTime() + duration);
    try {
      await api.post(`/appointments/${id}/move`, {
        startAt: tStart.toISOString(),
        endAt: tEnd.toISOString(),
        technicianId: appt.technicianId ?? null,
      });
      setNotice('Turno movido');
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function reassign(appt: Appointment, technicianId: string) {
    const target = new Date(appt.startAt);
    const duration = new Date(appt.endAt).getTime() - target.getTime();
    try {
      await api.post(`/appointments/${appt.id}/move`, {
        startAt: target.toISOString(),
        endAt: new Date(target.getTime() + duration).toISOString(),
        technicianId: technicianId || null,
      });
      setNotice('Técnico actualizado');
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // --- derived ---------------------------------------------------------------
  const { label } = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const days = useMemo(() => {
    if (view === 'day') return [new Date(anchor)];
    if (view === 'week') return buildWeekDays(anchor);
    return buildMonthDays(anchor);
  }, [view, anchor]);

  function shift(delta: number) {
    const a = new Date(anchor);
    if (view === 'day') a.setDate(a.getDate() + delta);
    else if (view === 'week') a.setDate(a.getDate() + delta * 7);
    else a.setMonth(a.getMonth() + delta);
    setAnchor(a);
  }

  // --- header actions ---------------------------------------------------------
  const action = (
    <div className="flex wrap">
      <div className="flex">
        <button className="btn btn-sm" onClick={() => shift(-1)}>‹</button>
        <span style={{ minWidth: 160, textAlign: 'center' }}>{label}</span>
        <button className="btn btn-sm" onClick={() => shift(1)}>›</button>
      </div>
      <button className="btn btn-sm" onClick={() => setAnchor(new Date())}>hoy</button>
      <div className="flex">
        <button className={`btn btn-sm ${view === 'day' ? 'btn-primary' : ''}`} onClick={() => setView('day')}>día</button>
        <button className={`btn btn-sm ${view === 'week' ? 'btn-primary' : ''}`} onClick={() => setView('week')}>semana</button>
        <button className={`btn btn-sm ${view === 'month' ? 'btn-primary' : ''}`} onClick={() => setView('month')}>mes</button>
      </div>
      <select className="select" style={{ maxWidth: 160 }} value={techFilter} onChange={(e) => setTechFilter(e.target.value)}>
        <option value="">todos los técnicos</option>
        {technicians.map((t) => (
          <option key={t.id} value={t.id}>{t.user?.name || '—'}</option>
        ))}
      </select>
      <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ nuevo turno</button>
    </div>
  );

  return (
    <Shell>
      <PageHeader title="Agenda" subtitle="Turnos por semana o mes" action={action} />
      {notice && <div className="notice">{notice}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      {showNew && <NewAppointment onClose={() => setShowNew(false)} onCreate={() => load()} />}
      {openItem && (
        <ActivityDetailModal item={openItem} onClose={() => setOpenItem(null)} onSaved={() => load()} />
      )}

      {loading ? (
        <div className="empty">cargando…</div>
      ) : (
        <div className="grid-3" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <Card title={view === 'day' ? 'Día' : view === 'week' ? 'Semana' : 'Mes'}>
            {view === 'day' ? (
              <DayGrid
                days={days}
                appointments={appointments}
                onDragStart={onDragStart}
                onDrop={onDrop}
                dragOver={dragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                technicians={technicians}
                onReassign={reassign}
                onOpen={(id) => setOpenItem({ kind: 'appointment', id })}
              />
            ) : view === 'week' ? (
              <WeekGrid
                days={days}
                appointments={appointments}
                onDragStart={onDragStart}
                onDrop={onDrop}
                dragOver={dragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                technicians={technicians}
                onReassign={reassign}
                onOpen={(id) => setOpenItem({ kind: 'appointment', id })}
              />
            ) : (
              <MonthGrid
                days={days}
                appointments={appointments}
                onDragStart={onDragStart}
                onDrop={onDrop}
                anchor={anchor}
                dragOver={dragOver}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onOpen={(id) => setOpenItem({ kind: 'appointment', id })}
              />
            )}
          </Card>
          <Card title="Tareas" meta={`${tasks.length} en el período`}>
            {tasks.length === 0 ? (
              <Empty message="Sin tareas en el período" />
            ) : (
              <div className="stack">
                {tasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="task-row"
                    onClick={() => setOpenItem({ kind: 'task', id: t.id })}
                  >
                    <div style={{ fontWeight: 500 }}>{t.title}</div>
                    <div className="flex wrap" style={{ marginTop: 4 }}>
                      <Pill style={TASK_STATUS_PILLS[t.status] || 'pill-gray'}>
                        {TASK_STATUS_LABELS[t.status] || t.status}
                      </Pill>
                      <span className="card-meta">{t.dueAt ? formatTime(t.dueAt) : '—'}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}

// --- Day: single day, ordered by time ---------------------------------------
function DayGrid({
  days,
  appointments,
  onDragStart,
  onDrop,
  dragOver,
  onDragEnter,
  onDragLeave,
  technicians,
  onReassign,
  onOpen,
}: {
  days: Date[];
  appointments: Appointment[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, day: Date) => void;
  dragOver: string | null;
  onDragEnter: (day: Date) => void;
  onDragLeave: () => void;
  technicians: Technician[];
  onReassign: (appt: Appointment, technicianId: string) => void;
  onOpen: (id: string) => void;
}) {
  const day = days[0];
  const dayAppts = appointments
    .filter((a) => sameDay(a.startAt, day))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

  return (
    <div
      className={`day-grid ${dragOver === day.toISOString() ? 'drag-over' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => onDragEnter(day)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, day)}
    >
      <div className={`week-day-head ${isToday(day) ? 'today' : ''}`}>
        <span className="week-day-name">{weekdayName(day)}</span>
        <span>{formatDay(day.toISOString())}</span>
      </div>
      <div className="week-day-body">
        {dayAppts.length === 0 ? (
          <Empty message="Sin turnos este día" />
        ) : (
          dayAppts.map((a) => (
            <div
              key={a.id}
              className="appt-chip"
              draggable
              onDragStart={(e) => onDragStart(e, a.id)}
              onClick={() => onOpen(a.id)}
              title="Clic para editar · arrastra para mover"
            >
              <div className="appt-chip-top">
                <div className="flex wrap">
                  <Pill style={APPOINTMENT_TYPE_PILLS[a.type] || 'pill-gray'}>
                    {APPOINTMENT_TYPE_LABELS[a.type] || a.type}
                  </Pill>
                  <span className="card-meta">{formatTime(a.startAt)} – {formatTime(a.endAt)}</span>
                </div>
                <button
                  type="button"
                  className="appt-edit-btn"
                  aria-label="Editar"
                  onClick={(e) => { e.stopPropagation(); onOpen(a.id); }}
                >
                  ✎
                </button>
              </div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{a.subject || 'sin título'}</div>
              {a.customer?.name && <div className="card-meta">{a.customer.name}</div>}
              {a.technician?.user?.name && (
                <div className="card-meta">técnico: {a.technician.user.name}</div>
              )}
              <select
                className="select appt-assign"
                value={a.technicianId || ''}
                onChange={(e) => onReassign(a, e.target.value)}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">sin técnico</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{t.user?.name || '—'}</option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Week: 7 day columns with droppable days --------------------------------
function WeekGrid({
  days,
  appointments,
  onDragStart,
  onDrop,
  dragOver,
  onDragEnter,
  onDragLeave,
  technicians,
  onReassign,
  onOpen,
}: {
  days: Date[];
  appointments: Appointment[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, day: Date) => void;
  dragOver: string | null;
  onDragEnter: (day: Date) => void;
  onDragLeave: () => void;
  technicians: Technician[];
  onReassign: (appt: Appointment, technicianId: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="week-grid">
      {days.map((d) => (
        <div
          key={d.toISOString()}
          className={`week-day ${dragOver === d.toISOString() ? 'drag-over' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => onDragEnter(d)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, d)}
        >
          <div className={`week-day-head ${isToday(d) ? 'today' : ''}`}>
            <span className="week-day-name">{weekdayName(d)}</span>
            <span>{formatDay(d.toISOString())}</span>
          </div>
          <div className="week-day-body">
            {appointments
              .filter((a) => sameDay(a.startAt, d))
              .map((a) => (
                <div
                  key={a.id}
                  className="appt-chip"
                  draggable
                  onDragStart={(e) => onDragStart(e, a.id)}
                  onClick={() => onOpen(a.id)}
                  title="Clic para editar · arrastra para mover"
                >
                  <div className="appt-chip-top">
                    <div className="flex wrap">
                      <Pill style={APPOINTMENT_TYPE_PILLS[a.type] || 'pill-gray'}>
                        {APPOINTMENT_TYPE_LABELS[a.type] || a.type}
                      </Pill>
                      <span className="card-meta">{formatTime(a.startAt)}</span>
                    </div>
                    <button
                      type="button"
                      className="appt-edit-btn"
                      aria-label="Editar"
                      onClick={(e) => { e.stopPropagation(); onOpen(a.id); }}
                    >
                      ✎
                    </button>
                  </div>
              <div style={{ fontWeight: 500, fontSize: 13 }}>
                {a.subject || 'sin título'}
                {a.ticket?.id && (
                  <Link href={`/tickets/${a.ticket.id}`} style={{ marginLeft: 6, color: 'var(--blue)' }} title="Ver ticket" onClick={(e) => e.stopPropagation()}>
                    🔗 ticket
                  </Link>
                )}
              </div>
                  {a.customer?.name && <div className="card-meta">{a.customer.name}</div>}
                  {a.technician?.user?.name && (
                    <div className="card-meta">técnico: {a.technician.user.name}</div>
                  )}
                  <select
                    className="select appt-assign"
                    value={a.technicianId || ''}
                    onChange={(e) => onReassign(a, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="">sin técnico</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.user?.name || '—'}</option>
                    ))}
                  </select>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Month: simple day cells (no hour grid) ---------------------------------
function MonthGrid({
  days,
  appointments,
  onDragStart,
  onDrop,
  anchor,
  dragOver,
  onDragEnter,
  onDragLeave,
  onOpen,
}: {
  days: Date[];
  appointments: Appointment[];
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDrop: (e: React.DragEvent, day: Date) => void;
  anchor: Date;
  dragOver: string | null;
  onDragEnter: (day: Date) => void;
  onDragLeave: () => void;
  onOpen: (id: string) => void;
}) {
  const dim = (d: Date) => d.getMonth() !== anchor.getMonth();
  return (
    <>
      <div className="month-week-header">
        {WEEKDAY_HEADERS.map((name) => (
          <div key={name} className="month-week-header-cell">{name}</div>
        ))}
      </div>
      <div className="month-grid">
      {days.map((d) => (
        <div
          key={d.toISOString()}
          className={`month-day ${dim(d) ? 'outside' : ''} ${isToday(d) ? 'today' : ''} ${dragOver === d.toISOString() ? 'drag-over' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => onDragEnter(d)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, d)}
        >
          <div className="month-day-head">{d.getDate()}</div>
          <div className="month-day-body">
            {appointments
              .filter((a) => sameDay(a.startAt, d))
              .map((a) => (
                <div
                  key={a.id}
                  className="appt-chip appt-chip-sm"
                  draggable
                  onDragStart={(e) => onDragStart(e, a.id)}
                  onClick={() => onOpen(a.id)}
                  title={a.subject || ''}
                >
                  <span style={{ fontWeight: 500 }}>{a.subject || 'turno'}</span>
                  <span className="appt-chip-creator">
                    {a.isPrivate ? '🔒 ' : ''}{a.createdBy?.name || 'Creador desconocido'}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ))}
      </div>
    </>
  );
}

function NewAppointment({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: () => void;
}) {
  const [technicians, setTechnicians] = useState<Array<{ id: string; user?: { name?: string } }>>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({
    type: 'visita',
    subject: '',
    technicianId: '',
    customerId: '',
    startAt: '',
    endAt: '',
    notes: '',
    reminderMinutes: '0',
    isPrivate: false,
  });
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Array<{ id: string; user?: { name?: string } }>>('/technicians').then(setTechnicians).catch(() => {});
    api.get<Array<{ id: string; name: string }>>('/customers').then(setCustomers).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/appointments', {
        ...form,
        technicianId: form.technicianId || null,
        customerId: form.customerId || null,
        reminderMinutes: Number(form.reminderMinutes) || null,
        isPrivate: !!form.isPrivate,
      });
      onCreate();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="card mb-16">
      <h3 className="card-title">Nuevo turno</h3>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      <form onSubmit={submit} className="grid-3">
        <div className="field">
          <label>Tipo</label>
          <select className="select" value={form.type} onChange={(e) => set('type', e.target.value)}>
            <option value="reunion">reunión</option>
            <option value="visita">visita</option>
            <option value="guardia">guardia</option>
            <option value="tarea">tarea</option>
          </select>
        </div>
        <div className="field">
          <label>Asunto</label>
          <input className="input" value={form.subject} onChange={(e) => set('subject', e.target.value)} />
        </div>
        <div className="field">
          <label>Técnico</label>
          <select className="select" value={form.technicianId} onChange={(e) => set('technicianId', e.target.value)}>
            <option value="">sin asignar</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.user?.name || t.id}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Cliente</label>
          <select className="select" value={form.customerId} onChange={(e) => set('customerId', e.target.value)}>
            <option value="">sin cliente</option>
            {customers.map((cu) => (
              <option key={cu.id} value={cu.id}>{cu.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Inicio</label>
          <input className="input" type="datetime-local" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} required />
        </div>
        <div className="field">
          <label>Fin</label>
          <input className="input" type="datetime-local" value={form.endAt} onChange={(e) => set('endAt', e.target.value)} required />
        </div>
        <div className="field">
          <label>Notas</label>
          <textarea className="textarea" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="field">
          <label>Recordatorio</label>
          <select className="select" value={form.reminderMinutes} onChange={(e) => set('reminderMinutes', e.target.value)}>
            <option value="0">sin recordatorio</option>
            <option value="10">10 min antes</option>
            <option value="15">15 min antes</option>
            <option value="30">30 min antes</option>
            <option value="60">1 hora antes</option>
          </select>
        </div>
        <div className="field">
          <label>Privado</label>
          <label className="flex" style={{ gap: 8, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm((f) => ({ ...f, isPrivate: e.target.checked }))} />
            <span className="muted" style={{ fontSize: 13 }}>Privado (solo yo lo veo)</span>
          </label>
        </div>
        <div className="flex" style={{ gridColumn: 'span 3' }}>
          <button className="btn btn-primary" type="submit">crear</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>cancelar</button>
        </div>
      </form>
    </div>
  );
}

// --- date helpers ------------------------------------------------------------
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  const r = new Date(d);
  r.setDate(d.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}
function buildWeekDays(d: Date): Date[] {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000));
}
function buildMonthDays(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const cells: Date[] = [];
  for (let cur = new Date(start); cur <= last; cur.setDate(cur.getDate() + 1)) {
    cells.push(new Date(cur));
  }
  return cells;
}
function sameDay(a: string, b: Date): boolean {
  const da = new Date(a);
  return da.getFullYear() === b.getFullYear() && da.getMonth() === b.getMonth() && da.getDate() === b.getDate();
}
function isToday(d: Date): boolean {
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

// Nombre completo del día de la semana (es-AR), consistente con la localización
// del resto del archivo (p.ej. toLocaleDateString('es-AR', { month, year })).
function weekdayName(d: Date): string {
  return d.toLocaleDateString('es-AR', { weekday: 'long' });
}

// Encabezado fijo de la vista de mes: el calendario arranca en lunes (startOfWeek),
// así que las 7 columnas son lunes..domingo. Se genera desde una semana de
// referencia para no hardcodear los strings.
const WEEKDAY_HEADERS = Array.from({ length: 7 }, (_, i) =>
  new Date(startOfWeek(new Date()).getTime() + i * 86400000).toLocaleDateString('es-AR', { weekday: 'long' }),
);
