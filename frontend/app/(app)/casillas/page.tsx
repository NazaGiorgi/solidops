'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { ErrorNotice } from '../../../components/error-notice';
import { MailboxRulesPanel } from '../../../components/mailbox-rules-panel';

interface Mailbox {
  id: string;
  email: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string; // masked
  imapSsl: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpSsl: boolean;
  smtpSecurity: string | null;
  keepOnServer: boolean;
  active: boolean;
  shadowMode: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
}

const EMPTY_FORM = {
  email: '',
  imapHost: '',
  imapPort: '993',
  imapUser: '',
  imapPassword: '',
  imapSsl: true,
  shadowMode: true,
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpPassword: '',
  smtpSecurity: 'starttls',
};

const MASK = '••••••••';

function statusPill(m: Mailbox) {
  if (!m.active) return <Pill style="pill-gray">inactiva</Pill>;
  if (m.lastError) return <Pill style="pill-red">error</Pill>;
  if (m.shadowMode) return <Pill style="pill-amber">modo sombra</Pill>;
  return <Pill style="pill-green">activa</Pill>;
}

export default function MailboxesPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [testSmtpResult, setTestSmtpResult] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedEmail, setSelectedEmail] = useState('');

  function load() {
    api
      .get<Mailbox[]>('/mailboxes')
      .then((list) => {
        setMailboxes(list);
        if (!selectedEmail && list.length) setSelectedEmail(list[0].email);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setTestResult('');
    setTestSmtpResult('');
    setFormOpen(true);
  }
  function openEdit(m: Mailbox) {
    setEditing(m);
    setForm({
      email: m.email,
      imapHost: m.imapHost,
      imapPort: String(m.imapPort),
      imapUser: m.imapUser,
      imapPassword: MASK, // never the real value; only send if changed
      imapSsl: m.imapSsl,
      shadowMode: m.shadowMode,
      smtpHost: m.smtpHost || '',
      smtpPort: String(m.smtpPort || 587),
      smtpUser: m.smtpUser || '',
      smtpPassword: MASK,
      smtpSecurity: m.smtpSecurity || 'starttls',
    });
    setTestResult('');
    setFormOpen(true);
  }

  async function testConnection() {
    setTesting(true);
    setTestResult('');
    setError('');
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/mailboxes/test-connection', {
        imapHost: form.imapHost,
        imapPort: parseInt(form.imapPort || '993', 10),
        imapUser: form.imapUser,
        imapPassword:
          form.imapPassword === MASK ? 'x' : form.imapPassword,
        imapSsl: form.imapSsl,
      });
      setTestResult(res.ok ? `✓ ${res.message}` : `✗ ${res.message}`);
    } catch (e) {
      setTestResult(`✗ ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  async function testSmtp() {
    setTestingSmtp(true);
    setTestSmtpResult('');
    setError('');
    if (!form.smtpHost || !form.smtpUser) {
      setTestSmtpResult('✗ completá servidor y usuario SMTP');
      setTestingSmtp(false);
      return;
    }
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/mailboxes/test-smtp', {
        smtpHost: form.smtpHost,
        smtpPort: parseInt(form.smtpPort || '587', 10),
        smtpUser: form.smtpUser,
        smtpPassword: form.smtpPassword === MASK ? 'x' : form.smtpPassword,
        smtpSecurity: form.smtpSecurity,
      });
      setTestSmtpResult(res.ok ? `✓ ${res.message}` : `✗ ${res.message}`);
    } catch (e) {
      setTestSmtpResult(`✗ ${(e as Error).message}`);
    } finally {
      setTestingSmtp(false);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      // Client-side validation so the user gets immediate feedback.
      if (!form.email.trim()) throw new Error('El email es obligatorio');
      if (!form.imapHost.trim()) throw new Error('El servidor IMAP es obligatorio');
      if (!form.imapUser.trim()) throw new Error('El usuario IMAP es obligatorio');
      if (!editing && (!form.imapPassword || form.imapPassword === MASK)) {
        throw new Error('La contraseña IMAP es obligatoria al crear una casilla');
      }

      const payload = {
        email: form.email,
        imapHost: form.imapHost,
        imapPort: parseInt(form.imapPort || '993', 10),
        imapUser: form.imapUser,
        imapSsl: form.imapSsl,
        shadowMode: form.shadowMode,
        keepOnServer: true,
        ...(form.imapPassword && form.imapPassword !== MASK
          ? { imapPassword: form.imapPassword }
          : {}),
        // SMTP — optional; only sent when the host is provided.
        ...(form.smtpHost.trim()
          ? {
              smtpHost: form.smtpHost,
              smtpPort: parseInt(form.smtpPort || '587', 10),
              smtpUser: form.smtpUser,
              smtpSecurity: form.smtpSecurity,
              ...(form.smtpPassword && form.smtpPassword !== MASK
                ? { smtpPassword: form.smtpPassword }
                : {}),
            }
          : {}),
      };
      if (editing) {
        await api.patch(`/mailboxes/${editing.id}`, payload);
      } else {
        await api.post('/mailboxes', payload);
      }
      setNotice('Guardado');
      setTimeout(() => setNotice(''), 2500);
      setFormOpen(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleShadow(m: Mailbox) {
    await api.patch(`/mailboxes/${m.id}`, { shadowMode: !m.shadowMode });
    load();
  }
  async function deactivate(m: Mailbox) {
    await api.delete(`/mailboxes/${m.id}`);
    load();
  }

  return (
    <Shell>
      <PageHeader
        title="Casillas de correo"
        subtitle="Canales de entrada de email"
        action={
          <button className="btn btn-primary" onClick={openNew}>
            + agregar casilla
          </button>
        }
      />
      {notice && <div className="notice">{notice}</div>}
      {error && !formOpen && <ErrorNotice message={error} onDismiss={() => setError('')} />}

      {formOpen && (
        <Card>
          <h3 className="card-title">{editing ? 'Editar casilla' : 'Nueva casilla'}</h3>
          {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}
          <div className="grid-3">
            <div className="field">
              <label>Email</label>
              <input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="field">
              <label>Modo sombra (solo lectura)</label>
              <select className="select" value={String(form.shadowMode)} onChange={(e) => set('shadowMode', e.target.value === 'true')}>
                <option value="true">sí</option>
                <option value="false">no</option>
              </select>
            </div>
          </div>

          {/* ===== Sección: Entrada (IMAP) ===== */}
          <div className="card mb-16" style={{ background: 'var(--bg-subtle)', padding: 14 }}>
            <h4 className="card-title" style={{ marginTop: 0 }}>Entrada (IMAP)</h4>
            <div className="grid-3">
              <div className="field">
                <label>Servidor IMAP</label>
                <input className="input" value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} placeholder="imap.example.com" />
              </div>
              <div className="field">
                <label>Puerto</label>
                <input className="input" value={form.imapPort} onChange={(e) => set('imapPort', e.target.value)} />
              </div>
              <div className="field">
                <label>Usuario IMAP</label>
                <input className="input" value={form.imapUser} onChange={(e) => set('imapUser', e.target.value)} />
              </div>
              <div className="field">
                <label>Contraseña</label>
                <input className="input" type="password" value={form.imapPassword} onChange={(e) => set('imapPassword', e.target.value)} placeholder={editing ? 'dejar vacío para no cambiar' : ''} />
              </div>
              <div className="field">
                <label>SSL</label>
                <select className="select" value={String(form.imapSsl)} onChange={(e) => set('imapSsl', e.target.value === 'true')}>
                  <option value="true">sí</option>
                  <option value="false">no</option>
                </select>
              </div>
              <div className="field" style={{ alignSelf: 'flex-end' }}>
                <button className="btn" onClick={testConnection} disabled={testing}>
                  {testing ? 'probando…' : 'Probar IMAP'}
                </button>
                {testResult && (
                  <div style={{ marginTop: 6 }}>
                    <span className={`card-meta ${testResult.startsWith('✓') ? 'result-ok' : 'result-bad'}`}>
                      {testResult}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ===== Sección: Salida (SMTP) ===== */}
          <div className="card mb-16" style={{ borderLeft: '3px solid var(--blue)', padding: 14 }}>
            <h4 className="card-title" style={{ marginTop: 0 }}>Salida (SMTP)</h4>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Opcional: solo si esta casilla va a enviar correo (respuestas, notificaciones).
            </div>
            <div className="grid-3">
              <div className="field">
                <label>Servidor SMTP</label>
                <input className="input" value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.example.com" />
              </div>
              <div className="field">
                <label>Puerto</label>
                <input className="input" value={form.smtpPort} onChange={(e) => set('smtpPort', e.target.value)} />
              </div>
              <div className="field">
                <label>Usuario SMTP</label>
                <input className="input" value={form.smtpUser} onChange={(e) => set('smtpUser', e.target.value)} />
              </div>
              <div className="field">
                <label>Contraseña SMTP</label>
                <input className="input" type="password" value={form.smtpPassword} onChange={(e) => set('smtpPassword', e.target.value)} placeholder={editing ? 'dejar vacío para no cambiar' : ''} />
              </div>
              <div className="field">
                <label>Tipo de seguridad</label>
                <select className="select" value={form.smtpSecurity} onChange={(e) => set('smtpSecurity', e.target.value)}>
                  <option value="starttls">STARTTLS (puerto 587)</option>
                  <option value="implicit">SSL/TLS implícito (puerto 465)</option>
                </select>
              </div>
              <div className="field" style={{ alignSelf: 'flex-end' }}>
                <button className="btn" onClick={testSmtp} disabled={testingSmtp}>
                  {testingSmtp ? 'probando…' : 'Probar SMTP'}
                </button>
                {testSmtpResult && (
                  <div style={{ marginTop: 6 }}>
                    <span className={`card-meta ${testSmtpResult.startsWith('✓') ? 'result-ok' : 'result-bad'}`}>
                      {testSmtpResult}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex mt-8">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'guardando…' : 'guardar'}
            </button>
            <button className="btn btn-ghost" onClick={() => setFormOpen(false)}>
              cancelar
            </button>
          </div>
        </Card>
      )}

      <Card title="Casillas conectadas">
        {loading ? (
          <div className="empty">cargando…</div>
        ) : mailboxes.length === 0 ? (
          <Empty message="Sin casillas conectadas todavía" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>email</th>
                <th>estado</th>
                <th>última revisión</th>
                <th>error</th>
                <th className="text-right">acciones</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 500 }}>{m.email}</td>
                  <td>{statusPill(m)}</td>
                  <td className="card-meta">{m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString('es-AR') : '—'}</td>
                  <td className="card-meta">{m.lastError || '—'}</td>
                  <td className="text-right">
                    <div className="flex wrap" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn-sm" onClick={() => toggleShadow(m)}>
                        {m.shadowMode ? 'salir de sombra' : 'poner en sombra'}
                      </button>
                      <button className="btn btn-sm" onClick={() => openEdit(m)}>editar</button>
                      {m.active && (
                        <button className="btn btn-sm btn-danger" onClick={() => deactivate(m)}>desactivar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {mailboxes.length > 0 && (
        <div className="mt-16">
          <div className="mb-8 flex">
            <label className="muted" style={{ marginRight: 8 }}>casilla:</label>
            <select className="select" style={{ maxWidth: 280 }} value={selectedEmail} onChange={(e) => setSelectedEmail(e.target.value)}>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.email}>{m.email}</option>
              ))}
            </select>
          </div>
          <MailboxRulesPanel mailboxEmail={selectedEmail} />
        </div>
      )}
    </Shell>
  );
}
