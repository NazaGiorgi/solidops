'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { formatDate } from '../../../lib/helpers';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  createdAt: string;
  user?: { name?: string; email?: string } | null;
  userEmail?: string | null;
  meta?: Record<string, unknown> | null;
}

const ACTION_LABELS: Record<string, string> = {
  create: 'crear',
  update: 'editar',
  delete: 'eliminar',
  status_change: 'cambio de estado',
  priority_change: 'cambio de prioridad',
  assignment_change: 'cambio de asignación',
  login: 'login',
  logout: 'logout',
};

const ACTION_PILLS: Record<string, string> = {
  create: 'pill-green',
  update: 'pill-blue',
  delete: 'pill-red',
  status_change: 'pill-amber',
  priority_change: 'pill-amber',
  assignment_change: 'pill-blue',
  login: 'pill-gray',
  logout: 'pill-gray',
};

const ENTITY_LABELS: Record<string, string> = {
  user: 'usuario',
  role: 'rol',
  technician: 'técnico',
  customer: 'cliente',
  contact: 'contacto',
  site: 'sitio',
  contract: 'contrato',
  ticket: 'ticket',
  ticket_message: 'mensaje de ticket',
  appointment: 'turno',
  task: 'tarea',
  notification: 'notificación',
};

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  function load() {
    const path = `/audit?limit=200${entityFilter ? '&entityType=' + entityFilter : ''}`;
    api
      .get<AuditRow[]>(path)
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityFilter]);

  return (
    <Shell>
      <PageHeader title="Auditoría" subtitle="Registro de acciones y cambios sobre la plataforma" />
      <Card>
        <div className="flex wrap mb-16">
          <select
            className="select"
            style={{ maxWidth: 220 }}
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
          >
            <option value="">todas las entidades</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ maxWidth: 200 }}
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          >
            <option value="">toda acción</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="empty">cargando…</div>
        ) : rows.length === 0 ? (
          <Empty message="Sin registros de auditoría" />
        ) : (
          <div className="stack">
            {rows
              .filter((r) => !actionFilter || r.action === actionFilter)
              .map((r) => {
                const changedKeys = (r.meta?.changedFields as string[]) || [];
                return (
                  <div className="msg" key={r.id}>
                    <div className="flex wrap" style={{ marginBottom: 4 }}>
                      <Pill style={ACTION_PILLS[r.action] || 'pill-gray'}>
                        {ACTION_LABELS[r.action] || r.action}
                      </Pill>
                      <span style={{ fontWeight: 600 }}>
                        {ENTITY_LABELS[r.entityType] || r.entityType}
                      </span>
                      <span className="card-meta">{r.entityId.slice(0, 8)}…</span>
                      <span className="card-meta">· {formatDate(r.createdAt)}</span>
                    </div>
                    <div className="card-meta">
                      {r.user?.name || r.userEmail || 'sistema'}
                    </div>
                    {changedKeys.length > 0 && (
                      <div style={{ marginTop: 6 }} className="card-meta">
                        campos: {changedKeys.join(', ')}
                      </div>
                    )}
                    {(r.oldValue || r.newValue) && (
                      <div className="flex wrap" style={{ marginTop: 6, gap: 16 }}>
                        <div>
                          <div className="card-meta">anterior</div>
                          <div className="stack">
                            {Object.entries(r.oldValue || {}).map(([k, v]) => (
                              <div key={k}>
                                <span className="card-meta">{k}: </span>
                                {renderValue(v)}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="card-meta">nuevo</div>
                          <div className="stack">
                            {Object.entries(r.newValue || {}).map(([k, v]) => (
                              <div key={k}>
                                <span className="card-meta">{k}: </span>
                                {renderValue(v)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            {!loading && rows.filter((r) => !actionFilter || r.action === actionFilter).length === 0 && (
              <Empty message="Sin registros para ese filtro" />
            )}
          </div>
        )}
      </Card>
    </Shell>
  );
}
