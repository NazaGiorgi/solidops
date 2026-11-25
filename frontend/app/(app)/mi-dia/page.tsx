'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { TaskForm } from '../../../components/task-form';
import {
  compareTasksForMyDay,
  formatDay,
  formatTime,
  RECURRENCE_LABELS,
  STATUS_PILLS,
  PRIORITY_PILLS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  SLA_PILLS,
  TASK_STATUS_PILLS,
  TASK_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_PILLS,
  taskDueLabel,
  taskDuePill,
} from '../../../lib/helpers';

interface Appointment {
  id: string;
  type: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  customer?: { name: string } | null;
  technicianLinks?: Array<{ technician?: { user?: { name?: string } } | null }>;
}
interface Ticket {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaStatus: string;
  customer?: { name: string } | null;
  collaboratorRole?: 'responsable' | 'colaborador' | null;
}
interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  recurrenceRule?: string | null;
  relatedEntityType?: 'ticket' | 'customer' | null;
  relatedEntityId?: string | null;
  assignee?: { name: string } | null;
}

export default function MyDayPage() {
  const { user, hasPerm } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<Date | null>(null);
  const [undo, setUndo] = useState<{ id: string; previous: string } | null>(null);
  const [nextLabel, setNextLabel] = useState('');
  const [showTask, setShowTask] = useState(false);
  const [notice, setNotice] = useState('');
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setNow(new Date()); }, []);
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  function flash(message: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(''), 5000);
  }

  async function complete(task: Task) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const previous = task.status === 'hecha' ? 'pendiente' : task.status;
    setUndo({ id: task.id, previous });
    setTasks((all) => all.map((t) => (t.id === task.id ? { ...t, status: 'hecha' } : t)));
    undoTimer.current = setTimeout(() => {
      setTasks((all) => all.filter((t) => t.id !== task.id));
      setUndo(null);
    }, 5000);
    try {
      const res = await api.patch<{ done?: { id: string }; next?: { dueAt?: string | null } }>(
        `/tasks/${task.id}`,
        { status: 'hecha' },
      );
      if (res?.next?.dueAt) setNextLabel(`Próxima: ${formatDay(res.next.dueAt)}`);
    } catch {
      // Si falla el PATCH, devolvemos la tarea a su estado anterior.
      setTasks((all) => all.map((t) => (t.id === task.id ? { ...t, status: previous } : t)));
      setUndo(null);
    }
  }

  async function undoComplete() {
    if (!undo) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    try {
      await api.patch(`/tasks/${undo.id}`, { status: undo.previous });
      setTasks((all) => all.map((t) => (t.id === undo.id ? { ...t, status: undo.previous } : t)));
    } finally {
      setUndo(null);
    }
  }

  const sortedTasks = now
    ? [...tasks].sort((a, b) => compareTasksForMyDay(a, b, now))
    : tasks;

  function load() {
    api
      .get<{ appointments: Appointment[]; myTickets: Ticket[]; tasks: Task[] }>(
        '/dashboard/my-day',
      )
      .then((d) => {
        setAppointments(d.appointments ?? []);
        setTickets(d.myTickets ?? []);
        setTasks(d.tasks ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <Shell>
      <PageHeader title="Mi día" subtitle="Agenda, tickets y tareas para hoy" />
      {loading ? (
        <div className="empty">cargando…</div>
      ) : (
        <>
          <div className="grid-3">
            <Card title="Agenda de hoy" meta={`${appointments.length} turnos`}>
              {appointments.length === 0 ? (
                <Empty message="Sin turnos para hoy" />
              ) : (
                <div className="stack">
                  {appointments.map((a) => (
                    <div className="flex-between" key={a.id}>
                      <div>
                        <Pill style={APPOINTMENT_TYPE_PILLS[a.type] || 'pill-gray'}>
                          {APPOINTMENT_TYPE_LABELS[a.type] || a.type}
                        </Pill>
                        <div style={{ marginTop: 4, fontWeight: 500 }}>
                          {a.subject || 'sin título'}
                        </div>
                        <div className="card-meta">
                          {formatTime(a.startAt)} · {a.customer?.name || '—'}
                        </div>
                        {(a.technicianLinks?.length ?? 0) > 1 && (
                          <div className="card-meta">
                            👤 {a.technicianLinks?.map((l) => l.technician?.user?.name || 'técnico').join(', ')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Mis tickets abiertos" meta={`${tickets.length} activos`}>
              {tickets.length === 0 ? (
                <Empty message="Sin tickets activos" />
              ) : (
                <div className="stack">
                  {tickets.map((t) => (
                    <Link
                      key={t.id}
                      href={`/tickets/${t.id}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      <div className="flex-between">
                        <div>
                          <div style={{ fontWeight: 500 }}>{t.title}</div>
                          <div className="flex wrap" style={{ marginTop: 4 }}>
                            <Pill style={STATUS_PILLS[t.status] || 'pill-gray'}>
                              {STATUS_LABELS[t.status] || t.status}
                            </Pill>
                            <Pill style={PRIORITY_PILLS[t.priority] || 'pill-gray'}>
                              {PRIORITY_LABELS[t.priority] || t.priority}
                            </Pill>
                            <Pill style={SLA_PILLS[t.slaStatus] || 'pill-gray'}>
                              SLA {t.slaStatus || '—'}
                            </Pill>
                            {t.collaboratorRole === 'colaborador' && (
                              <Pill style="pill-blue">colaborador</Pill>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Tareas pendientes" meta={`${tasks.length} tareas`}>
              <div className="flex-between mb-16" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Vencidas → hoy → próximas → sin fecha
                </span>
                {hasPerm('calendar:write') && (
                  <button className="btn btn-sm" onClick={() => setShowTask(true)}>+ nueva tarea</button>
                )}
              </div>
              {notice && <div className="notice mb-8">{notice}</div>}
              {nextLabel && <div className="notice mb-8">{nextLabel}</div>}
              {undo && (
                <div className="notice flex-between mb-8">
                  <span>Hecha · Deshacer</span>
                  <button className="btn btn-sm" onClick={undoComplete}>deshacer</button>
                </div>
              )}
              {sortedTasks.length === 0 ? (
                <Empty message="Sin tareas pendientes" />
              ) : (
                <div className="stack">
                  {sortedTasks.map((task) => (
                    <div className="flex-between" key={task.id}>
                      <div className="flex" style={{ gap: 8, alignItems: 'flex-start' }}>
                        <input
                          type="checkbox"
                          aria-label={`Marcar ${task.title} como hecha`}
                          checked={task.status === 'hecha'}
                          disabled={task.status === 'hecha'}
                          onChange={() => complete(task)}
                        />
                        <div>
                          <div style={{ fontWeight: 500 }}>{task.title}</div>
                          <div className="flex wrap" style={{ marginTop: 4 }}>
                            <Pill style={now ? taskDuePill(task.dueAt, now) : 'pill-gray'}>
                              {now ? taskDueLabel(task.dueAt, now) : '—'}
                            </Pill>
                            <Pill style={TASK_STATUS_PILLS[task.status] || 'pill-gray'}>
                              {TASK_STATUS_LABELS[task.status] || task.status}
                            </Pill>
                            {task.recurrenceRule && task.recurrenceRule !== 'none' && (
                              <Pill style="pill-gray">
                                ↻ {RECURRENCE_LABELS[task.recurrenceRule]}
                              </Pill>
                            )}
                            {task.dueAt && (
                              <span className="card-meta">{formatTime(task.dueAt)}</span>
                            )}
                            {task.relatedEntityType && task.relatedEntityId && (
                              <Link className="link" href={`/${task.relatedEntityType === 'ticket' ? 'tickets' : 'clientes'}/${task.relatedEntityId}`}>
                                ver {task.relatedEntityType}
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {showTask && (
                <TaskForm
                  defaults={{ assigneeId: user?.id ?? null }}
                  onClose={() => setShowTask(false)}
                  onSaved={(task) => {
                    setShowTask(false);
                    // Recargar: el dashboard ya ordena vencidas → hoy → próximas → sin fecha.
                    load();
                    if (task?.assigneeId && task.assigneeId !== user?.id) {
                      flash(
                        `Tarea creada y asignada a ${task.assigneeName || 'otra persona'}; no aparece acá porque no es tuya`,
                      );
                    } else {
                      flash('Tarea creada');
                    }
                  }}
                />
              )}
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}
