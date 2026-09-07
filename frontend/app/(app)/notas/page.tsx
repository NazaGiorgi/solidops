'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { useAuth } from '../../../lib/auth';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { ErrorNotice } from '../../../components/error-notice';
import { MarkdownPreview } from '../../../components/markdown-preview';
import { timeAgo } from '../../../lib/helpers';

interface Note {
  id: string;
  title: string;
  body: string;
  boxId: string | null;
  customerId: string | null;
  ticketId: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  box?: { id: string; name: string } | null;
  customer?: { id: string; name: string } | null;
  ticket?: { id: string; title: string } | null;
  createdByUser?: { id: string; name: string } | null;
  updatedByUser?: { id: string; name: string } | null;
  tagLinks?: Array<{ tag: { id: string; name: string } }>;
}
interface Box { id: string; name: string; orderIndex: number; noteCount: number }
interface Tag { id: string; name: string; noteCount: number }
interface CustomerLite { id: string; name: string }
interface TicketLite { id: string; title: string }

export default function NotasPage() {
  const { hasPerm } = useAuth();
  const [boxId, setBoxId] = useState<string>(''); // '' = todos
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<Note[]>([]);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState(false);
  const [searchInput, setSearchInput] = useState('');

  const canWrite = hasPerm('notes:write');

  function loadNotes() {
    const query: string[] = [];
    if (boxId) query.push(`boxId=${boxId}`);
    if (selectedTags.length) query.push(`tags=${encodeURIComponent(selectedTags.join(','))}`);
    if (search) query.push(`search=${encodeURIComponent(search)}`);
    const qs = query.length ? `?${query.join('&')}` : '';
    api.get<Note[]>(`/notes${qs}`).then(setNotes).catch((e) => setError((e as Error).message));
  }

  function loadMeta() {
    api.get<Box[]>('/notes/boxes').then(setBoxes).catch(() => {});
    api.get<Tag[]>('/notes/tags').then(setTags).catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    loadNotes();
    loadMeta();
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxId, selectedTags, search]);

  function doSearch() {
    setSearch(searchInput.trim());
  }

  function toggleTag(name: string) {
    setSelectedTags((cur) => (cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]));
  }

  const boxCount = useMemo(() => {
    const m = new Map<string, number>();
    boxes.forEach((b) => m.set(b.id, b.noteCount));
    return m;
  }, [boxes]);

  if (!hasPerm('notes:read')) return <Shell><div className="empty">No tenés permiso para ver notas</div></Shell>;

  return (
    <Shell>
      <PageHeader
        title="Notas"
        subtitle="Información técnica compartida del equipo"
        action={
          canWrite && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              + nueva nota
            </button>
          )
        }
      />
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}

      <Card>
        {/* Barra superior: buscador + filtros */}
        <div className="flex wrap mb-16" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="buscar en notas (título y contenido)…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          />
          <button className="btn btn-sm" onClick={doSearch}>buscar</button>
          {search && (
            <button className="btn btn-sm btn-ghost" onClick={() => { setSearch(''); setSearchInput(''); }}>
              limpiar ✕
            </button>
          )}
          <div className="flex wrap" style={{ gap: 6 }}>
            {tags.length === 0 ? (
              <span className="card-meta">sin etiquetas aún</span>
            ) : (
              tags.map((t) => (
                <Pill
                  key={t.id}
                  style={selectedTags.includes(t.name) ? 'pill-blue' : 'pill-gray'}
                >
                  <button
                    className="link"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: selectedTags.includes(t.name) ? 'white' : 'inherit' }}
                    onClick={() => toggleTag(t.name)}
                  >
                    {t.name} · {t.noteCount}
                  </button>
                </Pill>
              ))
            )}
          </div>
        </div>

        {/* Layout: boxes a la izquierda, notas a la derecha */}
        <div className="flex" style={{ gap: 16, alignItems: 'flex-start' }}>
          {/* Panel de boxes */}
          <div style={{ minWidth: 200, borderRight: '1px solid var(--border)', paddingRight: 12 }}>
            <div className="stack">
              <button
                className={`btn btn-sm ${boxId === '' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => setBoxId('')}
              >
                📒 Todas ({notes.length})
              </button>
              {boxes.map((b) => (
                <button
                  key={b.id}
                  className={`btn btn-sm ${boxId === b.id ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ justifyContent: 'flex-start' }}
                  onClick={() => setBoxId(b.id)}
                >
                  📁 {b.name} ({b.noteCount})
                </button>
              ))}
              {canWrite && <BoxCreator onCreated={() => { loadMeta(); }} />}
            </div>
          </div>

          {/* Lista de notas */}
          <div className="stack" style={{ flex: 1 }}>
            {loading ? (
              <div className="empty">cargando…</div>
            ) : notes.length === 0 ? (
              <Empty message="No hay notas para los filtros elegidos" />
            ) : (
              notes.map((n) => (
                <div key={n.id} className="card" style={{ padding: 14, width: '100%' }}>
                  <div className="flex-between">
                    <strong>{n.title}</strong>
                    <div className="flex" style={{ gap: 6 }}>
                      {canWrite && (
                        <button className="btn btn-sm" onClick={() => setEditing(n)}>editar</button>
                      )}
                    </div>
                  </div>
                  <div className="card-meta" style={{ marginTop: 3 }}>
                    {n.box?.name && <span>📁 {n.box.name} · </span>}
                    {n.customer && (
                      <span>
                        <Link href={`/clientes/${n.customer.id}`} style={{ color: '#2563eb' }}>👤 {n.customer.name}</Link>
                      </span>
                    )}
                    {n.ticket && (
                      <span>
                        {' · '}
                        <Link href={`/tickets/${n.ticket.id}`} style={{ color: '#2563eb' }}>🎫 {n.ticket.title.slice(0, 40)}</Link>
                      </span>
                    )}
                  </div>
                  <div className="card-meta" style={{ marginTop: 6 }}>
                    <div>📝 Creada por: {n.createdByUser?.name || 'Creador no registrado'}</div>
                    <div style={{ marginTop: 2 }}>
                      ✏️ Última edición: {n.updatedByUser?.name || (n.createdByUser?.name ?? 'Creador no registrado')} · {timeAgo(n.updatedAt)}
                    </div>
                  </div>
                  {n.tagLinks && n.tagLinks.length > 0 && (
                    <div className="flex wrap" style={{ gap: 4, marginTop: 6 }}>
                      {n.tagLinks.map((tl) => (
                        <Pill key={tl.tag.id} style="pill-gray">{tl.tag.name}</Pill>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 8, maxHeight: 160, overflow: 'auto' }}>
                    <MarkdownPreview text={n.body} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Card>

      {(creating || editing) && (
        <NoteEditor
          note={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); loadNotes(); loadMeta(); }}
        />
      )}
    </Shell>
  );
}

// Crea un box nuevo desde el panel lateral.
function BoxCreator({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try { await api.post('/notes/boxes', { name: name.trim(), orderIndex: 999 }); setName(''); onCreated(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <div className="flex" style={{ gap: 4 }}>
        <input className="input" style={{ flex: 1 }} placeholder="nuevo box…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <button className="btn btn-sm" onClick={submit} disabled={busy}>+</button>
      </div>
      {err && <div className="card-meta" style={{ color: 'var(--danger, #dc2626)' }}>{err}</div>}
    </div>
  );
}

// Editor de nota: título, contenido (markdown), box, etiquetas, vínculo opcional.
function NoteEditor({ note, onClose, onSaved }: { note: Note | null; onClose: () => void; onSaved: () => void }) {
  const { hasPerm } = useAuth();
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [boxId, setBoxId] = useState<string>(note?.boxId ?? '');
  const [tagsInput, setTagsInput] = useState((note?.tagLinks || []).map((tl) => tl.tag.name).join(', '));
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(note?.customer ?? null);
  const [ticket, setTicket] = useState<{ id: string; title: string } | null>(note?.ticket ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [customerQ, setCustomerQ] = useState(note?.customer?.name ?? '');
  const [ticketQ, setTicketQ] = useState(note?.ticket?.title ?? '');
  const [showCustomer, setShowCustomer] = useState(false);
  const [showTicket, setShowTicket] = useState(false);

  useEffect(() => {
    api.get<Box[]>('/notes/boxes').then(setBoxes).catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setErr('El título es obligatorio'); return; }
    setBusy(true); setErr('');
    const tags = tagsInput.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      title: title.trim(),
      body,
      boxId: boxId || null,
      customerId: customer?.id ?? null,
      ticketId: ticket?.id ?? null,
      tags,
    };
    try {
      if (note) await api.patch(`/notes/${note.id}`, payload);
      else await api.post('/notes', payload);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head flex-between">
          <h3 className="card-title" style={{ margin: 0 }}>{note ? 'Editar nota' : 'Nueva nota'}</h3>
          <button className="notice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body stack" style={{ gap: 10 }}>
            {err && <ErrorNotice message={err} onDismiss={() => setErr('')} />}
            <input className="input" placeholder="Título *" value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea
              className="textarea"
              style={{ minHeight: 200 }}
              placeholder="Contenido (Markdown soportado: **negrita**, *cursiva*, listas, `código`)…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex wrap" style={{ gap: 10 }}>
              <label className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                Box:
                <select className="select" value={boxId} onChange={(e) => setBoxId(e.target.value)}>
                  <option value="">(sin box)</option>
                  {boxes.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </label>
              <label className="muted" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                Etiquetas (separadas por coma):
                <input className="input" style={{ flex: 1 }} placeholder="red, router, urgente" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} />
              </label>
            </div>

            {/* Vínculo opcional a cliente */}
            <div className="muted" style={{ fontSize: 13 }}>
              <div>Vínculo opcional a cliente:</div>
              <div className="flex" style={{ gap: 6, marginTop: 4, position: 'relative' }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="buscar cliente…"
                  value={customerQ}
                  onChange={(e) => { setCustomerQ(e.target.value); setShowCustomer(true); }}
                  onFocus={() => setShowCustomer(true)}
                  onBlur={() => setTimeout(() => setShowCustomer(false), 200)}
                />
                {customer && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCustomer(null); setCustomerQ(''); }}>
                    quitar
                  </button>
                )}
                {showCustomer && customerQ.trim() && (
                  <CustomerAutocomplete q={customerQ} onPick={(c) => { setCustomer(c); setCustomerQ(c.name); setShowCustomer(false); }} />
                )}
              </div>
            </div>

            {/* Vínculo opcional a ticket */}
            <div className="muted" style={{ fontSize: 13 }}>
              <div>Vínculo opcional a ticket:</div>
              <div className="flex" style={{ gap: 6, marginTop: 4, position: 'relative' }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="buscar ticket…"
                  value={ticketQ}
                  onChange={(e) => { setTicketQ(e.target.value); setShowTicket(true); }}
                  onFocus={() => setShowTicket(true)}
                  onBlur={() => setTimeout(() => setShowTicket(false), 200)}
                />
                {ticket && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setTicket(null); setTicketQ(''); }}>
                    quitar
                  </button>
                )}
                {showTicket && ticketQ.trim() && (
                  <TicketAutocomplete q={ticketQ} onPick={(t) => { setTicket(t); setTicketQ(t.title); setShowTicket(false); }} />
                )}
              </div>
            </div>
          </div>
          <div className="modal-foot flex justify-end" style={{ gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>cancelar</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'guardando…' : 'guardar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CustomerAutocomplete({ q, onPick }: { q: string; onPick: (c: CustomerLite) => void }) {
  const [rows, setRows] = useState<CustomerLite[]>([]);
  useEffect(() => {
    api.get<CustomerLite[]>(`/customers?search=${encodeURIComponent(q)}`).then(setRows).catch(() => setRows([]));
  }, [q]);
  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid var(--border)', borderRadius: 6, zIndex: 20, maxHeight: 200, overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
      {rows.length === 0 ? (
        <div className="card-meta" style={{ padding: 8 }}>sin coincidencias</div>
      ) : (
        rows.slice(0, 8).map((c) => (
          <button key={c.id} type="button" className="link" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer' }} onMouseDown={() => onPick(c)}>
            {c.name}
          </button>
        ))
      )}
    </div>
  );
}

function TicketAutocomplete({ q, onPick }: { q: string; onPick: (t: TicketLite) => void }) {
  const [rows, setRows] = useState<TicketLite[]>([]);
  useEffect(() => {
    api.get<{ items: TicketLite[] }>(`/tickets?search=${encodeURIComponent(q)}&take=8`).then((r) => {
      setRows(Array.isArray(r) ? r : r?.items || []);
    }).catch(() => setRows([]));
  }, [q]);
  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid var(--border)', borderRadius: 6, zIndex: 20, maxHeight: 200, overflow: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.08)' }}>
      {rows.length === 0 ? (
        <div className="card-meta" style={{ padding: 8 }}>sin coincidencias</div>
      ) : (
        rows.slice(0, 8).map((t) => (
          <button key={t.id} type="button" className="link" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer' }} onMouseDown={() => onPick(t)}>
            {t.title.slice(0, 60)}
          </button>
        ))
      )}
    </div>
  );
}
