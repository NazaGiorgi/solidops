'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import {
  STATUS_PILLS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  TECH_STATUS_PILLS,
  LEVEL_LABELS,
} from '../../../lib/helpers';

interface GeneralData {
  summary: { open: number; critical: number; slaAtRisk: number; slaCritical: number };
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  team: Array<{
    technicianId: string;
    name: string;
    status: string;
    level: string;
    specialties: string[];
    load: number;
  }>;
  agenda: {
    todayAppointments: number;
    upcomingToday: number;
    overdueTasks: number;
    dueTodayTasks: number;
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<GeneralData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<GeneralData>('/dashboard/general')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Shell><div className="empty">cargando…</div></Shell>;
  if (!data) return <Shell><Empty message="No se pudo cargar el dashboard" /></Shell>;

  return (
    <Shell>
      <PageHeader title="Dashboard" subtitle="Estado de la operación" />
      <div className="grid-4">
        <div className="card stat">
          <div className="num">{data.summary.open}</div>
          <div className="label">tickets abiertos</div>
        </div>
        <div className="card stat">
          <div className="num" style={{ color: 'var(--red)' }}>{data.summary.critical}</div>
          <div className="label">críticos</div>
        </div>
        <div className="card stat">
          <div className="num" style={{ color: 'var(--amber)' }}>{data.summary.slaAtRisk}</div>
          <div className="label">SLA en riesgo</div>
        </div>
        <div className="card stat">
          <div className="num" style={{ color: 'var(--red)' }}>{data.summary.slaCritical}</div>
          <div className="label">SLA vencido</div>
        </div>
      </div>

      {/* Agenda summary */}
      <div className="grid-4 mt-16">
        <div className="card stat">
          <div className="num">{data.agenda.todayAppointments}</div>
          <div className="label">turnos hoy</div>
        </div>
        <div className="card stat">
          <div className="num" style={{ color: 'var(--blue)' }}>{data.agenda.upcomingToday}</div>
          <div className="label">próximos hoy</div>
        </div>
        <div className="card stat">
          <div className="num" style={{ color: 'var(--red)' }}>{data.agenda.overdueTasks}</div>
          <div className="label">tareas atrasadas</div>
        </div>
        <div className="card stat">
          <div className="num" style={{ color: 'var(--amber)' }}>{data.agenda.dueTodayTasks}</div>
          <div className="label">tareas para hoy</div>
        </div>
      </div>

      <div className="grid-3 mt-16">
        <Card title="Por estado">
          {Object.entries(data.byStatus).length === 0 ? (
            <Empty message="Sin tickets activos" />
          ) : (
            <div className="stack">
              {Object.entries(data.byStatus).map(([k, v]) => (
                <div className="flex-between" key={k}>
                  <Pill style={STATUS_PILLS[k] || 'pill-gray'}>{STATUS_LABELS[k] || k}</Pill>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Por prioridad">
          {Object.entries(data.byPriority).length === 0 ? (
            <Empty message="Sin datos" />
          ) : (
            <div className="stack">
              {Object.entries(data.byPriority).map(([k, v]) => (
                <div className="flex-between" key={k}>
                  <span>{PRIORITY_LABELS[k] || k}</span>
                  <span style={{ fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Estado del equipo">
          <table className="table">
            <thead>
              <tr>
                <th>técnico</th>
                <th>estado</th>
                <th className="text-right">carga</th>
              </tr>
            </thead>
            <tbody>
              {data.team.map((t) => (
                <tr key={t.technicianId}>
                  <td>
                    <div>{t.name}</div>
                    <div className="card-meta">{LEVEL_LABELS[t.level] || t.level}</div>
                  </td>
                  <td>
                    <Pill style={TECH_STATUS_PILLS[t.status] || 'pill-gray'}>{t.status}</Pill>
                  </td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{t.load}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <div className="muted mt-16">
        Leyenda SLA: <Pill style="pill-green">verde · a tiempo</Pill>{' '}
        <Pill style="pill-amber">amarillo · en riesgo</Pill>{' '}
        <Pill style="pill-red">rojo · vencido</Pill>
      </div>
    </Shell>
  );
}
