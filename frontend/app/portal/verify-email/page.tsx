'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
import { BrandLogo } from '../../../components/brand-logo';

interface VerifyResult {
  verified: boolean;
  account?: { id: string; name: string; email: string };
  linked?: boolean;
  reason?: string;
  customerId?: string | null;
  customerName?: string | null;
}

function VerifyForm() {
  const search = useSearchParams();
  const token = search.get('token') || '';
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setState('error');
      setError('Este enlace no es válido.');
      return;
    }
    api
      .post<VerifyResult>('/portal/auth/verify-email', { token })
      .then((res) => {
        setResult(res);
        setState('ok');
      })
      .catch((err) => {
        setError((err as Error).message || 'No se pudo verificar el correo');
        setState('error');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkedLabel =
    state === 'ok' && result
      ? result.reason === 'linked'
        ? `Tu cuenta quedó asociada a ${result.customerName}.`
        : result.reason === 'created'
          ? `Se creó tu empresa "${result.customerName}" y tu cuenta quedó asociada.`
          : 'Tu cuenta quedó registrada y va a ser revisada por un operador de soporte.'
      : '';

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <BrandLogo alt="SolidoCS" size={110} />
        <p className="login-sub">Confirmación de cuenta</p>

        {state === 'loading' && <div className="empty" style={{ padding: 24 }}>verificando…</div>}

        {state === 'error' && (
          <>
            <div className="notice notice-error">{error}</div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <a href="/portal/login" className="link">Volver al login</a>
            </div>
          </>
        )}

        {state === 'ok' && result && (
          <>
            <div className="notice" style={{ marginTop: 8 }}>
              ¡Tu correo fue verificado! {linkedLabel}
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <Link href="/portal/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Ir al login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function PortalVerifyEmailPage() {
  return (
    <Suspense fallback={<div className="login-wrap"><div className="empty">cargando…</div></div>}>
      <VerifyForm />
    </Suspense>
  );
}