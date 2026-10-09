'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, getToken, API_URL } from '../../../../lib/api';
import { usePortalAuth } from '../../../../lib/portal-auth';
import { Card, Empty, Pill } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';
import { STATUS_PILLS, STATUS_LABELS, PRIORITY_PILLS, PRIORITY_LABELS, SLA_PILLS, formatDate, formatTime, CHANNEL_LABELS, ticketNumberDisplay } from '../../../../lib/helpers';
import {
  ALLOWED_ATTACHMENTS_LABEL,
  MAX_ATTACH_BYTES,
  isAllowedAttachFile,
  attachKind,
  attachIcon,
  formatSize,
} from '../../../../lib/attach-files';

interface PendingFile {
  key: string;
  file: File;
  kind: 'image' | 'doc';
  preview?: string;
}

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
    attachments?: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }>;
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
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  function onPickFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files || []);
    ev.target.value = '';
    const next: PendingFile[] = [];
    for (const f of files) {
      if (!isAllowedAttachFile(f)) {
        setError(`«${f.name}» tiene un formato no permitido. Podés adjuntar ${ALLOWED_ATTACHMENTS_LABEL}.`);
        continue;
      }
      if (f.size > MAX_ATTACH_BYTES) {
        setError(`«${f.name}» supera el tamaño máximo de 25 MB (${f.size} bytes).`);
        continue;
      }
      const kind = attachKind(f);
      next.push({
        key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file: f,
        kind,
        preview: kind === 'image' ? URL.createObjectURL(f) : undefined,
      });
    }
    if (next.length > 0) setError('');
    setPendingFiles((prev) => [...prev, ...next]);
  }

  function removePending(key: string) {
    setPendingFiles((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function send() {
    if (!body.trim() && pendingFiles.length === 0) return;
    setBusy(true);
    setError('');
    try {
      // Igual que en el panel del staff: primero el mensaje, después los archivos.
      const saved = await api.post<{ id: string }>(`/portal/tickets/${params.id}/messages`, { body });
      for (const p of pendingFiles) {
        const fd = new FormData();
        fd.append('file', p.file);
        await api.upload(`/portal/tickets/messages/${saved.id}/attachments`, fd);
      }
      for (const p of pendingFiles) {
        if (p.preview) URL.revokeObjectURL(p.preview);
      }
      setBody('');
      setPendingFiles([]);
      setMsg(pendingFiles.length > 0 ? 'Adjuntos enviados' : 'Mensaje enviado');
      setTimeout(() => setMsg(''), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Descarga de adjuntos del ticket vía el endpoint del portal (autenticado con
  // el token de portal; el endpoint del staff respondería 401 por JWT distinto).
  async function downloadAttachment(id: string, fallbackName: string) {
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/portal/tickets/attachments/${id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        let message = 'No se pudo descargar el adjunto';
        try {
          const json = await res.json();
          message = json.message || message;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
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
              {m.attachments && m.attachments.length > 0 && (
                <div className="flex wrap" style={{ gap: 8, marginTop: 8 }}>
                  {m.attachments.map((a) => (
                    <button
                      key={a.id}
                      className="btn btn-sm"
                      type="button"
                      onClick={() => downloadAttachment(a.id, a.filename)}
                      title={`${a.filename}${a.sizeBytes ? ` (${Math.round(a.sizeBytes / 1024)} KB)` : ''}`}
                    >
                      📎 {a.filename}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-16 flex">
          <textarea className="textarea" placeholder="escribí una respuesta…" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="mt-8 flex wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
            multiple
            style={{ display: 'none' }}
            onChange={onPickFiles}
          />
          <button
            type="button"
            className="btn"
            onClick={() => fileInputRef.current?.click()}
            title={`adjuntar archivo: ${ALLOWED_ATTACHMENTS_LABEL}`}
          >
            📎 adjuntar archivo
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            imágenes, PDF, Word, Excel, PowerPoint, TXT y CSV… hasta 25 MB
          </span>
        </div>
        {pendingFiles.length > 0 && (
          <div className="flex wrap" style={{ gap: 8, marginTop: 8 }}>
            {pendingFiles.map((p) => (
              <div
                key={p.key}
                className="btn btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {p.kind === 'image' && p.preview ? (
                  <img
                    src={p.preview}
                    alt={p.file.name}
                    style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }}
                  />
                ) : (
                  <span style={{ fontSize: 17, lineHeight: 1 }} title="documento">
                    {attachIcon(p.file)}
                  </span>
                )}
                <span
                  title={p.file.name}
                  style={{ fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {p.file.name}
                </span>
                <span className="muted" style={{ fontSize: 11 }}>
                  {formatSize(p.file.size)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => removePending(p.key)}
                  title="quitar archivo"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="mt-8 text-right">
          <button className="btn btn-primary" onClick={send} disabled={busy || (!body.trim() && pendingFiles.length === 0)}>responder</button>
        </div>
      </Card>
    </>
  );
}
