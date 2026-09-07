'use client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export interface PieDatum {
  name: string;
  value: number;
  color: string;
}

// Custom tooltip: shows the exact count of each slice, not just a legend/half.
function ChartTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: PieDatum }>;
  total: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const value = p.value ?? p.payload?.value ?? 0;
  const name = p.name ?? p.payload?.name ?? '';
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 13,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ fontWeight: 600 }}>{name}</div>
      <div style={{ color: '#475569' }}>
        <b>{value}</b> tickets ({pct}%)
      </div>
    </div>
  );
}

// Reusable donut/pie. Uses the semantic colors already defined in the platform.
export function PieChartCard({ data, title }: { data: PieDatum[]; title: string }) {
  const total = data.reduce((acc, d) => acc + d.value, 0);
  return (
    <div className="card">
      <h3 className="card-title">{title}</h3>
      {total === 0 ? (
        <div className="empty">sin datos</div>
      ) : (
        <>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip total={total} />} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="card-subtitle" style={{ textAlign: 'center', marginTop: -8 }}>
            Total: {total} tickets
          </div>
        </>
      )}
    </div>
  );
}

// Preset palettes using the platform's semantic colors.
export const STATUS_COLORS: Record<string, string> = {
  nuevo: '#2563eb',
  abierto: '#3b82f6',
  asignado: '#64748b',
  en_progreso: '#f59e0b',
  esperando_cliente: '#848b98',
  resuelto: '#16a34a',
  cerrado: '#94a3b8',
};
export const PRIORITY_COLORS: Record<string, string> = {
  baja: '#94a3b8',
  normal: '#2563eb',
  alta: '#f59e0b',
  critica: '#dc2626',
};
export const SLA_COLORS: Record<string, string> = {
  verde: '#16a34a',
  amarillo: '#f59e0b',
  rojo: '#dc2626',
};

export function toData(record: Record<string, number> | undefined, colors: Record<string, string>): PieDatum[] {
  if (!record) return [];
  return Object.entries(record)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v, color: colors[k] || '#94a3b8' }));
}
