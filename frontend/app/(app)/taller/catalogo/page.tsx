'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell } from '../../shell';
import { PageHeader, Card, Empty } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';
import { useAuth } from '../../../../lib/auth';
import { workshopApi, PriceListItem, money } from '../../../../lib/workshop';

interface FormState {
  name: string;
  isLabor: boolean;
  active: boolean;
  price: string;
  description: string;
}

const emptyForm: FormState = { name: '', isLabor: false, active: true, price: '', description: '' };

export default function TallerCatalogPage() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('workshop:catalog');

  const [items, setItems] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  function load() {
    workshopApi
      .catalog()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  function startNew() {
    setForm(emptyForm);
    setEditingId(null);
  }
  function startEdit(it: PriceListItem) {
    setForm({
      name: it.name,
      isLabor: it.isLabor,
      active: it.active,
      price: String(it.price),
      description: it.description || '',
    });
    setEditingId(it.id);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        isLabor: form.isLabor,
        active: form.active,
        price: form.price.trim() || '0',
        description: form.description.trim() || null,
      };
      if (editingId) await workshopApi.updateCatalogItem(editingId, body);
      else await workshopApi.createCatalogItem(body);
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Shell>
      <PageHeader title="Catalogo de precios" subtitle={`${items.length} ítems (${items.filter((i) => i.active).length} activos)`} />

      <div className="mb-16 flex">
        <Link href="/taller" className="link muted" style={{ fontSize: 13 }}>← Volver al Taller</Link>
      </div>

      {error && <div style={{ marginBottom: 12 }}><ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} /></div>}

      {canEdit && (
        <Card title={editingId ? 'Editar ítem' : 'Nuevo ítem'}>
          <form onSubmit={submit}>
            <div className="grid-auto">
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label className="field-label">Nombre</label>
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ej. Reparación de fuente de alimentación" required />
              </div>
              <div className="field">
                <label className="field-label">Precio (ARS)</label>
                <input className="input" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="0.00" />
              </div>
              <div className="field">
                <label className="field-label">Descripción (opcional)</label>
                <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <div className="flex wrap mb-16" style={{ gap: 16 }}>
              <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.isLabor} onChange={(e) => setForm({ ...form, isLabor: e.target.checked })} />
                Es mano de obra
              </label>
              <label className="flex" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Activo
              </label>
            </div>
            <div className="flex">
              <button className="btn btn-primary btn-sm">{editingId ? 'guardar cambios' : 'agregar ítem'}</button>
              {editingId && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={startNew}>
                  cancelar
                </button>
              )}
            </div>
          </form>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="empty">cargando…</div>
        ) : items.length === 0 ? (
          <Empty message="Sin ítems en el catálogo" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Precio</th>
                <th>Estado</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    {it.name}
                    {it.description && <div className="muted" style={{ fontSize: 12 }}>{it.description}</div>}
                  </td>
                  <td>{it.isLabor ? 'Mano de obra' : 'Recambio / servicio'}</td>
                  <td>{money(it.price)}</td>
                  <td>
                    <span className={`pill ${it.active ? 'pill-green' : 'pill-gray'}`}>
                      {it.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {canEdit && (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm" onClick={() => startEdit(it)}>editar</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Shell>
  );
}