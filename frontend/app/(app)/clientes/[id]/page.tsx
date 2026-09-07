'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { Shell } from '../../shell';
import { PageHeader, Card, Empty, Pill } from '../../../../components/ui';
import { TicketCard, TicketCardData } from '../../../../components/ticket-card';
import { DocumentList } from '../../../../components/document-list';
import { NotesSection } from '../../../../components/notes-section';
import { ErrorNotice } from '../../../../components/error-notice';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  preferredChannel: string;
  portalEnabled: boolean;
  hasPortalPassword?: boolean;
}
interface Site {
  id: string;
  name: string;
  address: string | null;
}
interface Contract {
  id: string;
  name: string | null;
  slaFirstResponseMinutes: number;
  slaResolutionHours: number;
  active: boolean;
}
interface CustomerDetail {
  id: string;
  name: string;
  contacts: Contact[];
  sites: Site[];
  contracts: Contract[];
}

const OPEN_STATUSES = new Set(['nuevo', 'abierto', 'asignado', 'en_progreso', 'esperando_cliente']);
// SLA urgency for the auto-sort: red first, then yellow, then green.
const SLA_ORDER: Record<string, number> = { rojo: 0, amarillo: 1, verde: 2 };

function sortTickets(tickets: TicketCardData[]): TicketCardData[] {
  const open = tickets.filter((t) => OPEN_STATUSES.has(t.status));
  const closed = tickets.filter((t) => !OPEN_STATUSES.has(t.status));
  open.sort((a, b) => {
    const sa = SLA_ORDER[a.slaStatus || 'verde'] ?? 2;
    const sb = SLA_ORDER[b.slaStatus || 'verde'] ?? 2;
    if (sa !== sb) return sa - sb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  closed.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return [...open, ...closed];
}

export default function CustomerDetail({ params }: { params: { id: string } }) {
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [tickets, setTickets] = useState<TicketCardData[]>([]);
  const [ticketSearch, setTicketSearch] = useState('');
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingContact, setEditingContact] = useState<Contact | null>(null);

  function load() {
    api
      .get<CustomerDetail>(`/customers/${params.id}`)
      .then(setC)
      .catch((e) => setError((e as Error).message));
    api
      .get<{ items: TicketCardData[]; total: number }>(`/tickets?customerId=${params.id}&take=200`)
      .then((res) => {
        // El backend ahora devuelve { items, total } (paginado). Acepta ambas
        // formas por robustez (version vieja = array plano).
        setTickets(Array.isArray(res) ? res : res?.items || []);
      })
      .catch(() => {})
      .finally(() => setTicketsLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-sorted tickets (open by SLA urgency, then closed by date). Applied
  // always, no manual filter needed. Optionally further filtered by the search.
  const sortedTickets = useMemo(() => {
    const filtered = ticketSearch.trim()
      ? tickets.filter((t) => t.title.toLowerCase().includes(ticketSearch.toLowerCase()))
      : tickets;
    return sortTickets(filtered);
  }, [tickets, ticketSearch]);

  const openCount = useMemo(
    () => tickets.filter((t) => OPEN_STATUSES.has(t.status)).length,
    [tickets],
  );

  if (!c) return <Shell><div className="empty">{error ? error : 'cargando…'}</div></Shell>;

  return (
    <Shell>
      <PageHeader
        title={c.name}
        subtitle="Ficha 360 — contactos, sitios, contratos y tickets"
        action={
          <Link href="/clientes" className="btn">
            ← volver
          </Link>
        }
      />
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      <AddContact customerId={c.id} customerName={c.name} onAdd={load} />
      {editingContact && (
        <EditContactModal
          customerId={c.id}
          contact={editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={() => { load(); setEditingContact(null); }}
        />
      )}

      {/* ==== Tickets (sección principal de la ficha 360) ==== */}
      <Card
        title="Tickets"
        meta={`${openCount} abiertos · ${tickets.length - openCount} cerrados`}
      >
        <div className="flex wrap mb-16">
          <input
            className="input"
            style={{ maxWidth: 300 }}
            placeholder="buscar ticket de este cliente…"
            value={ticketSearch}
            onChange={(e) => setTicketSearch(e.target.value)}
          />
          <span className="card-meta" style={{ alignSelf: 'center' }}>
            Abiertos por urgencia SLA primero — rojo, amarillo, verde; luego cerrados por fecha.
          </span>
        </div>
        {ticketsLoading ? (
          <div className="empty">cargando…</div>
        ) : sortedTickets.length === 0 ? (
          <Empty message="Sin tickets para este cliente" />
        ) : (
          <div className="grid-auto">
            {sortedTickets.map((t) => (
              <TicketCard key={t.id} ticket={t} />
            ))}
          </div>
        )}
        <div className="mt-16">
          <Link href={`/tickets?customerId=${c.id}`} className="link">
            ver todos los tickets →
          </Link>
        </div>
      </Card>
      <Card title="Contactos" meta={`${c.contacts.length}`}>
        {c.contacts.length === 0 ? (
          <Empty message="Sin contactos" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>nombre</th>
                <th>email</th>
                <th>teléfono</th>
                <th>canal preferido</th>
                <th>portal</th>
                <th className="text-right">acciones</th>
              </tr>
            </thead>
            <tbody>
              {c.contacts.map((cc) => (
                <tr key={cc.id}>
                  <td style={{ fontWeight: 500 }}>{cc.name}</td>
                  <td>{cc.email || '—'}</td>
                  <td>{cc.phone || '—'}</td>
                  <td>{cc.preferredChannel}</td>
                  <td>
                    <Pill style={cc.portalEnabled ? 'pill-green' : 'pill-gray'}>
                      {cc.portalEnabled ? 'portal habilitado' : 'sin portal'}
                    </Pill>
                  </td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => setEditingContact(cc)}>
                      editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <NotesSection customerId={c.id} />

      <div className="grid-auto">
        <Card title="Sitios" meta={`${c.sites.length}`}>
          {c.sites.length === 0 ? (
            <Empty message="Sin sitios" />
          ) : (
            <div className="stack">
              {c.sites.map((s) => (
                <div key={s.id}>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  <div className="card-meta">{s.address || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Contratos" meta="SLA contratado">
          {c.contracts.length === 0 ? (
            <Empty message="Sin contrato" />
          ) : (
            <div className="stack">
              {c.contracts.map((ct) => (
                <div key={ct.id}>
                  <div style={{ fontWeight: 500 }}>{ct.name || 'sin nombre'}</div>
                  <div className="card-meta">
                    1ª respuesta {ct.slaFirstResponseMinutes} min · resolución {ct.slaResolutionHours} h
                  </div>
                  <div className="card-meta">
                    <Pill style={ct.active ? 'pill-green' : 'pill-gray'}>{ct.active ? 'vigente' : 'inactivo'}</Pill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ==== Documentos (box de la ficha 360) ==== */}
      <DocumentList customerId={c.id} />
    </Shell>
  );
}

// Modal to edit an existing contact and manage its portal access.
function EditContactModal({
  customerId,
  contact,
  onClose,
  onSaved,
}: {
  customerId: string;
  contact: Contact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: contact.name,
    email: contact.email || '',
    phone: contact.phone || '',
    whatsapp: contact.whatsapp || '',
    preferredChannel: contact.preferredChannel,
    portalEnabled: contact.portalEnabled,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [manualPw, setManualPw] = useState('');
  const [showManualPw, setShowManualPw] = useState(false);
  const [confirmingManual, setConfirmingManual] = useState(false);
  const [settingPw, setSettingPw] = useState(false);

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError('');
    try {
      // 1) Edit contact fields.
      await api.patch(`/customers/${customerId}/contacts/${contact.id}`, {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        whatsapp: form.whatsapp || null,
        preferredChannel: form.preferredChannel,
      });
      // 2) Portal enable/disable. La contraseña NO se toca acá: se fija con el
      // bloque "Cambiar contraseña de portal manualmente" (mecanismo único).
      await api.patch(`/customers/${customerId}/contacts/${contact.id}/portal`, {
        enabled: form.portalEnabled,
      });
      setNotice('Guardado');
      setTimeout(() => setNotice(''), 800);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // Fija manualmente la contraseña de portal del contacto (staff). Nunca se
  // envía por email: el staff la copia y se la pasa al cliente por el canal que
  // corresponda. El backend la hashea y audita el hecho sin guardarla en claro.
  async function setManualPassword() {
    if (!manualPw || manualPw.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setSettingPw(true);
    setError('');
    try {
      await api.post(`/customers/${customerId}/contacts/${contact.id}/portal/password`, {
        password: manualPw,
      });
      setNotice('Contraseña de portal cambiada');
      setManualPw('');
      setConfirmingManual(false);
      setShowManualPw(false);
      setTimeout(() => setNotice(''), 2500);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSettingPw(false);
    }
  }

  // Genera una contraseña aleatoria segura (sin caracteres ambiguos) para que el
  // staff la copie y se la comunique al cliente.
  function generatePassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    const arr = new Uint32Array(14);
    crypto.getRandomValues(arr);
    for (let i = 0; i < 14; i++) out += chars[arr[i] % chars.length];
    setManualPw(out);
    setShowManualPw(true);
    setConfirmingManual(false);
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head flex-between">
          <h3 className="card-title" style={{ margin: 0 }}>Editar contacto</h3>
          <button className="notice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        {notice && <div className="notice">{notice}</div>}
        {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}
        <div className="modal-body">
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="grid-3">
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="field">
              <label>Teléfono</label>
              <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div className="field">
              <label>WhatsApp</label>
              <input className="input" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Canal preferido</label>
            <select className="select" value={form.preferredChannel} onChange={(e) => set('preferredChannel', e.target.value)}>
              <option value="email">email</option>
              <option value="whatsapp">whatsapp</option>
              <option value="telefono">teléfono</option>
            </select>
          </div>
          <div className="field">
            <label>Habilitar portal del cliente</label>
            <div className="flex wrap">
              <select className="select" style={{ maxWidth: 120 }} value={String(form.portalEnabled)} onChange={(e) => set('portalEnabled', e.target.value === 'true')}>
                <option value="true">sí</option>
                <option value="false">no</option>
              </select>
            </div>
            {form.portalEnabled && !contact.hasPortalPassword && (
              <div className="card-meta" style={{ marginTop: 6, color: 'var(--warning, #b45309)' }}>
                Portal habilitado sin contraseña — usá «Cambiar contraseña de portal manualmente» para fijar una antes de que el cliente pueda ingresar.
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <label className="field-label">Cambiar contraseña de portal manualmente</label>
            <div className="flex wrap" style={{ gap: 8, alignItems: 'center' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <input
                  className="input"
                  type={showManualPw ? 'text' : 'password'}
                  placeholder="contraseña nueva (mín. 8)"
                  value={manualPw}
                  onChange={(e) => { setManualPw(e.target.value); setConfirmingManual(false); }}
                  autoComplete="new-password"
                />
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setShowManualPw((v) => !v)}
                title={showManualPw ? 'Ocultar' : 'Mostrar'}
              >
                {showManualPw ? 'ocultar' : 'ver'}
              </button>
              <button type="button" className="btn btn-sm" onClick={generatePassword} title="Generar contraseña aleatoria">
                generar
              </button>
            </div>
            <div className="card-meta" style={{ marginTop: 6 }}>
              Única forma de fijar la contraseña de portal (tanto al habilitar por primera vez como al cambiarla). El staff la copia y se la comunica al cliente por el canal que corresponda. Nunca se envía por email.
            </div>

            {!confirmingManual ? (
              <button
                className="btn btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => { setError(''); setConfirmingManual(true); }}
                disabled={!manualPw || manualPw.length < 8}
              >
                Cambiar contraseña…
              </button>
            ) : (
              <div className="flex wrap" style={{ marginTop: 10, gap: 8, alignItems: 'center', background: 'var(--bg-subtle)', padding: '8px 12px', borderRadius: 8 }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  Se reemplaza la contraseña actual. ¿Confirmás?
                </span>
                <button className="btn btn-primary btn-sm" onClick={setManualPassword} disabled={settingPw}>
                  {settingPw ? 'cambiando…' : 'confirmar'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingManual(false)} disabled={settingPw}>
                  cancelar
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="modal-foot flex flex-between">
          <button className="btn btn-ghost" onClick={onClose}>cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy ? 'guardando…' : 'guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddContact({ customerId, customerName, onAdd }: { customerId: string; customerName: string; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<{ customerId: string; customerName: string; contactCount: number } | null>(null);
  const [checking, setChecking] = useState(false);

  // Check por dominio al escribir el email (debounced), excluyendo el cliente
  // actual para no auto-sugerirse. Solo sugiere si el dominio NO es personal.
  useEffect(() => {
    const email = form.email.trim();
    if (!email.includes('@')) {
      setSuggestion(null);
      return;
    }
    const handle = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await api.get<{ excluded: boolean; domain: string; candidates: { customerId: string; customerName: string; contactCount: number }[] }>(
          `/customers/suggest-by-domain?email=${encodeURIComponent(email)}&excludeCustomerId=${customerId}`
        );
        setSuggestion(res.candidates?.[0] ?? null);
      } catch {
        setSuggestion(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [form.email, customerId]);

  async function submit(e: React.FormEvent, targetCustomerId?: string) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const targetId = targetCustomerId ?? customerId;
      await api.post(`/customers/${targetId}/contacts`, form);
      setOpen(false);
      setForm({ name: '', email: '', phone: '' });
      setSuggestion(null);
      onAdd();
    } catch (err) {
      setError((err as Error).message || 'No se pudo guardar el contacto');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-16">
        <button className="btn" onClick={() => setOpen(true)}>
          + agregar contacto
        </button>
      </div>
    );
  }
  return (
    <div className="card mb-16">
      <h3 className="card-title">Nuevo contacto</h3>
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      {suggestion && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 500 }}>
            ¡Encontramos una coincidencia de dominio!
          </div>
          <div className="card-meta">
            Ya existe {suggestion.contactCount} contacto(s) con el dominio <strong>@{form.email.split('@')[1]}</strong> en el cliente{' '}
            <strong>{suggestion.customerName}</strong>. ¿Asociar este contacto ahí en vez de al cliente actual?
          </div>
          <div className="flex" style={{ gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={(e) => submit(e, suggestion.customerId)}>
              {busy ? 'guardando…' : `Asociar a ${suggestion.customerName}`}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSuggestion(null)}>
              No, mantener en {customerName}
            </button>
          </div>
        </div>
      )}
      <form onSubmit={(e) => submit(e)} className="grid-3">
        <div className="field">
          <label>Nombre</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label>Email {checking && <span className="card-meta">…</span>}</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label>Teléfono</label>
          <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <div className="flex" style={{ gridColumn: 'span 3' }}>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'guardando…' : 'guardar'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setError(''); setSuggestion(null); }}>
            cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
