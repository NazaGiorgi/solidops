'use client';
import { useState } from 'react';
import { api } from '../../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Backend always returns { ok: true } whether or not the email exists
      // (no account enumeration).
      await api.post('/auth/forgot-password', { email });
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
        <h1 className="login-title">SolidOps</h1>
        {sent ? (
          <>
            <p className="login-sub">
              Si el email existe, te enviamos un enlace para reestablecer tu contraseña.
            </p>
            <div className="notice" style={{ marginTop: 16 }}>
              Revisá tu casilla de correo. El enlace vence en 1 hora.
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <a href="/login" className="link">Volver al login</a>
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
              <a href="/login" className="link">Volver al login</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
