'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, Empty, Pill } from './ui';
import { ErrorNotice } from './error-notice';

interface MailboxRule {
  id: string;
  mailboxEmail: string;
  senderPattern: string | null;
  subjectPattern: string | null;
  destination: string;
  targetGroupId: string | null;
  targetCustomerStrategy: string | null;
  fixedCustomerId: string | null;
  priority: number;
  active: boolean;
}
interface TicketGroup {
  id: string;
  name: string;
  color?: string | null;
}
interface Mailbox {
  id: string;
  email: string;
  defaultDestination: string;
  shadowMode: boolean;
}
interface UnroutedMail {
  id: string;
  fromEmail: string | null;
  subject: string | null;
  destination: string | null;
  receivedAt: string;
}
interface PreviewResult {
  mailboxEmail: string;
  windowDays: number;
  totalInWindow: number;
  matched: number;
  destination: string;
  matchedSamples: Array<{ from_email: string | null; subject: string | null; receivedAt: string }>;
  context: {
    withDestination: number;
    withoutDestination: number;
    noDestSamples: Array<{ from_email: string | null; subject: string | null; receivedAt: string }>;
  };
}

const EMPTY_RULE = {
  senderPattern: '',
  subjectPattern: '',
  destination: 'ticket',
  targetGroupId: '',
  targetCustomerStrategy: '',
  priority: '100',
};

const DEST_LABEL: Record<string, string> = {
  ticket: 'ticket',
  document: 'documento',
  discard: 'descartar',
};

export function MailboxRulesPanel({ mailboxEmail }: { mailboxEmail: string }) {
  const [rules, setRules] = useState<MailboxRule[]>([]);
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [unrouted, setUnrouted] = useState<UnroutedMail[]>([]);
  const [groups, setGroups] = useState<TicketGroup[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MailboxRule | null>(null);
  const [form, setForm] = useState(EMPTY_RULE);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    if (!mailboxEmail) return;
    api
      .get<MailboxRule[]>(`/mailbox-rules?mailbox=${encodeURIComponent(mailboxEmail)}`)
      .then(setRules)
      .catch((e) => setError((e as Error).message));
    api
      .get<Mailbox[]>(`/mailboxes`)
      .then((all) => setMailbox(all.find((m) => m.email === mailboxEmail) || null))
      .catch(() => {});
    api
      .get<UnroutedMail[]>(`/mailbox-rules/unrouted?mailbox=${encodeURIComponent(mailboxEmail)}`)
      .then(setUnrouted)
      .catch(() => {})
      .finally(() => setLoading(false));
    api
      .get<TicketGroup[]>('/ticket-groups')
      .then(setGroups)
      .catch(() => {});
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailboxEmail]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditing(null);
    setForm(EMPTY_RULE);
    setPreview(null);
    setFormOpen(true);
  }
  function openEdit(r: MailboxRule) {
    setEditing(r);
    setForm({
      senderPattern: r.senderPattern || '',
      subjectPattern: r.subjectPattern || '',
      destination: r.destination,
      targetGroupId: r.targetGroupId || '',
      targetCustomerStrategy: r.targetCustomerStrategy || '',
      priority: String(r.priority),
    });
    setFormOpen(true);
  }

  function createRuleFromRemitente(m: UnroutedMail) {
    setEditing(null);
    setForm({ ...EMPTY_RULE, senderPattern: m.fromEmail || '' });
    setPreview(null);
    setFormOpen(true);
  }

  async function save() {
    setError('');
    try {
      const payload = {
        mailboxEmail,
        senderPattern: form.senderPattern || null,
        subjectPattern: form.subjectPattern || null,
        destination: form.destination,
        targetGroupId: form.destination === 'ticket' ? form.targetGroupId || null : null,
        targetCustomerStrategy: form.targetCustomerStrategy || null,
        priority: parseInt(form.priority || '100', 10),
      };
      if (editing) {
        await api.patch(`/mailbox-rules/${editing.id}`, payload);
      } else {
        await api.post('/mailbox-rules', payload);
      }
      setNotice('Regla guardada');
      setTimeout(() => setNotice(''), 2500);
      setFormOpen(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runPreview() {
    setError('');
    setPreviewing(true);
    try {
      const res = await api.post<PreviewResult>(
        `/mailbox-rules/preview?mailbox=${encodeURIComponent(mailboxEmail)}`,
        {
          senderPattern: form.senderPattern || undefined,
          subjectPattern: form.subjectPattern || undefined,
          destination: form.destination,
        },
      );
      setPreview(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  async function saveCatchAll(dest: string) {
    if (!mailbox) return;
    setError('');
    try {
      await api.patch(`/mailboxes/${mailbox.id}`, { defaultDestination: dest });
      setNotice('Destino por defecto actualizado');
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    await api.delete(`/mailbox-rules/${id}`);
    load();
  }
  async function toggleActive(r: MailboxRule) {
    await api.patch(`/mailbox-rules/${r.id}`, { active: !r.active });
    load();
  }

  if (loading) return <div className="empty">cargando…</div>;

  return (
    <Card title="Reglas de enrutamiento (cajones)" meta={`casilla: ${mailboxEmail}`}>
      {notice && <div className="notice">{notice}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}

      <div className="flex wrap" style={{ gap: 12, marginBottom: 16, alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Destino por defecto (catch-all)</label>
          <select
            className="select"
            value={mailbox?.defaultDestination || ''}
            onChange={(e) => saveCatchAll(e.target.value)}
          >
            <option value="">ticket (default)</option>
            <option value="ticket">ticket</option>
            <option value="document">documento</option>
            <option value="discard">descartar</option>
          </select>
          <span className="card-meta" style={{ display: 'block' }}>
            Lo que no matchea ninguna regla específica
          </span>
        </div>
        <div style={{ marginBottom: 6 }}>
          <button className="btn btn-primary" onClick={openNew}>+ nueva regla</button>
        </div>
      </div>

      {formOpen && (
        <div className="card mb-16" style={{ background: 'var(--bg-subtle)' }}>
          <h4 className="card-title">{editing ? 'Editar regla' : 'Nueva regla'}</h4>
          <div className="grid-3">
            <div className="field">
              <label>Remitente (patrón)</label>
              <input className="input" value={form.senderPattern} onChange={(e) => set('senderPattern', e.target.value)} placeholder="o usa 'crear regla para este remitente'" />
            </div>
            <div className="field">
              <label>Asunto (patrón)</label>
              <input className="input" value={form.subjectPattern} onChange={(e) => set('subjectPattern', e.target.value)} placeholder="ej. backup" />
            </div>
            <div className="field">
              <label>Destino</label>
              <select className="select" value={form.destination} onChange={(e) => set('destination', e.target.value)}>
                <option value="ticket">ticket</option>
                <option value="document">documento</option>
                <option value="discard">descartar</option>
              </select>
            </div>
            {form.destination === 'ticket' && (
              <div className="field">
                <label>Box destino (opcional)</label>
                <select className="select" value={form.targetGroupId} onChange={(e) => set('targetGroupId', e.target.value)}>
                  <option value="">ticket (default)</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <span className="card-meta" style={{ display: 'block' }}>
                  El ticket creado cae en este box en vez del default
                </span>
              </div>
            )}
            <div className="field">
              <label>Estrategia de cliente</label>
              <select className="select" value={form.targetCustomerStrategy} onChange={(e) => set('targetCustomerStrategy', e.target.value)}>
                <option value="">sin estrategia</option>
                <option value="auto_match_asset">auto-match por activo</option>
                <option value="fixed_customer_id">cliente fijo</option>
              </select>
            </div>
            <div className="field">
              <label>Prioridad (menor = primero)</label>
              <input className="input" value={form.priority} onChange={(e) => set('priority', e.target.value)} />
            </div>
          </div>
          <div className="flex mt-8">
            <button className="btn btn-primary" onClick={save}>guardar</button>
            <button className="btn btn-ghost" onClick={() => setFormOpen(false)}>cancelar</button>
            <button className="btn" onClick={runPreview} disabled={previewing}>
              {previewing ? 'probando…' : 'probar regla'}
            </button>
          </div>

          {preview && (
            <div className="card mt-16" style={{ background: 'var(--surface)' }}>
              <div className="flex wrap" style={{ gap: 12 }}>
                <Pill style="pill-blue">{preview.matched} coincidencias</Pill>
                <span className="card-meta">
                  de {preview.totalInWindow} correos (últimos {preview.windowDays} días) → {DEST_LABEL[preview.destination] || preview.destination}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Correos actuales sin destino: {preview.context.withoutDestination} · con destino: {preview.context.withDestination}
              </div>
              {preview.matchedSamples.length > 0 && (
                <div className="stack mt-8">
                  {preview.matchedSamples.map((s, i) => (
                    <div key={i} className="msg" style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 500 }}>{s.subject || '(sin asunto)'}</div>
                      <div className="card-meta">{s.from_email}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <h4 className="card-title" style={{ marginTop: 8 }}>Reglas activas</h4>
      {rules.length === 0 ? (
        <Empty message="Sin reglas para esta casilla todavía" />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>prioridad</th>
              <th>remitente</th>
              <th>asunto</th>
              <th>destino</th>
              <th>estado</th>
              <th className="text-right">acciones</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.priority}</td>
                <td>{r.senderPattern || '—'}</td>
                <td>{r.subjectPattern || '—'}</td>
                <td>
                  <Pill style={r.destination === 'discard' ? 'pill-red' : r.destination === 'document' ? 'pill-amber' : 'pill-blue'}>
                    {DEST_LABEL[r.destination] || r.destination}
                  </Pill>
                  {r.destination === 'ticket' && r.targetGroupId && (
                    <span className="pill pill-gray" style={{ marginLeft: 4 }}>
                      → {groups.find((g) => g.id === r.targetGroupId)?.name || 'box'}
                    </span>
                  )}
                </td>
                <td><Pill style={r.active ? 'pill-green' : 'pill-gray'}>{r.active ? 'activa' : 'inactiva'}</Pill></td>
                <td className="text-right">
                  <div className="flex wrap" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn btn-sm" onClick={() => toggleActive(r)}>{r.active ? 'desactivar' : 'activar'}</button>
                    <button className="btn btn-sm" onClick={() => openEdit(r)}>editar</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>borrar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="card-title" style={{ marginTop: 16 }}>Correos recientes sin regla</h4>
      {unrouted.length === 0 ? (
        <Empty message="Ningún correo sin regla reciente" />
      ) : (
        <div className="stack">
          {unrouted.map((m) => (
            <div className="msg" key={m.id}>
              <div className="flex-between">
                <div>
                  <div style={{ fontWeight: 500 }}>{m.subject || '(sin asunto)'}</div>
                  <div className="card-meta">{m.fromEmail} · {new Date(m.receivedAt).toLocaleString('es-AR')}</div>
                </div>
                <button className="btn btn-sm" onClick={() => createRuleFromRemitente(m)}>
                  crear regla para este remitente
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
