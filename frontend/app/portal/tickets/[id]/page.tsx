'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../../lib/api';
import { usePortalAuth } from '../../../../lib/portal-auth';
import { Card, Empty, Pill } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';
import { STATUS_PILLS, STATUS_LABELS, PRIORITY_PILLS, PRIORITY_LABELS, SLA_PILLS, formatDate, formatTime, CHANNEL_LABELS, ticketNumberDisplay } from '../../../../lib/helpers';

interface PortalTicketDetail {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  ticketNumber: number | null;
  messages: Array<{
    id: string;
    authorType: string;
    channel: string;
    body: string;
    bodyHtml: string | null;
    createdAt: string;
    fromEmail: string | null;
  }>;
  technician?: { user?: { name?: string } } | null;
  sla?: {
    status: string;
    firstResponseDueAt: string | null;
    resolutionDueAt: string | null;
    resolvedAt: string | null;
  };
}

export default function PortalTicketDetail({ params }: { params: { id: string } }) {
  const { user } = usePortalAuth();
  const [ticket, setTicket] = useState<PortalTicketDetail | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api
      .get<PortalTicketDetail>(`/portal/tickets/${params.id}`)
      .then(setTicket)
      .catch((e) => setError((e as Error).message));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/portal/tickets/${params.id}/messages`, { body });
      setBody('');
      setMsg('Mensaje enviado');
      setTimeout(() => setMsg(''), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <div className="empty"><Link href="/portal/login" className="link">login</Link></div>;
  if (!ticket) return <div className="empty">cargando…</div>;

  return (
    <>
      <header className="portal-hero">
        <div className="flex wrap" style={{ gap: 10, alignItems: 'center' }}>
          <h1 className="portal-hello" style={{ margin: 0 }}>{ticket.title}</h1>
          {ticketNumberDisplay(ticket) && (
            <span className="pill pill-blue">{ticketNumberDisplay(ticket)}</span>
          )}
        </div>
        <p className="portal-sub">SolidOps · Portal de soporte</p>
      </header>
      <div style={{ marginTop: 16 }}>
        <Link href="/portal" className="portal-new-btn" style={{ background: 'transparent', color: 'var(--portal-accent)', border: '0.5px solid var(--portal-accent)' }}>← volver</Link>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}

      <div className="grid-auto">
        <Card title="Estado">
          <div className="stack">
            <div className="flex-between">
              <span className="muted">estado</span>
              <Pill style={STATUS_PILLS[ticket.status] || 'pill-gray'}>{STATUS_LABELS[ticket.status] || ticket.status}</Pill>
            </div>
            <div className="flex-between">
              <span className="muted">prioridad</span>
              <Pill style={PRIORITY_PILLS[ticket.priority] || 'pill-gray'}>{PRIORITY_LABELS[ticket.priority] || ticket.priority}</Pill>
            </div>
            <div className="flex-between">
              <span className="muted">creado</span>
              <span>{formatDate(ticket.createdAt)}</span>
            </div>
            {ticket.technician?.user?.name && (
              <div className="flex-between">
                <span className="muted">técnico</span>
                <span>{ticket.technician.user.name}</span>
              </div>
            )}
          </div>
        </Card>
        <Card title="SLA">
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
              <div className="flex-between">
                <span className="muted">resolución</span>
                <span>{formatDate(ticket.sla.resolutionDueAt)}</span>
              </div>
            </div>
          ) : (
            <Empty message="Sin SLA" />
          )}
        </Card>
      </div>

      <Card title="Conversación">
        <div className="stack">
          {ticket.messages.length === 0 && <Empty message="Sin mensajes" />}
          {ticket.messages.map((m) => (
            <div className="msg" key={m.id}>
              <div className="who">
                {m.authorType} · {CHANNEL_LABELS[m.channel] || m.channel} · {formatTime(m.createdAt)}
              </div>
              {m.bodyHtml ? (
                // HTML ya sanitizado en backend (sin scripts/eventos/javascript).
                // Se muestra con innerHTML; el contenido fue saneado al ingerir.
                <div className="msg-html" style={{ wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
              ) : (
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-16 flex">
          <textarea className="textarea" placeholder="escribí una respuesta…" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="mt-8 text-right">
          <button className="btn btn-primary" onClick={send} disabled={busy || !body.trim()}>responder</button>
        </div>
      </Card>
    </>
  );
}
