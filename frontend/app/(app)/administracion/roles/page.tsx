'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { Shell } from '../../shell';
import { PageHeader, Card, Empty, Pill } from '../../../../components/ui';
import { ErrorNotice } from '../../../../components/error-notice';

interface RoleRow {
  id: string;
  name: string;
  permissions: string[];
}
interface Catalog {
  permissions: string[];
  groups: Record<string, string[]>;
  labels: Record<string, string>;
}

const MODULE_LABELS: Record<string, string> = {
  users: 'Usuarios',
  technicians: 'Técnicos',
  customers: 'Clientes',
  contracts: 'Contratos',
  tickets: 'Tickets',
  calendar: 'Agenda',
  dashboard: 'Dashboard',
  notifications: 'Notificaciones',
  audit: 'Auditoría',
};

const ADMIN_MANDATORY = [
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'audit:read',
];

export default function AdminRolesPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  function load() {
    api.get<Catalog>('/admin/permissions').then(setCatalog).catch(() => {});
    api
      .get<RoleRow[]>('/admin/roles')
      .then((rs) => {
        setRoles(rs);
        const d: Record<string, Set<string>> = {};
        rs.forEach((r) => (d[r.id] = new Set(r.permissions)));
        setDraft(d);
      })
      .catch(() => {});
  }
  useEffect(() => {
    load();
  }, []);

  function toggle(roleId: string, perm: string) {
    setDraft((prev) => {
      const cur = new Set(prev[roleId] || []);
      if (cur.has(perm)) cur.delete(perm);
      else cur.add(perm);
      return { ...prev, [roleId]: cur };
    });
  }

  async function save(role: RoleRow) {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const perms = Array.from(draft[role.id] || []);
      // Server enforces the Admin mandatory set; warn on the client too.
      if (role.name === 'Administrador') {
        const missing = ADMIN_MANDATORY.filter((p) => !perms.includes(p));
        if (missing.length) {
          setError(
            'El rol Administrador debe conservar la gestión de usuarios y la auditoría.',
          );
          setBusy(false);
          return;
        }
      }
      await api.patch(`/admin/roles/${role.id}/permissions`, { permissions: perms });
      setMsg(`Permisos de «${role.name}» guardados`);
      setTimeout(() => setMsg(''), 2500);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) return <div className="empty">cargando…</div>;

  return (
    <Shell>
      <PageHeader title="Administración · Roles" subtitle="Editá qué permisos tiene cada rol" />
      {msg && <div className="notice">{msg}</div>}
      {error && <ErrorNotice message={error} onDismiss={() => setError('')} />}

      {roles.length === 0 ? (
        <Empty message="Sin roles" />
      ) : (
        roles.map((role) => (
          <Card key={role.id}>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <h3 className="card-title" style={{ margin: 0 }}>
                {role.name}
                {role.name === 'Administrador' && (
                  <Pill style="pill-blue" >admin</Pill>
                )}
              </h3>
              <button className="btn btn-sm btn-primary" onClick={() => save(role)} disabled={busy}>
                guardar
              </button>
            </div>
            {Object.entries(catalog.groups).map(([mod, perms]) => (
              <div key={mod} style={{ marginBottom: 10 }}>
                <div className="card-meta" style={{ marginBottom: 4, fontWeight: 600 }}>
                  {MODULE_LABELS[mod] || mod}
                </div>
                <div className="flex wrap" style={{ gap: 12 }}>
                  {perms.map((p) => {
                    const checked = draft[role.id]?.has(p) ?? false;
                    return (
                      <label key={p} className="flex" style={{ gap: 5, alignItems: 'center', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(role.id, p)}
                        />
                        <span>{catalog.labels[p] || p}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </Card>
        ))
      )}
    </Shell>
  );
}
