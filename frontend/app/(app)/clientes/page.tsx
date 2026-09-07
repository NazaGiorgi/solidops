'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { Shell } from '../shell';
import { PageHeader, Card, Empty } from '../../../components/ui';

interface Customer {
  id: string;
  name: string;
  active: boolean;
  contactCount?: number;
  contractCount?: number;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Búsqueda en el servidor por nombre de empresa, email de contacto o dominio
  // (customer_domains). Sin término devuelve todos los clientes.
  function load() {
    setLoading(true);
    const q = debouncedQuery;
    api
      .get<Customer[]>(`/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`)
      .then(setCustomers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  async function create() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.post('/customers', { name: newName });
      setNewName('');
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <PageHeader
        title="Clientes"
        subtitle={`${customers.length} ${customers.length === 1 ? 'cliente' : 'clientes'}${
          debouncedQuery ? ` para "${debouncedQuery}"` : ''
        }`}
      />
      <Card>
        <div className="flex mb-16">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="nombre del cliente nuevo…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            + agregar
          </button>
        </div>
        <div className="flex mb-16">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            placeholder="buscar por nombre, email o dominio…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Buscar por nombre, email o dominio"
          />
          {query && (
            <button className="btn" onClick={() => setQuery('')}>limpiar</button>
          )}
        </div>
        {loading ? (
          <div className="empty">cargando…</div>
        ) : customers.length === 0 ? (
          debouncedQuery ? (
            <Empty message={`Sin resultados para "${debouncedQuery}"`} />
          ) : (
            <Empty message="Sin clientes todavía" />
          )
        ) : (
          <div className="grid-auto">
            {customers.map((c) => (
              <Link key={c.id} href={`/clientes/${c.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card">
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                  <div className="card-meta">
                    {c.contactCount ?? 0} contactos · {c.contractCount ?? 0} contratos
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
