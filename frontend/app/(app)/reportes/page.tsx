'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader } from '../../../components/ui';
import { PieChartCard, toData, STATUS_COLORS, PRIORITY_COLORS, SLA_COLORS } from '../../../components/pie-chart';

interface ReportData {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byTechnician: Record<string, number>;
  byTechnicianAsCollaborator: Record<string, number>;
  slaStatus: Record<string, number>;
}

type Range = 'week' | 'month' | 'all' | 'custom';

function rangeBounds(range: Range): { from?: string; to?: string } {
  const now = new Date();
  if (range === 'week') {
    const from = new Date(now);
    from.setDate(now.getDate() - 7);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (range === 'month') {
    const from = new Date(now);
    from.setMonth(now.getMonth() - 1);
    return { from: from.toISOString(), to: now.toISOString() };
  }
  if (range === 'custom') return { from: '', to: '' }; // filled by date inputs
  return {};
}

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async (r: Range, fromCustom?: string, toCustom?: string) => {
    setLoading(true);
    const bounds = r === 'custom' ? { from: fromCustom, to: toCustom } : rangeBounds(r);
    const params = new URLSearchParams();
    if (bounds.from) params.set('from', bounds.from);
    if (bounds.to) params.set('to', bounds.to);
    try {
      const qs = params.toString();
      const res = await api.get<ReportData>(`/reports/summary${qs ? `?${qs}` : ''}`);
      setData(res);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load('all');
  }, [load]);

  // Un mismo técnico puede figurar en las dos columnas: como responsable y
  // como colaborador. Se muestran ambas sin sumarlas (son cargas distintas).
  const technicianNames = data
    ? Array.from(
        new Set([
          ...Object.keys(data.byTechnician || {}),
          ...Object.keys(data.byTechnicianAsCollaborator || {}),
        ]),
      ).sort((a, b) => a.localeCompare(b))
    : [];

  return (
    <Shell>
      <PageHeader title="Reportes" subtitle="Distribución de tickets y cumplimiento de SLA" />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <label className="field-label">Período:</label>
        {(
          [
            ['all', 'Todo'],
            ['week', 'Última semana'],
            ['month', 'Último mes'],
            ['custom', 'Rango'],
          ] as [Range, string][]
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => {
              setRange(val);
              if (val !== 'custom') {
                setFrom('');
                setTo('');
                load(val);
              }
            }}
            className={`chip ${range === val ? 'chip-active' : ''}`}
          >
            {label}
          </button>
        ))}
        {range === 'custom' && (
          <>
            <input
              type="date"
              className="input"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span>a</span>
            <input
              type="date"
              className="input"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <button
              type="button"
              className="btn"
              onClick={() => {
                const fromD = from ? new Date(from).toISOString() : undefined;
                const toD = to ? new Date(to).toISOString() : undefined;
                load('custom', fromD, toD);
              }}
            >
              Aplicar
            </button>
          </>
        )}
      </div>
      {loading ? (
        <div className="empty">cargando…</div>
      ) : !data ? (
        <div className="empty">No se pudieron cargar los reportes</div>
      ) : (
        <>
          <div className="grid-3">
            <PieChartCard
              title="Tickets por estado"
              data={toData(data.byStatus, STATUS_COLORS)}
            />
            <PieChartCard
              title="Tickets por prioridad"
              data={toData(data.byPriority, PRIORITY_COLORS)}
            />
            <PieChartCard
              title="En cumplimiento SLA"
              data={toData(data.slaStatus, SLA_COLORS)}
            />
          </div>
          <div className="grid-3 mt-16">
            <PieChartCard
              title="Carga por técnico (responsable)"
              data={Object.entries(data.byTechnician || {})
                .filter(([, v]) => v > 0)
                .map(([name, value]) => ({ name, value, color: '#2563eb' }))}
            />
            <PieChartCard
              title="Carga como colaborador"
              data={Object.entries(data.byTechnicianAsCollaborator || {})
                .filter(([, v]) => v > 0)
                .map(([name, value]) => ({ name, value, color: 'var(--blue)' }))}
            />
          </div>
          <div className="card mt-16">
            <h3 className="card-title">Carga por técnico</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Técnico</th>
                  <th>Responsable</th>
                  <th>Como colaborador</th>
                </tr>
              </thead>
              <tbody>
                {technicianNames.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="muted">Sin datos</td>
                  </tr>
                ) : (
                  technicianNames.map((name) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{data?.byTechnician?.[name] ?? 0}</td>
                      <td>{data?.byTechnicianAsCollaborator?.[name] ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}
