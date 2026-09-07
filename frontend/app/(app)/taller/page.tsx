'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Shell } from '../shell';
import { PageHeader, Card, Empty } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import {
  workshopApi,
  WorkshopEquipment,
  EquipmentStatus,
  STATUS_LABELS,
  STATUS_PILLS,
  EQUIPMENT_STATUSES,
} from '../../../lib/workshop';
import { NewEquipmentForm } from '../../../components/workshop/new-equipment-form';

function normalize(s: string): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default function TallerPage() {
  const { hasPerm } = useAuth();
  const [rows, setRows] = useState<WorkshopEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'' | EquipmentStatus>('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  function load() {
    workshopApi
      .list()
      .then(setRows)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter) list = list.filter((r) => r.status === statusFilter);
    if (query.trim()) {
      const q = normalize(query);
      list = list.filter((r) =>
        normalize(
          [r.brand, r.model, r.serialNumber, r.reportedFault, r.customerLabel, r.customerName].filter(Boolean).join(' '),
        ).includes(q),
      );
    }
    return list;
  }, [rows, statusFilter, query]);

  const countBy = (s: EquipmentStatus) => rows.filter((r) => r.status === s).length;

  return (
    <Shell>
      <PageHeader
        title="Taller"
        subtitle={`${filtered.length} de ${rows.length} equipos`}
        action={
          <div className="flex" style={{ gap: 8 }}>
            {hasPerm('workshop:catalog') && (
              <Link href="/taller/catalogo" className="btn">
                Catalogo de precios
              </Link>
            )}
            {hasPerm('workshop:write') ? (
              <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
                {creating ? 'cancelar' : '+ recibir equipo'}
              </button>
            ) : undefined}
          </div>
        }
      />

      {creating && hasPerm('workshop:write') && (
        <Card>
          <NewEquipmentForm onDone={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />
        </Card>
      )}

      <Card>
        <div className="flex mb-16 wrap">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="buscar por marca, modelo, serie, falla o cliente…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex wrap" style={{ gap: 6 }}>
            <button
              className={`chip ${statusFilter === '' ? 'chip-active' : ''}`}
              onClick={() => setStatusFilter('')}
            >
              Todos ({rows.length})
            </button>
            {EQUIPMENT_STATUSES.map((s) => (
              <button
                key={s}
                className={`chip ${statusFilter === s ? 'chip-active' : ''}`}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              >
                {STATUS_LABELS[s]} ({countBy(s)})
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty">cargando…</div>
        ) : rows.length === 0 ? (
          <Empty message="Sin equipos en el taller todavía" />
        ) : filtered.length === 0 ? (
          <Empty message={`Sin resultados para "${query}"${statusFilter ? ' con ese estado' : ''}`} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Orden</th>
                <th>Equipo</th>
                <th>Serie</th>
                <th>Estado</th>
                <th>Recibido</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/taller/${r.id}`} className="link">
                      {r.customerName || r.customerLabel || r.customer?.name || '—'}
                    </Link>
                  </td>
                  <td className="muted">{r.ticketNumber || '—'}</td>
                  <td>
                    {[r.brand, r.model].filter(Boolean).join(' ') || '—'}
                    {r.equipmentTypeLabel ? <span className="muted"> · {r.equipmentTypeLabel.toLowerCase()}</span> : null}
                  </td>
                  <td className="muted">{r.serialNumber || '—'}</td>
                  <td>
                    <span className={`pill ${STATUS_PILLS[r.status]}`}>{r.statusLabel}</span>
                  </td>
                  <td className="muted">{r.receivedAt ? new Date(r.receivedAt).toLocaleDateString('es-AR') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}