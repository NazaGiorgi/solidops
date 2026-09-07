'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import {
  formatTime,
  STATUS_PILLS,
  PRIORITY_PILLS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  SLA_PILLS,
  TASK_STATUS_PILLS,
  TASK_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  APPOINTMENT_TYPE_PILLS,
} from '../../../lib/helpers';

interface Appointment {
  id: string;
  type: string;
  subject: string | null;
  startAt: string;
  endAt: string;
  customer?: { name: string } | null;
}
interface Ticket {
  id: string;
  title: string;
  status: string;
  priority: string;
  slaStatus: string;
  customer?: { name: string } | null;
}
interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string | null;
  assignee?: { name: string } | null;
}

export default function MyDayPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, []);

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
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            <Card title="Tareas pendientes" meta={`${tasks.length} tareas`}>
              {tasks.length === 0 ? (
                <Empty message="Sin tareas pendientes" />
              ) : (
                <div className="stack">
                  {tasks.map((task) => (
                    <div className="flex-between" key={task.id}>
                      <div>
                        <div style={{ fontWeight: 500 }}>{task.title}</div>
                        <div className="flex wrap" style={{ marginTop: 4 }}>
                          <Pill style={TASK_STATUS_PILLS[task.status] || 'pill-gray'}>
                            {TASK_STATUS_LABELS[task.status] || task.status}
                          </Pill>
                          {task.dueAt && (
                            <span className="card-meta">{formatTime(task.dueAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </Shell>
  );
}
