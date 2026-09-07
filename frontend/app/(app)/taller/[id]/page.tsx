'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Shell } from '../../shell';
import { Card, Empty } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';
import { useAuth } from '../../../../lib/auth';
import {
  workshopApi,
  openAuthorized,
  WorkshopEquipment,
  WorkshopQuote,
  QuoteItem,
  PriceListItem,
  EquipmentStatus,
  STATUS_LABELS,
  STATUS_PILLS,
  EQUIPMENT_STATUSES,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_PILLS,
  money,
  fmtDateTime,
} from '../../../../lib/workshop';

const STATUS_ORDER: readonly EquipmentStatus[] = EQUIPMENT_STATUSES;

export default function TallerDetailPage() {
  const { hasPerm } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [eq, setEq] = useState<WorkshopEquipment | null>(null);
  const [quotes, setQuotes] = useState<WorkshopQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ brand: '', model: '', serialNumber: '', diagnosis: '' });
  const [customerContacts, setCustomerContacts] = useState<{ id: string; name: string; email?: string | null }[]>([]);
  const [contactForm, setContactForm] = useState<{ contactId: string; name: string; email: string; phone: string } | null>(null);

  const [quoteOpen, setQuoteOpen] = useState(false);
  const [catalog, setCatalog] = useState<PriceListItem[]>([]);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');

  const canWrite = hasPerm('workshop:write');
  const canQuotes = hasPerm('workshop:quotes');

  function load() {
    if (!id) return;
    setLoading(true);
    Promise.all([workshopApi.findOne(id), workshopApi.quotes(id)])
      .then(([e, q]) => {
        setEq(e);
        setQuotes(q);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <Shell><Empty message="cargando…" /></Shell>;
  if (!eq) return <Shell><Empty message="Equipo no encontrado" /></Shell>;

  const activeQuote = eq.quote;
  const activeItems = eq.quoteItems || [];
  const latest = activeQuote || quotes[0] || null;

  const curIdx = STATUS_ORDER.indexOf(eq.status);
  // Se permiten avanzar y retroceder estados (excepto el actual). "En reparación"
  // sigue requiriendo un presupuesto aprobado (validado en el backend).
  const nextable = STATUS_ORDER.filter((s) => s !== eq.status);

  async function setStatus(s: EquipmentStatus) {
    if (!eq) return;
    setError('');
    setNotice('');
    try {
      await workshopApi.setStatus(eq.id, s);
      load();
      setNotice(`Estado actualizado a "${STATUS_LABELS[s]}"`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startEdit() {
    if (!eq) return;
    setForm({
      brand: eq.brand || '',
      model: eq.model || '',
      serialNumber: eq.serialNumber || '',
      diagnosis: eq.diagnosis || '',
    });
    setContactForm({
      contactId: eq.contactId || '',
      name: eq.contact?.name || '',
      email: eq.contact?.email || '',
      phone: eq.contact?.phone || '',
    });
    // Contactos del cliente (para poder cambiar el contacto del equipo).
    workshopApi.customers().then((all) => {
      const target = all.find((c) => c.id === eq.customerId);
      setCustomerContacts((target?.contacts || []).map((ct) => ({ id: ct.id, name: ct.name, email: ct.email })));
    }).catch(() => setCustomerContacts([]));
    setEditing(true);
  }
  async function saveEdit() {
    if (!eq) return;
    setError('');
    const body: Record<string, unknown> = {
      brand: form.brand || null,
      model: form.model || null,
      serialNumber: form.serialNumber || null,
      diagnosis: form.diagnosis || null,
    };
    // Cambio de contacto: si el usuario eligió otro contacto del mismo cliente.
    if (contactForm && contactForm.contactId && contactForm.contactId !== eq.contactId) {
      body.contactId = contactForm.contactId;
    } else if (contactForm && contactForm.contactId === '') {
      // No aplica: el selector siempre apunta a un contacto válido.
    }
    // Corrección de datos del contacto (nombre/email/teléfono), solo si cambió algo.
    if (contactForm && eq.contactId) {
      const changed =
        contactForm.name !== (eq.contact?.name || '') ||
        contactForm.email !== (eq.contact?.email || '') ||
        contactForm.phone !== (eq.contact?.phone || '');
      if (changed) {
        body.contactPatch = {
          name: contactForm.name || null,
          email: contactForm.email || null,
          phone: contactForm.phone || null,
        };
      }
    }
    try {
      await workshopApi.update(eq.id, body);
      setEditing(false);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function toggleCatalogItem(itemId: string) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[itemId] != null) delete next[itemId];
      else next[itemId] = 1;
      return next;
    });
  }
  function qty(itemId: string, delta: number) {
    setSelected((prev) => {
      const cur = prev[itemId] || 1;
      const next = Math.max(1, cur + delta);
      return { ...prev, [itemId]: next };
    });
  }
  async function submitQuote() {
    if (!eq) return;
    const lines = Object.entries(selected)
      .map(([id, quantity]) => {
        const item = catalog.find((c) => c.id === id);
        if (!item) return null;
        return {
          priceListItemId: item.id,
          name: item.name,
          isLabor: item.isLabor,
          quantity,
          unitPrice: String(Math.round(item.price * 100) / 100),
        };
      })
      .filter(Boolean) as NonNullable<unknown>[];
    if (lines.length === 0) {
      setError('Elegí al menos un ítem del catálogo.');
      return;
    }
    setError('');
    try {
      await workshopApi.createQuote(eq.id, { lines, notes: notes || null });
      setQuoteOpen(false);
      setSelected({});
      setNotes('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function send() {
    if (!eq || !activeQuote) return;
    setError('');
    try {
      await workshopApi.sendQuote(eq.id, activeQuote.id);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function respond(decision: 'aprobado' | 'rechazado') {
    if (!eq || !activeQuote) return;
    setError('');
    try {
      await workshopApi.respondQuote(eq.id, activeQuote.id, decision);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const quoteSent = !!activeQuote?.sentAt;

  return (
    <Shell>
      <div className="flex-between wrap mb-16">
        <div>
          <Link href="/taller" className="link muted" style={{ fontSize: 13 }}>
            ← Taller
          </Link>
          <h1 className="page-title">
            {[eq.brand, eq.model].filter(Boolean).join(' ') || eq.equipmentTypeLabel}
          </h1>
          <p className="page-subtitle">
            {eq.customerLabel || eq.customer?.name} · serie {eq.serialNumber || '—'} · recibo E-
            {eq.id.slice(0, 8).toUpperCase()} · recibido {fmtDateTime(eq.receivedAt)}
          </p>
        </div>
        <div className="flex" style={{ gap: 6 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => openAuthorized(workshopApi.receptionPdfUrl(eq.id))}>
            Comprobante PDF
          </button>
          {latest && (
            <button className="btn btn-sm btn-ghost" onClick={() => openAuthorized(workshopApi.quotePdfUrl(eq.id, latest.id))}>
              Presupuesto PDF
            </button>
          )}
          {canWrite && !editing && <button className="btn btn-sm" onClick={startEdit}>editar</button>}
          {canQuotes && !activeQuote && !quoteOpen && (
            <button className="btn btn-primary btn-sm" onClick={() => { setError(''); openQuotePicker(); }}>
              + crear presupuesto
            </button>
          )}
        </div>
      </div>

      {error && <div style={{ marginBottom: 12 }}><ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} /></div>}
      {notice && (
        <div className="pill pill-green" style={{ marginBottom: 12, display: 'inline-block' }}>{notice}</div>
      )}

      <div className="grid-auto">
        <Card title="Equipo" meta={<span className={`pill ${STATUS_PILLS[eq.status]}`}>{eq.statusLabel}</span>}>
          {editing ? (
            <>
              <div className="field">
                <label className="field-label">Marca</label>
                <input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">Modelo</label>
                <input className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">Número de serie</label>
                <input className="input" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">Diagnóstico</label>
                <textarea className="textarea" value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
              </div>

              <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--gray-border)' }}>
                <h4 style={{ fontSize: 13, marginBottom: 8 }}>Contacto del cliente</h4>
                <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Podés cambiar a otro contacto del mismo cliente o corregir los datos de este contacto
                  (se actualiza el contacto global del cliente).
                </p>
                {contactForm && (
                  <>
                    <div className="field">
                      <label className="field-label">Contacto</label>
                      <select
                        className="select"
                        value={contactForm.contactId}
                        onChange={(e) => {
                          const picked = customerContacts.find((c) => c.id === e.target.value);
                          setContactForm({
                            contactId: e.target.value,
                            name: picked?.name || '',
                            email: picked?.email || '',
                            phone: '',
                          });
                        }}
                      >
                        {customerContacts.length === 0 && <option value="">— sin contactos cargados —</option>}
                        {customerContacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.email ? ` · ${c.email}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid-3">
                      <div className="field">
                        <label className="field-label">Nombre</label>
                        <input className="input" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
                      </div>
                      <div className="field">
                        <label className="field-label">Email</label>
                        <input className="input" type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
                      </div>
                      <div className="field">
                        <label className="field-label">Teléfono</label>
                        <input className="input" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="flex">
                <button className="btn btn-primary btn-sm" onClick={saveEdit}>guardar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>cancelar</button>
              </div>
            </>
          ) : (
            <>
              <Row label="Tipo" value={eq.equipmentTypeLabel} />
              <Row label="Marca" value={eq.brand} />
              <Row label="Modelo" value={eq.model} />
              <Row label="Serie" value={eq.serialNumber} />
              {eq.otherType && <Row label="Otro tipo" value={eq.otherType} />}
              <Row label="Accesorios" value={eq.accessories} />
              <Row label="Condición física" value={eq.physicalCondition} />
              <Row label="Fallo reportado" value={eq.reportedFault} />
              <Row label="Diagnóstico" value={eq.diagnosis} />
              {eq.deliveredAt && <Row label="Entregado" value={fmtDateTime(eq.deliveredAt)} />}
            </>
          )}
        </Card>

        <Card title="Avance del trabajo">
          <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
            Podés mover el estado hacia adelante o hacia atrás. Para pasar a «En reparación» hace falta un presupuesto aprobado.
          </p>
          <div className="flex wrap" style={{ gap: 6 }}>
            {nextable.map((s) => (
              <button key={s} className="btn btn-sm" disabled={!canWrite} onClick={() => setStatus(s)}>
                → {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <h4 style={{ fontSize: 13, marginBottom: 8 }}>Historial</h4>
            {eq.statusHistory.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Sin movimientos registrados</p>
            ) : (
              eq.statusHistory.map((h, i) => (
                <div key={i} className="flex-between" style={{ padding: '4px 0', borderBottom: '1px solid var(--gray-border)' }}>
                  <span className={`pill ${STATUS_PILLS[h.status]}`}>{STATUS_LABELS[h.status]}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{fmtDateTime(h.at)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        {activeQuote ? (
          <QuoteCard
            quote={activeQuote}
            items={activeItems}
            canQuotes={canQuotes}
            sent={quoteSent}
            onSend={send}
            onRespond={respond}
          />
        ) : quoteOpen ? (
          <Card title="Nuevo presupuesto">
            <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              Elegí ítems del catálogo de precios. La cantidad se edita después de marcar cada línea.
            </p>
            <button className="btn btn-sm btn-ghost" onClick={() => { setQuoteOpen(false); setSelected({}); }}>
              cerrar sin guardar
            </button>
            <div style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', border: '1px solid var(--gray-border)', borderRadius: 8 }}>
              {catalog.map((c) => {
                const checked = selected[c.id] != null;
                return (
                  <div
                    key={c.id}
                    className="flex-between"
                    style={{ padding: '6px 10px', borderBottom: '1px solid var(--gray-border)', background: checked ? 'var(--blue-suave)' : 'transparent' }}
                  >
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleCatalogItem(c.id)} />
                      <span>{c.name}</span>
                      {c.isLabor && <span className="pill pill-gray" style={{ fontSize: 11 }}>mano de obra</span>}
                    </label>
                    <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
                      {checked && (
                        <div className="flex" style={{ gap: 4, alignItems: 'center' }}>
                          <button type="button" className="btn btn-sm" onClick={() => qty(c.id, -1)}>−</button>
                          <span style={{ minWidth: 22, textAlign: 'center' }}>{selected[c.id]}</span>
                          <button type="button" className="btn btn-sm" onClick={() => qty(c.id, 1)}>+</button>
                        </div>
                      )}
                      <span>{money(c.price)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label">Notas del presupuesto</label>
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex">
              <button className="btn btn-primary" onClick={submitQuote}>guardar presupuesto</button>
            </div>
          </Card>
        ) : (
          <Card title="Presupuesto">
            <Empty message={canQuotes ? 'Todavía no hay presupuesto para este equipo.' : 'Sin presupuesto para este equipo.'} />
          </Card>
        )}
      </div>
    </Shell>
  );

  function openQuotePicker() {
    setQuoteOpen(true);
    setSelected({});
    setNotes('');
    workshopApi.catalog(true).then(setCatalog).catch(() => {});
  }
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex-between" style={{ padding: '5px 0', borderBottom: '1px solid var(--gray-border)' }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  );
}

function QuoteCard({
  quote,
  items,
  canQuotes,
  sent,
  onSend,
  onRespond,
}: {
  quote: WorkshopQuote;
  items: QuoteItem[];
  canQuotes: boolean;
  sent: boolean;
  onSend: () => void;
  onRespond: (d: 'aprobado' | 'rechazado') => void;
}) {
  const pendiente = quote.status === 'pendiente';
  return (
    <Card
      title={`Presupuesto ${quote.number}`}
      meta={<span className={`pill ${QUOTE_STATUS_PILLS[quote.status]}`}>{QUOTE_STATUS_LABELS[quote.status]}</span>}
    >
      <table className="table">
        <thead>
          <tr>
            <th>Detalle</th>
            <th>Cant.</th>
            <th>P. unitario</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id || i}>
              <td>
                {it.name}
                {it.isLabor ? ' (mano de obra)' : ''}
              </td>
              <td>{it.quantity}</td>
              <td>{money(it.unitPrice)}</td>
              <td>{money(it.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex-between" style={{ marginTop: 8 }}>
        <span className="muted">Total</span>
        <strong>{money(quote.total)}</strong>
      </div>
      {quote.notes && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{quote.notes}</p>}
      <div className="flex" style={{ gap: 6, marginTop: 12 }}>
        {pendiente && !sent && canQuotes && (
          <button className="btn btn-primary btn-sm" onClick={onSend}>
            Enviar al cliente
          </button>
        )}
        {pendiente && sent && canQuotes && (
          <>
            <button className="btn btn-sm" onClick={() => onRespond('aprobado')}>Aprobar</button>
            <button className="btn btn-sm btn-danger" onClick={() => onRespond('rechazado')}>Rechazar</button>
          </>
        )}
        {quote.sentAt && (
          <span className="muted" style={{ fontSize: 12 }}>Enviado {fmtDateTime(quote.sentAt)}</span>
        )}
      </div>
    </Card>
  );
}