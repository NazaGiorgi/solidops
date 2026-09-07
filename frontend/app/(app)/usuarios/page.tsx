'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { useAuth } from '../../../lib/auth';
import { PageHeader, Card, Empty, Pill } from '../../../components/ui';
import { ErrorNotice } from '../../../components/error-notice';

interface User {
  id: string;
  name: string;
  email: string;
  active: boolean;
  role?: { name?: string };
}

const ROLE_NAMES = ['Administrador', 'Supervisor', 'Coordinador', 'Técnico', 'Consulta'];
type StatusFilter = 'all' | 'active' | 'inactive';

export default function UsersPage() {
  const { user: me, hasPerm } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'Técnico' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<User | null>(null);

  const canWrite = hasPerm('users:update') || hasPerm('users:delete') || hasPerm('users:create');

  function load() {
    api
      .get<User[]>('/users')
      .then(setUsers)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/users', form);
      setForm({ name: '', email: '', password: '', role: 'Técnico' });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Edición (PATCH). Solo envía role: cambiar el rol de un admin NO usa el mismo
  // verbo; aquí permitimos name y role. El email se mantiene NO editable (es la
  // identidad de login; cambiarlo exige análisis de impacto).
  async function saveEdit(u: User, data: { name: string; role: string }) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/users/${u.id}`, data);
      setEditing(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Desactivar / activar (DELETE = desactivar; PATCH active=true = reactivar).
  async function toggleActive(u: User) {
    setBusy(true);
    setError('');
    const confirmed = u.active
      ? window.confirm(
          `¿Desactivar a ${u.name}?\n\nEl usuario no podrá iniciar sesión ni ser asignado a nuevos tickets.\nSu historial y sus registros se conservarán.`,
        )
      : window.confirm(`¿Volver a activar a ${u.name}?`);
    if (!confirmed) { setBusy(false); return; }
    try {
      if (u.active) await api.delete(`/users/${u.id}`);
      else await api.patch(`/users/${u.id}`, { active: true });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const filtered = users.filter((u) => {
    if (statusFilter === 'active' && !u.active) return false;
    if (statusFilter === 'inactive' && u.active) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const isSelf = (u: User) => u.id === me?.id;

  return (
    <Shell>
      <PageHeader title="Usuarios" subtitle="Cuentas y roles del equipo" />
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}

      <Card title="Nuevo usuario">
        <form onSubmit={create} className="grid-4">
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_NAMES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex" style={{ gridColumn: 'span 4' }}>
            <button className="btn btn-primary" disabled={busy}>crear</button>
          </div>
        </form>
      </Card>

      <Card title="Equipo" meta={`${filtered.length} de ${users.length} usuarios`}>
        {/* Filtros */}
        <div className="flex wrap mb-16" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="buscar por nombre o email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex" style={{ gap: 6 }}>
            {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'Todos' : s === 'active' ? 'Activos' : 'Inactivos'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty">cargando…</div>
        ) : filtered.length === 0 ? (
          <Empty message="Sin usuarios para el filtro elegido" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>nombre</th>
                <th>email</th>
                <th>rol</th>
                <th>estado</th>
                {canWrite && <th className="text-right">acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>
                    {u.name}
                    {u.id === me?.id && <span className="card-meta"> (vos)</span>}
                  </td>
                  <td>{u.email}</td>
                  <td>{u.role?.name || '—'}</td>
                  <td>
                    <Pill style={u.active ? 'pill-green' : 'pill-gray'}>
                      {u.active ? '🟢 activo' : '🔴 inactivo'}
                    </Pill>
                  </td>
                  {canWrite && (
                    <td className="text-right">
                      <div className="flex" style={{ justifyContent: 'flex-end', gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => setEditing(u)}>editar</button>
                        <button
                          className={`btn btn-sm ${u.active ? 'btn-ghost' : 'btn-primary'}`}
                          disabled={busy}
                          onClick={() => toggleActive(u)}
                          title={u.active ? 'Desactivar' : 'Reactivar'}
                        >
                          {u.active ? 'desactivar' : 'activar'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <EditUserModal
          user={editing}
          isSelf={isSelf(editing)}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(data) => saveEdit(editing, data)}
        />
      )}
    </Shell>
  );
}

// Modal de edición: nombre y rol editables; email solo lectura (identidad de login).
function EditUserModal({
  user,
  isSelf,
  busy,
  onClose,
  onSave,
}: {
  user: User;
  isSelf: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (d: { name: string; role: string }) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role?.name || 'Técnico');
  const [err, setErr] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('El nombre es obligatorio'); return; }
    onSave({ name: name.trim(), role });
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head flex-between">
          <h3 className="card-title" style={{ margin: 0 }}>Editar usuario</h3>
          <button className="notice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body stack" style={{ gap: 10 }}>
            {err && <ErrorNotice message={err} onDismiss={() => setErr('')} />}
            <div className="field">
              <label>Nombre</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label>Email (no editable — es la identidad de login)</label>
              <input className="input" value={user.email} disabled />
            </div>
            <div className="field">
              <label>Rol</label>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLE_NAMES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            {user.active && (
              <div className="card-meta">El estado (activo/inactivo) se cambia con la acción «desactivar/activar» de la tabla.</div>
            )}
            {isSelf && <div className="card-meta">Estás editando tu propio usuario: no podés desactivarte a vos mismo.</div>}
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
