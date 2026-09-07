'use client';
import { useState } from 'react';
import { API_URL } from '../../../lib/api';

export default function PortalForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/portal/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        throw new Error('No se pudo enviar la solicitud');
      }
      setSent(true);
    } catch (err) {
      setError((err as Error).message || 'No se pudo enviar la solicitud');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1 className="login-title">Portal de clientes</h1>
        {sent ? (
          <>
            <p className="login-sub">
              Si el email existe, te enviamos un enlace para reestablecer tu contraseña.
            </p>
            <div className="notice" style={{ marginTop: 16 }}>
              Revisá tu casilla de correo. El enlace vence en 1 hora.
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <a href="/portal/login" className="link">Volver al login</a>
            </div>
          </>
        ) : (
          <>
            <p className="login-sub">Ingresá tu email y te enviamos un enlace de recuperación</p>
            {error && <div className="notice notice-error">{error}</div>}
            <form onSubmit={onSubmit}>
              <div className="field">
                <label>Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Enviando…' : 'Enviar enlace'}
              </button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <a href="/portal/login" className="link">Volver al login</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
