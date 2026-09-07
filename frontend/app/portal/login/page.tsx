'use client';
import { useState } from 'react';
import { usePortalAuth } from '../../../lib/portal-auth';
import { BrandLogo } from '../../../components/brand-logo';

export default function PortalLoginPage() {
  const { login } = usePortalAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message || 'No se pudo iniciar sesión');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <BrandLogo alt="SolidoCS" size={110} />
        <p className="login-sub">Portal de clientes — consultá tus tickets de soporte</p>
        {error && <div className="notice notice-error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'ingresando…' : 'ingresar'}
          </button>
        </form>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
          <a href="/portal/forgot-password" className="link">
            ¿Olvidaste tu contraseña?
          </a>
          <a href="/portal/register" className="link">
            Crear cuenta
          </a>
        </div>
        <p className="card-meta" style={{ marginTop: 16, textAlign: 'center' }}>
          Acceso gestionado por tu proveedor de soporte. <a href="/login" className="link">Ir al login interno</a>
        </p>
      </div>
    </div>
  );
}
