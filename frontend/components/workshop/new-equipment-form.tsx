'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import {
  EQUIPMENT_TYPES,
  initials,
  customerSubtitle,
  PARTICULARS_BUCKET,
  workshopApi,
} from '../../lib/workshop';
import { ErrorNotice } from '../error-notice';

interface ContactOpt {
  id: string;
  name: string;
  email?: string | null;
}
interface CustomerOpt {
  id: string;
  name: string;
  contacts: ContactOpt[];
}

interface NewCustomerForm {
  kind: 'empresa' | 'particular';
  name: string;
  email: string;
  phone: string;
}

export function NewEquipmentForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { hasPerm } = useAuth();
  const canCreateCustomer = hasPerm('customers:create');

  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [customerQuery, setCustomerQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOpt | null>(null);
  const [contactId, setContactId] = useState<string>('');
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>({
    kind: 'particular',
    name: '',
    email: '',
    phone: '',
  });

  const [from, setFrom] = useState({
    equipmentType: 'otro',
    otherType: '',
    brand: '',
    model: '',
    serialNumber: '',
    accessories: '',
    physicalCondition: '',
    reportedFault: '',
    title: '',
  });
  const [busy, setBusy] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<CustomerOpt[]>('/customers')
      .then(setCustomers)
      .catch(() => {});
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = (customerQuery || '').toLowerCase().trim();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, customerQuery]);

  function isParticular(c: CustomerOpt): boolean {
    return customerSubtitle(c.name, c.contacts.map((ct) => ct.email)) === 'Cliente particular';
  }

  function clearNewCustomer() {
    setShowNewCustomer(false);
    setNewCustomer({ kind: 'particular', name: '', email: '', phone: '' });
    setError('');
  }

  async function createCustomer() {
    const name = newCustomer.name.trim();
    if (!name) {
      setError('Ingresá el nombre del cliente.');
      return;
    }
    setCreatingCustomer(true);
    setError('');
    try {
      const email = newCustomer.email.trim();
      const phone = newCustomer.phone.trim();
      let nameToUse = name;
      // Los particulares se guardan bajo el bucket genérico del sistema para
      // poder re-encontrarlos; la empresa se registra con su nombre real.
      if (newCustomer.kind === 'particular' && name !== PARTICULARS_BUCKET) {
        nameToUse = PARTICULARS_BUCKET;
      }
      const created = await api.post<{ id: string; name: string }>('/customers', { name: nameToUse });
      let contact: { id: string; name: string; email?: string } | null = null;
      if (email || phone) {
        contact = await api.post<{ id: string; name: string; email?: string }>(`/customers/${created.id}/contacts`, {
          name: newCustomer.kind === 'particular' ? name : nameToUse,
          email: email || undefined,
          phone: phone || undefined,
        });
      }
      const fresh: CustomerOpt = {
        id: created.id,
        name: created.name,
        contacts: contact ? [{ id: contact.id, name: contact.name, email: contact.email }] : [],
      };
      setCustomers((prev) => [fresh, ...prev]);
      if (contact) setContactId(contact.id);
      setSelectedCustomer(fresh);
      clearNewCustomer();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreatingCustomer(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCustomer) {
      setError('Elegí el cliente.');
      return;
    }
    if (!from.reportedFault.trim()) {
      setError('El fallo reportado es obligatorio.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await workshopApi.create({
        customerId: selectedCustomer.id,
        customerLabel: selectedCustomer.name,
        contactId: contactId || null,
        equipmentType: from.equipmentType,
        otherType: from.equipmentType === 'otro' ? from.otherType || null : null,
        brand: from.brand || null,
        model: from.model || null,
        serialNumber: from.serialNumber || null,
        accessories: from.accessories || null,
        physicalCondition: from.physicalCondition || null,
        reportedFault: from.reportedFault,
        title: from.title || null,
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function set<K extends keyof typeof from>(k: K, v: string) {
    setFrom((f) => ({ ...f, [k]: v }));
  }

  return (
    <form onSubmit={submit}>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}

      {/* 1 · Cliente */}
      <div className="form-section-title">Cliente</div>
      {!selectedCustomer && !showNewCustomer && (
        <div className="field">
          <input
            className="input"
            placeholder="Buscar cliente por nombre…"
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            autoFocus
          />
          <div
            style={{
              marginTop: 6,
              maxHeight: 200,
              overflow: 'auto',
              border: '1px solid var(--gray-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
            }}
          >
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                type="button"
                className="customer-option"
                onClick={() => setSelectedCustomer(c)}
              >
                <span className={`avatar ${isParticular(c) ? 'avatar-particular' : ''}`}>
                  {initials(c.name)}
                </span>
                <span>
                  <span className="customer-option-name">{c.name}</span>
                  <span style={{ display: 'block' }} className="customer-option-sub">
                    {customerSubtitle(c.name, c.contacts.map((ct) => ct.email))}
                  </span>
                </span>
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <div style={{ padding: '12px', fontSize: 13, color: 'var(--text-muted)' }}>
                No hay resultados para “{customerQuery}”.
              </div>
            )}
          </div>

          {canCreateCustomer && (
            <button type="button" className="dashed-btn" style={{ marginTop: 8 }} onClick={() => setShowNewCustomer(true)}>
              + Crear cliente nuevo
            </button>
          )}
        </div>
      )}

      {showNewCustomer && (
        <div className="card" style={{ marginTop: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Cliente nuevo</div>
          <div className="form-grid-2">
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">¿Es empresa o particular?</label>
              <div className="flex" style={{ gap: 8 }}>
                {(['empresa', 'particular'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`btn btn-sm ${newCustomer.kind === k ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setNewCustomer((nc) => ({ ...nc, kind: k }))}
                  >
                    {k === 'empresa' ? 'Empresa' : 'Particular'}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Nombre {newCustomer.kind === 'particular' ? '(de la persona)' : '(de la empresa)'}</label>
              <input
                className="input"
                placeholder={newCustomer.kind === 'particular' ? 'Ej: Juan Pérez' : 'Ej: SolidoCS SRL'}
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((nc) => ({ ...nc, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Email (opcional)</label>
              <input
                className="input"
                type="email"
                placeholder="contacto@correo.com"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer((nc) => ({ ...nc, email: e.target.value }))}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="field-label">Teléfono (opcional)</label>
              <input
                className="input"
                placeholder="011-5555-0000"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer((nc) => ({ ...nc, phone: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={clearNewCustomer} disabled={creatingCustomer}>
              cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={createCustomer} disabled={creatingCustomer}>
              {creatingCustomer ? 'creando…' : 'crear cliente'}
            </button>
          </div>
        </div>
      )}

      {selectedCustomer && (
        <div className="card" style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`avatar ${isParticular(selectedCustomer) ? 'avatar-particular' : ''}`}>
              {initials(selectedCustomer.name)}
            </span>
            <span style={{ flex: 1 }}>
              <div className="customer-option-name">{selectedCustomer.name}</div>
              <div className="customer-option-sub">
                {customerSubtitle(selectedCustomer.name, selectedCustomer.contacts.map((ct) => ct.email))}
              </div>
            </span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedCustomer(null)}>
              cambiar
            </button>
          </div>
        </div>
      )}

      {selectedCustomer && selectedCustomer.contacts.length > 0 && (
        <div className="field" style={{ marginTop: 12 }}>
          <label className="field-label">Contacto de referencia (opcional)</label>
          <select className="select" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">— sin contacto —</option>
            {selectedCustomer.contacts.map((ct) => (
              <option key={ct.id} value={ct.id}>
                {ct.name}
                {ct.email ? ` · ${ct.email}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 2 · Equipo */}
      <div className="form-section-title">Equipo</div>
      <div className="form-grid-2">
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Tipo de equipo</label>
          <select className="select" value={from.equipmentType} onChange={(e) => set('equipmentType', e.target.value)}>
            {EQUIPMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {from.equipmentType === 'otro' && (
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Otro (detallá)</label>
            <input className="input" value={from.otherType} onChange={(e) => set('otherType', e.target.value)} />
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Marca</label>
          <input className="input" value={from.brand} onChange={(e) => set('brand', e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Modelo</label>
          <input className="input" value={from.model} onChange={(e) => set('model', e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Número de serie</label>
          <input className="input" value={from.serialNumber} onChange={(e) => set('serialNumber', e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="field-label">Accesorios recibidos (opcional)</label>
          <input className="input" value={from.accessories} onChange={(e) => set('accessories', e.target.value)} />
        </div>
      </div>

      {/* 3 · Estado del ingreso */}
      <div className="form-section-title">Estado del ingreso</div>
      <div className="field" style={{ margin: 0 }}>
        <label className="field-label">Condición física / observaciones</label>
        <textarea className="textarea" value={from.physicalCondition} onChange={(e) => set('physicalCondition', e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">Fallo reportado (obligatorio)</label>
        <textarea className="textarea" value={from.reportedFault} onChange={(e) => set('reportedFault', e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label">Título del ticket (opcional)</label>
        <input className="input" value={from.title} onChange={(e) => set('title', e.target.value)} />
      </div>

      <div className="flex" style={{ justifyContent: 'flex-end', marginTop: 8, gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'guardando…' : 'Registrar equipo'}
        </button>
      </div>
    </form>
  );
}