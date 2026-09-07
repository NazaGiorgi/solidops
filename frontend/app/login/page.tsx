'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { BrandLogo } from '../../components/brand-logo';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('maria@msp.local');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      // login() redirects; no-op here.
    } catch (err) {
      setError((err as Error).message || 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <BrandLogo alt="SolidOps" size={110} />
        <p className="login-sub">Iniciá sesión para ver tu día</p>
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
          <div className="field">
            <label>Contraseña</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <a href="/forgot-password" className="link">
            ¿Olvidaste tu contraseña?
          </a>
        </div>
        <div className="login-hint">
          Demo: <code>maria@msp.local</code> / <code>demo1234</code> (técnica).
          <br />
          Supervisor: <code>ana@msp.local</code> / <code>demo1234</code>.
          <br />
          Coordinador: <code>lucas@msp.local</code> / <code>demo1234</code>.
        </div>
      </div>
    </div>
  );
}
