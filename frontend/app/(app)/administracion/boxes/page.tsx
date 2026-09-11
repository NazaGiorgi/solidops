'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Shell } from '../../shell';
import { PageHeader, Card, Empty, Pill } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';

// Catálogo de "boxes" (grupos de tickets) editable desde el Panel de
// Administración. Un box es el valor que se escribe en tickets.legacy_group;
// los valores existentes se sembraron desde la migración. Crear/editar permite
// definir nombre, color, orden y desactivar. Al desactivar se exige elegir un
// box activo como "fallback": sus tickets se mueven ahí y las reglas de mailbox
// que apuntaban a él se reapuntan (transacción en el backend).
interface BoxRow {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  active: boolean;
  moduleKey?: string | null;
  parentId?: string | null;
  ticketCount?: number;
  aggregateCount?: number;
  childrenCount?: number;
  ruleCount?: number;
}

// Módulos que pueden asociarse a un box como destino (solo los que tienen un
// módulo que crea tickets atado al catálogo). 'workshop' = módulo Taller.
const MODULE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'workshop', label: 'Taller' },
];

const EMPTY_FORM = { name: '', color: '', sortOrder: '0', moduleKey: '' };

export default function AdminBoxesPage() {
  const [boxes, setBoxes] = useState<BoxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BoxRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deactivateTarget, setDeactivateTarget] = useState<BoxRow | null>(null);
  const [fallbackId, setFallbackId] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [moveFor, setMoveFor] = useState<string | null>(null);

  function load() {
    api
      .get<BoxRow[]>('/ticket-groups')
      .then(setBoxes)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }
  function openEdit(b: BoxRow) {
    setEditing(b);
    setForm({ name: b.name, color: b.color || '', sortOrder: String(b.sortOrder ?? 0), moduleKey: b.moduleKey || '' });
    setFormOpen(true);
  }

  async function save() {
    setError('');
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        color: form.color || null,
        sortOrder: parseInt(form.sortOrder || '0', 10) || 0,
        moduleKey: form.moduleKey || null,
      };
      if (editing) {
        await api.patch(`/ticket-groups/${editing.id}`, payload);
      } else {
        await api.post('/ticket-groups', payload);
      }
      setNotice('Box guardado');
      setTimeout(() => setNotice(''), 2500);
      setFormOpen(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openDeactivate(b: BoxRow) {
    setDeactivateTarget(b);
    setFallbackId('');
    setError('');
  }

  // Reactivar un box inactivo: no requiere fallback (no tiene tickets "atrapados",
  // ya se movieron al desactivar).
  async function reactivate(b: BoxRow) {
    setError('');
    try {
      await api.patch(`/ticket-groups/${b.id}`, { active: true });
      setNotice(`Box "${b.name}" reactivado`);
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function moveBox(target: BoxRow, parentId: string | null) {
    setMoveFor(null);
    setError('');
    try {
      await api.patch(`/ticket-groups/${target.id}/move`, { parentId });
      setNotice(`Box "${target.name}" movido`);
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    if (!fallbackId) {
      setError('Elegí un box de destino (fallback) para los tickets existentes.');
      return;
    }
    setDeactivating(true);
    setError('');
    try {
      const res = await api
        .delete<{ ok: boolean; movedTickets: number; reroutedRules: number }>(`/ticket-groups/${deactivateTarget.id}`, {
          fallbackGroupId: fallbackId,
        })
        .then((r: unknown) => r as { ok: boolean; movedTickets: number; reroutedRules: number });
      const fallback = boxes.find((b) => b.id === fallbackId);
      setNotice(
        `Box "${deactivateTarget.name}" desactivado: ${res.movedTickets} tickets movidos a "${fallback?.name || 'fallback'}"` +
        (res.reroutedRules ? `, ${res.reroutedRules} regla(s) reapuntada(s)` : ''),
      );
      setTimeout(() => setNotice(''), 3000);
      setDeactivateTarget(null);
      setFallbackId('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeactivating(false);
    }
  }

  // Árbol de contenedores (para ofrecer destinos válidos y evitar ciclos al mover).
  const byParent = new Map<string, BoxRow[]>();
  for (const b of boxes) {
    if (b.parentId && boxes.some((x) => x.id === b.parentId)) {
      const arr = byParent.get(b.parentId) ?? [];
      arr.push(b);
      byParent.set(b.parentId, arr);
    }
  }
  const descendants = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [...(byParent.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop() as BoxRow;
      out.add(c.id);
      const kids = byParent.get(c.id);
      if (kids) stack.push(...kids);
    }
    return out;
  };

  return (
    <Shell>
      <PageHeader
        title="Boxes de tickets"
        subtitle="Catálogo de bandejas/grupos del sidebar"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            + nuevo box
          </button>
        }
      />
      {notice && <div className="notice">{notice}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}

      {formOpen && (
        <Card title={editing ? 'Editar box' : 'Nuevo box'}>
          <div className="grid-3">
            <div className="field">
              <label>Nombre (único)</label>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="ej. Servidores" />
            </div>
            <div className="field">
              <label>Color (opcional)</label>
              <input className="input" type="color" value={form.color || '#888888'} onChange={(e) => set('color', e.target.value)} />
            </div>
            <div className="field">
              <label>Orden</label>
              <input className="input" type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} />
            </div>
            <div className="field">
              <label>Módulo (opcional)</label>
              <select className="select" value={form.moduleKey} onChange={(e) => set('moduleKey', e.target.value)}>
                <option value="">— sin módulo —</option>
                {MODULE_OPTIONS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <span className="card-meta" style={{ display: 'block' }}>
                Los tickets que crea este módulo caen en este box. Solo un box activo por módulo.
              </span>
            </div>
          </div>
          <div className="flex" style={{ gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'guardando…' : 'guardar'}
            </button>
            <button className="btn btn-ghost" onClick={() => setFormOpen(false)}>cancelar</button>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <Empty message="cargando…" />
        ) : boxes.length === 0 ? (
          <Empty message="Sin boxes todavía" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>box</th>
                <th>color</th>
                <th>orden</th>
                <th>en contenedor</th>
                <th>módulo</th>
                <th>tickets</th>
                <th>reglas</th>
                <th>estado</th>
                <th className="text-right">acciones</th>
              </tr>
            </thead>
            <tbody>
              {boxes.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.color && <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: b.color, marginRight: 6 }} />}
                    {b.name}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{b.color || '—'}</td>
                  <td>{b.sortOrder}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {boxes.find((p) => p.id === b.parentId)?.name || '— (nivel superior)'}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {b.moduleKey ? (MODULE_OPTIONS.find((m) => m.key === b.moduleKey)?.label || b.moduleKey) : '—'}
                  </td>
                  <td>{b.aggregateCount ?? b.ticketCount ?? 0}</td>
                  <td>{b.ruleCount ?? 0}</td>
                  <td><Pill style={b.active ? 'pill-green' : 'pill-gray'}>{b.active ? 'activo' : 'inactivo'}</Pill></td>
                  <td className="text-right">
                    <div className="flex wrap" style={{ justifyContent: 'flex-end' }}>
                      {moveFor === b.id ? (
                        <select
                          className="select"
                          style={{ fontSize: 12, padding: 2, maxWidth: 200 }}
                          autoFocus
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '') return;
                            void moveBox(b, v === '__root__' ? null : v);
                          }}
                          onBlur={() => setMoveFor(null)}
                        >
                          <option value="">mover a…</option>
                          {b.parentId !== null && <option value="__root__">Nivel superior (sin contenedor)</option>}
                          {boxes
                            .filter((d) => d.id !== b.id && !descendants(b.id).has(d.id))
                            .map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </select>
                      ) : (
                        <button className="btn btn-sm" onClick={() => setMoveFor(b.id)}>mover a…</button>
                      )}
                      <button className="btn btn-sm" onClick={() => openEdit(b)}>editar</button>
                      {b.active ? (
                        <button className="btn btn-sm btn-danger" onClick={() => openDeactivate(b)}>desactivar</button>
                      ) : (
                        <button className="btn btn-sm" onClick={() => reactivate(b)}>activar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {deactivateTarget && (
        <div className="modal-overlay" onClick={() => !deactivating && setDeactivateTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head flex-between">
              <h3 className="card-title" style={{ margin: 0 }}>Desactivar box «{deactivateTarget.name}»</h3>
              <button className="notice-close" onClick={() => !deactivating && setDeactivateTarget(null)} aria-label="Cerrar">×</button>
            </div>
            {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}
            <div className="modal-body">
              <p className="muted" style={{ fontSize: 13 }}>
                Al desactivar este box, se moverá su contenido a otro box activo que elijas como destino:
              </p>
              <div className="flex" style={{ gap: 10, marginBottom: 12 }}>
                <div className="pill pill-amber">
                  {deactivateTarget.ticketCount ?? 0} tickets
                </div>
                <div className="pill pill-blue">
                  {deactivateTarget.ruleCount ?? 0} regla(s) de mailbox
                </div>
              </div>
              <div className="field">
                <label>Box de destino (fallback)</label>
                <select
                  className="select"
                  value={fallbackId}
                  onChange={(e) => setFallbackId(e.target.value)}
                  disabled={deactivating}
                >
                  <option value="">elegir box activo…</option>
                  {boxes
                    .filter((b) => b.active && b.id !== deactivateTarget.id)
                    .map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
                <span className="card-meta" style={{ display: 'block' }}>
                  Los {deactivateTarget.ticketCount ?? 0} tickets y las {deactivateTarget.ruleCount ?? 0} regla(s) pasarán a este box.
                </span>
              </div>
            </div>
            <div className="modal-foot flex flex-between">
              <button className="btn btn-ghost" onClick={() => !deactivating && setDeactivateTarget(null)}>cancelar</button>
              <button className="btn btn-danger" onClick={confirmDeactivate} disabled={!fallbackId || deactivating}>
                {deactivating ? 'desactivando…' : 'desactivar box'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
