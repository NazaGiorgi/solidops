'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePortalAuth } from '../../../lib/portal-auth';
import { ErrorNotice } from '../../../components/error-notice';
import {
  portalQuoteApi,
  PortalQuote,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_PILLS,
  money,
  fmtDateTime,
} from '../../../lib/workshop';

export default function PortalQuotesPage() {
  const { user, loading } = usePortalAuth();
  const [quotes, setQuotes] = useState<PortalQuote[]>([]);
  const [loadingQuotes, setLoadingQuotes] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function load() {
    if (!user) return;
    portalQuoteApi
      .list()
      .then(setQuotes)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoadingQuotes(false));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function respond(id: string, decision: 'aprobado' | 'rechazado') {
    setError('');
    setNotice('');
    try {
      await portalQuoteApi.respond(id, decision);
      setNotice(decision === 'aprobado' ? 'Presupuesto aprobado. En breve comenzamos la reparación.' : 'Presupuesto rechazado.');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) return <div className="empty">cargando…</div>;
  if (!user) {
    return (
      <div className="empty">
        <Link href="/portal/login" className="link">ir al login del portal</Link>
      </div>
    );
  }

  return (
    <>
      <div className="portal-main-head">
        <h1 className="portal-main-title">Presupuestos</h1>
      </div>
      <p className="portal-sub" style={{ color: 'var(--portal-text)' }}>
        Aprobá o rechazá los presupuestos de tus reparaciones
      </p>

      {error && <ErrorNotice message={error} onDismiss={() => setError('')} autoHideMs={0} />}
      {notice && <div className="pill pill-green" style={{ display: 'inline-block', marginBottom: 12 }}>{notice}</div>}

      {loadingQuotes ? (
        <div className="empty">cargando…</div>
      ) : quotes.length === 0 ? (
        <div className="empty" style={{ padding: '48px' }}>
          No tenés presupuestos pendientes para aprobar.
        </div>
      ) : (
        <div className="portal-tickets-stack">
          {quotes.map((q) => (
            <div key={q.id} className="portal-card">
              <div className="flex-between">
                <div className="portal-card-title">{q.number}</div>
                <span className={`pill ${QUOTE_STATUS_PILLS[q.status]}`}>{QUOTE_STATUS_LABELS[q.status]}</span>
              </div>
              <div className="portal-card-meta">
                {q.equipment.typeLabel}
                {q.equipment.brand ? ' ' + q.equipment.brand : ''}
                {q.equipment.model ? ' ' + q.equipment.model : ''}
                {q.sentAt ? ` · enviado ${fmtDateTime(q.sentAt)}` : ''}
              </div>
              <table className="table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Detalle</th>
                    <th>Cant.</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it, i) => (
                    <tr key={i}>
                      <td>{it.name}</td>
                      <td>{it.quantity}</td>
                      <td>{money(it.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {q.notes && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>{q.notes}</p>}
              <div className="flex-between" style={{ marginTop: 8 }}>
                <strong>Total: {money(q.total)}</strong>
              </div>
              {q.status === 'pendiente' && (
                <div className="flex" style={{ gap: 6, marginTop: 12 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => respond(q.id, 'aprobado')}>
                    Aprobar presupuesto
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => respond(q.id, 'rechazado')}>
                    Rechazar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
