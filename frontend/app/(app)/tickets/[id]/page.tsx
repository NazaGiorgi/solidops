'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, getToken, API_URL } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Shell } from '../../shell';
import { PageHeader, Card, Empty, Pill } from '../../../../components/ui';
import { NotesSection } from '../../../../components/notes-section';
import { TicketAppointments } from '../../../../components/ticket-appointments';
import { ErrorNotice } from '../../../../components/error-notice';
import {
  STATUS_PILLS,
  STATUS_LABELS,
  PRIORITY_PILLS,
  PRIORITY_LABELS,
  SLA_PILLS,
  formatDate,
  formatTime,
  CHANNEL_LABELS,
  ticketNumberDisplay,
} from '../../../../lib/helpers';

interface TicketDetail {
  id: string;
  title: string;
  status: string;
  priority: string;
  category: string | null;
  description: string | null;
  createdAt: string;
  ticketNumber: number | null;
  customer?: { id?: string; name: string } | null;
  contact?: {
    id?: string;
    name: string;
    email?: string | null;
    whatsapp?: string | null;
    phone?: string | null;
  } | null;
  site?: { name: string } | null;
  technician?: { id?: string | null; user?: { name?: string } | null } | null;
  technicianId?: string | null;
  shadow?: boolean;
  // Enlace a Taller: presente cuando el ticket está vinculado a un equipo.
  workshop?: { equipmentId: string; contactName?: string | null } | null;
  // P3 merge fields
  mergedIntoId?: string | null;
  mergeGroupId?: string | null;
  mergedChildren?: Array<{ id: string; title: string; status: string }>;
  mergedMessages?: Array<{
    id: string;
    authorType: string;
    channel: string;
    body: string;
    createdAt: string;
    fromEmail: string | null;
    ticketId?: string;
  }>;
  messages: Array<{
    id: string;
    authorType: string;
    channel: string;
    body: string;
    bodyHtml?: string | null;
    createdAt: string;
    fromEmail: string | null;
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }>;
  }>;
  sla?: {
    status: string;
    firstResponseDueAt: string | null;
    resolutionDueAt: string | null;
    firstResponseAt: string | null;
    resolvedAt: string | null;
  };
}

const STATUS_OPTIONS = Object.keys(STATUS_LABELS);

// Opción de cliente para el buscador de "Vincular a cliente existente".
interface CustOption {
  id: string;
  name: string;
  contacts?: Array<{ id: string; name?: string | null; email?: string | null }>;
}

export default function TicketDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { user, hasPerm } = useAuth();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [data, setData] = useState<Partial<TicketDetail>>({});
  const [technicians, setTechnicians] = useState<Array<{ id: string; user?: { name?: string } }>>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  // P3 merge state
  const [mergeCandidates, setMergeCandidates] = useState<Array<{ id: string; title: string; status: string }>>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showMerge, setShowMerge] = useState(false);
  const [closeChildrenIds, setCloseChildrenIds] = useState<string[]>([]);
  // Vincular número de WhatsApp de un contacto genérico "Cliente WA {n}" a un cliente real.
  const [showLink, setShowLink] = useState(false);
  const [linkQ, setLinkQ] = useState('');
  const [linkResults, setLinkResults] = useState<CustOption[]>([]);
  const [linkSelected, setLinkSelected] = useState<CustOption | null>(null);
  const [linkContactId, setLinkContactId] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  // "Crear cliente nuevo" para contactos genéricos de WhatsApp.
  const [showCreate, setShowCreate] = useState(false);
  const [custName, setCustName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [phonePrefill, setPhonePrefill] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  // Only Supervisor/Coordinador (tickets:assign) may merge tickets; hide the
  // action for Technician instead of showing a button that always 403s.
  const canMerge = hasPerm('tickets:assign');

  // Chequeo de que el cliente es un genérico "Cliente WA ..." autogenerado por
  // WhatsApp. Solo para esos tickets se muestra "Vincular a cliente existente".
  const isGenericWaCustomer = !!(
    ticket &&
    ticket.customer?.name &&
    !ticket.workshop &&
    /^Cliente WA\b/i.test(ticket.customer.name)
  );
  const canLink = isGenericWaCustomer && !!ticket?.contact?.id && hasPerm('customers:update');
  // "Crear cliente nuevo" encadena create + link-to: necesita ambos permisos.
  const canCreateLink =
    isGenericWaCustomer && !!ticket?.contact?.id && hasPerm('customers:create') && hasPerm('customers:update');

  type MyError = Error & { status?: number };
  function prettyError(e: unknown): string {
    const err = e as MyError;
    if (err?.status === 403) return 'No tenés permiso para fusionar tickets';
    return err?.message || 'No se pudo completar la operación';
  }

  // Descarga de adjunto por el backend con el Bearer token (un <a href> plano no
  // manda el token y el endpoint de descarga responde 401 -> "Unauthorized").
  // Igual patrón que document-list / documentos (fetch + blob + <a download>).
  async function downloadAttachment(id: string, fallbackName: string) {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/tickets/attachments/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let msg = 'No se pudo descargar el adjunto';
        try {
          const json = await res.json();
          msg = json.message || msg;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Usar el filename del Content-Disposition (ej. "factura.pdf"), no el
      // genérico, para que se guarde el archivo real.
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*?=(?:"([^"]+)"|([^;]+))/i);
      const filename = decodeURIComponent((m && (m[1] || m[2]))?.trim() || fallbackName);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message || 'No se pudo descargar el adjunto');
    }
  }

  async function load() {
    try {
      const d = await api.get<TicketDetail>(`/tickets/${params.id}`);
      setTicket(d);
      setData({
        status: d.status,
        priority: d.priority,
        technicianId: d.technician?.id,
      });
      // Load merge candidates: other open tickets of the same customer.
      if (d.customer?.id) {
        api
          .get<Array<{ id: string; title: string; status: string }>>(
            `/tickets?customerId=${d.customer.id}`,
          )
          .then((all) => {
            const others = all.filter(
              (t) => t.id !== d.id && ['nuevo', 'abierto', 'asignado', 'en_progreso', 'esperando_cliente'].includes(t.status),
            );
            setMergeCandidates(others);
          })
          .catch(() => {});
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    api
      .get<Array<{ id: string; user?: { name?: string } }>>('/technicians')
      .then(setTechnicians)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Buscador de clientes para "Vincular a cliente existente" (debounce 300ms).
  useEffect(() => {
    if (!linkQ.trim()) {
      setLinkResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<CustOption[]>(`/customers?search=${encodeURIComponent(linkQ)}`)
        .then((rows) => setLinkResults(rows.filter((r) => r.id !== ticket?.customer?.id)))
        .catch(() => setLinkResults([]));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkQ]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      // P3: when closing the principal, ask which children to close together.
      if (
        data.status === 'cerrado' &&
        !ticket?.mergedIntoId &&
        (ticket?.mergedChildren?.length ?? 0) > 0
      ) {
        const chosen = closeChildrenIds;
        await api.post(`/tickets/${params.id}/merge/close`, {
          closeChildrenIds: chosen,
        });
      } else {
        await api.patch(`/tickets/${params.id}`, data);
        // If it WAS principal+children and now closing, fine; otherwise normal.
      }
      await load();
      setMsg('Guardado');
      setTimeout(() => setMsg(''), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doMerge() {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/tickets/${params.id}/merge`, { childIds: selectedIds });
      setMsg('Fusionado');
      setTimeout(() => setMsg(''), 2500);
      setSelectedIds([]);
      setShowMerge(false);
      await load();
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doDissolve() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/tickets/${params.id}/merge/dissolve`);
      setMsg('Fusión deshecha');
      setTimeout(() => setMsg(''), 2500);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/tickets/${params.id}/messages`, {
        channel: 'portal',
        authorType: 'tecnico',
        body,
      });
      await load();
      setBody('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Vincula el contacto genérico "Cliente WA {n}" de este ticket a un
  // contacto/cliente real elegido por el usuario.
  async function doLink() {
    if (!ticket?.contact?.id || !linkSelected || !linkContactId) return;
    setLinkBusy(true);
    setError('');
    try {
      await api.post(`/contacts/${ticket.contact.id}/link-to`, { contactId: linkContactId });
      setMsg('Número vinculado al cliente');
      setTimeout(() => setMsg(''), 3000);
      setShowLink(false);
      setLinkQ('');
      setLinkResults([]);
      setLinkSelected(null);
      setLinkContactId('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLinkBusy(false);
    }
  }

  // Abre el formulario "Crear cliente nuevo" con el teléfono ya prellenado con
  // el número del contacto genérico (whatsapp si existe, si no phone).
  function openCreate() {
    setShowCreate(true);
    setCustName('');
    setContactName('');
    setContactEmail('');
    setPhonePrefill(ticket?.contact?.whatsapp || ticket?.contact?.phone || '');
  }

  // Crea el cliente + contacto nuevo y, con el contactId recién creado, encadena
  // la vinculación existente (POST /contacts/:id/link-to) para reasignar el
  // ticket y fusionar el genérico. Desde el punto de vista del técnico es "un
  // solo paso"; por dentro son dos llamadas que reusan los endpoints existentes.
  async function doCreateAndLink() {
    if (!ticket?.contact?.id || !custName.trim() || !contactName.trim()) return;
    setCreateBusy(true);
    setError('');
    try {
      const cust = await api.post<{ id: string }>('/customers', { name: custName.trim() });
      const contact = await api.post<{ id: string }>(`/customers/${cust.id}/contacts`, {
        name: contactName.trim(),
        email: contactEmail.trim() || undefined,
        whatsapp: phonePrefill.trim() || undefined,
      });
      await api.post(`/contacts/${ticket.contact.id}/link-to`, { contactId: contact.id });
      setMsg('Cliente creado y ticket reasignado');
      setTimeout(() => setMsg(''), 3000);
      setShowCreate(false);
      setCustName('');
      setContactName('');
      setContactEmail('');
      setPhonePrefill('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreateBusy(false);
    }
  }

  if (!ticket) {
    return (
      <Shell>
        {error ? <ErrorNotice message={error} onDismiss={() => setError('')} /> : <div className="empty">cargando…</div>}
      </Shell>
    );
  }

  return (
    <Shell>
      <PageHeader
        title={
          <span className="flex wrap" style={{ gap: 8, alignItems: 'center' }}>
            {ticket.title}
            {ticketNumberDisplay(ticket) && (
              <span className="pill pill-blue">{ticketNumberDisplay(ticket)}</span>
            )}
          </span>
        }
        subtitle={
          <span className="flex wrap" style={{ gap: 8, alignItems: 'center' }}>
            {ticket.workshop?.contactName || ticket.customer?.name || '—'}
            {ticket.customer?.id && !ticket.workshop && (
              <>
                {' · '}
                <Link href={`/clientes/${ticket.customer.id}`} className="link">
                  {ticket.customer?.name || '—'}
                </Link>
              </>
            )}
            {ticket.workshop && (
              <Link
                href={`/taller/${ticket.workshop.equipmentId}`}
                className="pill pill-blue ticket-cell-workshop"
                title="Ver equipo en Taller"
              >
                🔧 Taller
              </Link>
            )}
          </span>
        }
        action={
          <Link href="/tickets" className="btn">
            ← volver
          </Link>
        }
      />
      {msg && <div className="notice">{msg}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}
      {ticket.shadow && (
        <div className="notice notice-shadow">
          <strong>☁ Modo sombra — no responder desde acá.</strong>{' '}
          Este ticket se creó observando la casilla <code>soporte@solidocs.com.ar</code> mientras
          Zammad sigue siendo el sistema que la procesa. Trabajá el ticket real en Zammad, no desde
          esta pantalla.
        </div>
      )}

      {/* Quick actions: assign + state */}
      <Card>
        <div className="flex wrap">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Estado</label>
            <select
              className="select"
              value={data.status || ''}
              onChange={(e) => setData((d) => ({ ...d, status: e.target.value }))}
            >
              {STATUS_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Prioridad</label>
            <select
              className="select"
              value={data.priority || ''}
              onChange={(e) => setData((d) => ({ ...d, priority: e.target.value }))}
            >
              {Object.keys(PRIORITY_LABELS).map((k) => (
                <option key={k} value={k}>
                  {PRIORITY_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Técnico</label>
            <select
              className="select"
              value={data.technicianId || ''}
              onChange={(e) => setData((d) => ({ ...d, technicianId: e.target.value || null }))}
            >
              <option value="">sin asignar</option>
              {technicians.map((tech) => (
                <option key={tech.id} value={tech.id}>
                  {tech.user?.name || tech.id}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            guardar
          </button>
          {canMerge && !ticket.mergedIntoId && mergeCandidates.length > 0 && (
            <button className="btn" onClick={() => setShowMerge((v) => !v)}>
              fusionar ticket
            </button>
          )}
        </div>
      </Card>

      {/* P3: closing a principal -> choose children to close */}
      {data.status === 'cerrado' &&
        !ticket.mergedIntoId &&
        (ticket.mergedChildren?.length ?? 0) > 0 && (
          <Card>
            <h3 className="card-title">Cerrar junto con el principal</h3>
            <div className="muted mb-8" style={{ fontSize: 12 }}>
              Elegí qué tickets hijos cerrar también. Los no marcados vuelven a ser independientes.
            </div>
            <div className="stack">
              {ticket.mergedChildren?.map((c) => (
                <label key={c.id} className="flex" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={closeChildrenIds.includes(c.id)}
                    onChange={(e) =>
                      setCloseChildrenIds((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                      )
                    }
                  />
                  <span>#{c.id.slice(0, 8)} · {c.title}</span>
                </label>
              ))}
            </div>
          </Card>
        )}

      {/* P3: merge badge / controls */}
      {ticket.mergedIntoId && (
        <Card>
          <div className="flex wrap">
            <Pill style="pill-amber">fusionado</Pill>
            <span>
              este ticket está fusionado en{' '}
              <Link href={`/tickets/${ticket.mergedIntoId}`} className="link">
                #{ticket.mergedIntoId.slice(0, 8)}
              </Link>
            </span>
            {canMerge && (
              <button className="btn btn-sm" onClick={doDissolve} disabled={busy}>
                deshacer fusión
              </button>
            )}
          </div>
        </Card>
      )}

      {!ticket.mergedIntoId && (ticket.mergedChildren?.length ?? 0) > 0 && (
        <Card>
          <div className="flex wrap flex-between">
            <div>
              <div className="flex wrap">
                <Pill style="pill-blue">principal</Pill>
                <span className="muted">
                  fusiona {ticket.mergedChildren?.length} ticket(s)
                </span>
              </div>
              <div className="flex wrap mt-8">
                {ticket.mergedChildren?.map((c) => (
                  <Link key={c.id} href={`/tickets/${c.id}`} className="link" style={{ fontSize: 13 }}>
                    #{c.id.slice(0, 8)} · {c.title}
                  </Link>
                ))}
              </div>
            </div>
            {canMerge && (
              <button className="btn btn-sm" onClick={doDissolve} disabled={busy}>
                deshacer fusión
              </button>
            )}
          </div>
        </Card>
      )}

      {/* P3: merge a support ticket (Supervisor/Coordinador) */}
      {canMerge && showMerge && mergeCandidates.length > 0 && (
        <Card>
          <h3 className="card-title">Fusionar tickets en este</h3>
          <div className="stack">
            {mergeCandidates.map((c) => (
              <label key={c.id} className="flex" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(c.id)}
                  onChange={(e) =>
                    setSelectedIds((prev) =>
                      e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id),
                    )
                  }
                />
                <span>
                  #{c.id.slice(0, 8)} · {c.title} ({STATUS_LABELS[c.status] || c.status})
                </span>
              </label>
            ))}
          </div>
          <div className="flex mt-16">
            <button className="btn btn-primary" onClick={doMerge} disabled={busy || selectedIds.length === 0}>
              fusionar seleccionados
            </button>
            <button className="btn btn-ghost" onClick={() => setShowMerge(false)}>
              cancelar
            </button>
          </div>
        </Card>
      )}

      <div className="grid-auto">
        <Card title="SLA" meta={ticket.contact?.name ? `contacto: ${ticket.contact.name}${ticket.contact.email ? ` (${ticket.contact.email})` : ''}` : ''}>
          {ticket.sla ? (
            <div className="stack">
              <div className="flex-between">
                <span className="muted">estado</span>
                <Pill style={SLA_PILLS[ticket.sla.status] || 'pill-gray'}>{ticket.sla.status}</Pill>
              </div>
              <div className="flex-between">
                <span className="muted">primera respuesta</span>
                <span>{formatDate(ticket.sla.firstResponseDueAt)}</span>
              </div>
              {ticket.sla.firstResponseAt && (
                <div className="flex-between">
                  <span className="muted">respondido</span>
                  <span>{formatDate(ticket.sla.firstResponseAt)}</span>
                </div>
              )}
              <div className="flex-between">
                <span className="muted">resolución</span>
                <span>{formatDate(ticket.sla.resolutionDueAt)}</span>
              </div>
              {ticket.sla.resolvedAt && (
                <div className="flex-between">
                  <span className="muted">resuelto</span>
                  <span>{formatDate(ticket.sla.resolvedAt)}</span>
                </div>
              )}
            </div>
          ) : (
            <Empty message="Sin SLA calculado" />
          )}
        </Card>

        <Card title="Detalle">
          <div className="stack">
            <div className="flex-between">
              <span className="muted">creado</span>
              <span>{formatDate(ticket.createdAt)}</span>
            </div>
            <div className="flex-between">
              <span className="muted">cliente</span>
              <span className="flex" style={{ gap: 8, alignItems: 'center' }}>
                {ticket.customer?.id ? (
                  <Link href={`/clientes/${ticket.customer.id}`} className="link">
                    {ticket.customer?.name || '—'}
                  </Link>
                ) : (
                  ticket.customer?.name || '—'
                )}
                {canLink && (
                  <button className="btn btn-sm" onClick={() => { setShowLink((v) => !v); setShowCreate(false); }}>
                    vincular a cliente existente
                  </button>
                )}
                {canCreateLink && (
                  <button className="btn btn-sm" onClick={() => { setShowCreate((v) => !v); setShowLink(false); }}>
                    crear cliente nuevo
                  </button>
                )}
              </span>
            </div>
            <div className="flex-between">
              <span className="muted">sitio</span>
              <span>{ticket.site?.name || '—'}</span>
            </div>
            <div className="flex-between">
              <span className="muted">categoría</span>
              <span>{ticket.category || '—'}</span>
            </div>
            {ticket.description && <p style={{ margin: 0, paddingTop: 8 }}>{ticket.description}</p>}
          </div>
        </Card>

      {showLink && canLink && (
        <Card>
          <h3 className="card-title">Vincular a cliente existente</h3>
          <div className="muted mb-8" style={{ fontSize: 12 }}>
            Este número de WhatsApp pertenece a un contacto genérico autogenerado. Al vincularlo, los
            tickets y los futuros mensajes de este número pasarán al cliente que elijas, y el contacto
            genérico quedará fusionado (no se borra, se conserva como registro fusionado).
          </div>
          <input
            className="input"
            placeholder="Buscar cliente por nombre…"
            value={linkQ}
            onChange={(e) => {
              setLinkQ(e.target.value);
              setLinkSelected(null);
              setLinkContactId('');
            }}
            autoFocus
          />
          {linkResults.length > 0 && !linkSelected && (
            <ul className="stack mt-8">
              {linkResults.map((c) => (
                <li key={c.id}>
                  <button
                    className="btn btn-ghost"
                    style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                    onClick={() => {
                      setLinkSelected(c);
                      setLinkContactId(c.contacts && c.contacts.length > 0 ? c.contacts[0].id : '');
                    }}
                  >
                    {c.name}
                    <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                      {c.contacts?.length ? `${c.contacts.length} contacto(s)` : 'sin contactos'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {linkSelected && (
            <div className="stack mt-8">
              <div className="flex wrap" style={{ gap: 8, alignItems: 'center' }}>
                <strong>{linkSelected.name}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() => setLinkSelected(null)}>
                  cambiar
                </button>
              </div>
              {(linkSelected.contacts?.length ?? 0) > 0 ? (
                <div className="field">
                  <label>Contacto del cliente que recibirá el número</label>
                  <select className="select" value={linkContactId} onChange={(e) => setLinkContactId(e.target.value)}>
                    {(linkSelected.contacts ?? []).map((ct) => (
                      <option key={ct.id} value={ct.id}>
                        {ct.name || '—'}
                        {ct.email ? ` (${ct.email})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="notice">
                  Este cliente no tiene contactos. Creá uno desde la ficha del cliente antes de vincular.
                </div>
              )}
              <div className="flex mt-16">
                <button
                  className="btn btn-primary"
                  onClick={doLink}
                  disabled={linkBusy || !linkContactId}
                >
                  {linkBusy ? 'vinculando…' : 'vincular y reasignar tickets'}
                </button>
                <button className="btn btn-ghost" onClick={() => setShowLink(false)}>
                  cancelar
                </button>
              </div>
            </div>
          )}
          {linkQ.trim() && linkResults.length === 0 && !linkSelected && (
            <div className="muted mt-8" style={{ fontSize: 12 }}>
              Sin resultados para «{linkQ}».
            </div>
          )}
        </Card>
      )}

      {showCreate && canCreateLink && (
        <Card>
          <h3 className="card-title">Crear cliente nuevo</h3>
          <div className="muted mb-8" style={{ fontSize: 12 }}>
            Este número de WhatsApp pertenece a un contacto genérico autogenerado. Si el cliente es
            nuevo, creá su registro: se dará de alta el cliente, se asociará el número y el ticket
            quedará reasignado automáticamente (el contacto genérico se fusiona, no se borra).
          </div>
          <div className="grid-3">
            <div className="field">
              <label>Cliente (empresa)</label>
              <input
                className="input"
                placeholder="Nombre de la empresa o cliente…"
                value={custName}
                onChange={(e) => setCustName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Nombre de contacto</label>
              <input
                className="input"
                placeholder="Nombre de la persona…"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                className="input"
                type="email"
                placeholder="opcional"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Teléfono / WhatsApp</label>
              <input
                className="input"
                value={phonePrefill}
                onChange={(e) => setPhonePrefill(e.target.value)}
              />
            </div>
          </div>
          <div className="flex mt-16">
            <button
              className="btn btn-primary"
              onClick={doCreateAndLink}
              disabled={createBusy || !custName.trim() || !contactName.trim()}
            >
              {createBusy ? 'creando y vinculando…' : 'crear cliente y reasignar ticket'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>
              cancelar
            </button>
          </div>
        </Card>
      )}
      </div>

      <TicketAppointments ticketId={ticket.id} />
      <NotesSection ticketId={ticket.id} />

      {/* Conversation thread */}
      <Card title="Conversación" meta={(ticket.mergedMessages?.length ?? 0) > 0 ? `incluye ${ticket.mergedMessages?.length} mensaje(s) de tickets fusionados` : ''}>
        <div className="stack">
          {ticket.messages.length === 0 && (ticket.mergedMessages?.length ?? 0) === 0 && (
            <Empty message="Sin mensajes" />
          )}
          {ticket.messages.map((m) => (
            <div className="msg" key={m.id}>
              <div className="who">
                {m.authorType} · {CHANNEL_LABELS[m.channel] || m.channel} · {formatTime(m.createdAt)}
                {m.fromEmail ? ` · ${m.fromEmail}` : ''}
              </div>
              {m.bodyHtml ? (
                // HTML ya sanitizado en backend (sin scripts/eventos/javascript).
                // Se muestra con innerHTML; el contenido fue saneado al ingerir.
                <div className="msg-html" style={{ wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
              ) : (
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              )}
{m.attachments && m.attachments.length > 0 && (
                    <div className="flex wrap" style={{ gap: 8, marginTop: 8 }}>
                      {m.attachments.map((a) => (
                        <button
                          key={a.id}
                          className="btn btn-sm"
                          onClick={() => downloadAttachment(a.id, a.filename)}
                          type="button"
                          title={`${a.filename}${a.sizeBytes ? ` (${Math.round(a.sizeBytes / 1024)} KB)` : ''}`}
                        >
                          📎 {a.filename}
                        </button>
                      ))}
                    </div>
                  )}
            </div>
          ))}
          {(ticket.mergedMessages ?? []).map((m) => (
            <div className="msg msg-merged" key={m.id}>
              <div className="who">
                {m.authorType} · {CHANNEL_LABELS[m.channel] || m.channel} · {formatTime(m.createdAt)}
                {m.fromEmail ? ` · ${m.fromEmail}` : ''}
                {m.ticketId ? (
                  <>
                    {' · de '}
                    <Link href={`/tickets/${m.ticketId}`} className="link">
                      #{m.ticketId.slice(0, 8)}
                    </Link>
                  </>
                ) : null}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
            </div>
          ))}
        </div>
        <div className="mt-16 flex">
          <textarea
            className="textarea"
            placeholder="escribí una respuesta interna…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div className="mt-8 text-right">
          <button className="btn btn-primary" onClick={sendMessage} disabled={busy || !body.trim()}>
            responder
          </button>
        </div>
      </Card>
    </Shell>
  );
}
