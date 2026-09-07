'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty } from '../../../components/ui';

interface Orphan {
  id: string;
  name: string;
  email: string | null;
  portalEnabled: boolean;
  emailVerifiedAt: string | null;
  createdAt: string;
}

interface CustomerOption {
  id: string;
  name: string;
  active: boolean;
}

// Bandeja de staff: usuarios registrados en el portal sin empresa asignada.
// Se asocia/rechaza manualmente (el vínculo automático por dominio ya corrió al
// verificar el email).
export default function PortalAccountsPage() {
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  function load() {
    Promise.all([
      api.get<Orphan[]>('/portal-accounts/orphans'),
      api.get<CustomerOption[]>('/customers'),
    ])
      .then(([o, c]) => {
        setOrphans(o || []);
        setCustomers(c || []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
  }, []);

  async function assign(id: string) {
    const customerId = selected[id];
    if (!customerId) return;
    setAssigning(id);
    setError('');
    try {
      await api.post(`/portal-accounts/orphans/${id}/assign`, { customerId });
      setOrphans((prev) => prev.filter((o) => o.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(null);
    }
  }

  async function reject(id: string) {
    if (!window.confirm('¿Deshabilitar el acceso al portal de esta cuenta?')) return;
    setAssigning(id);
    setError('');
    try {
      await api.post(`/portal-accounts/orphans/${id}/reject`);
      setOrphans((prev) => prev.filter((o) => o.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(null);
    }
  }

  return (
    <Shell>
      <PageHeader title="Cuentas del portal sin empresa" />
      <Card>
        <div className="notice" style={{ marginBottom: 16 }}>
          Usuarios que se registraron en el portal de clientes y no pudieron vincularse
          automáticamente (dominio personal o pendiente). Asigná la empresa correcta o rechazá la
          cuenta para deshabilitar su acceso.
        </div>
        {error && <div className="notice notice-error">{error}</div>}
        {loading ? (
          <Empty message="Cargando…" />
        ) : orphans.length === 0 ? (
          <Empty message="No hay cuentas sin empresa pendientes." />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Email</th>
                <th>Verificado</th>
                <th>Registro</th>
                <th>Asignar empresa</th>
                <th /> 
              </tr>
            </thead>
            <tbody>
              {orphans.map((o) => (
                <tr key={o.id}>
                  <td>{o.name}</td>
                  <td>{o.email}</td>
                  <td>
                    {o.emailVerifiedAt ? (
                      <span className="pill pill-green">verificado</span>
                    ) : (
                      <span className="pill pill-gray">pendiente</span>
                    )}
                  </td>
                  <td className="muted">{new Date(o.createdAt).toLocaleString('es-AR')}</td>
                  <td>
                    <select
                      className="select"
                      style={{ minWidth: 200 }}
                      value={selected[o.id] || ''}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [o.id]: e.target.value }))}
                    >
                      <option value="">— elegir empresa —</option>
                      {customers
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!selected[o.id] || assigning === o.id}
                      onClick={() => assign(o.id)}
                    >
                      {assigning === o.id ? '…' : 'Asignar'}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={assigning === o.id}
                      onClick={() => reject(o.id)}
                    >
                      Rechazar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      </Shell>
  );
}