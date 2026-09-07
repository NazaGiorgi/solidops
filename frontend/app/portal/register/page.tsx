'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';
import { BrandLogo } from '../../../components/brand-logo';

export default function PortalRegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Ingresá tu nombre');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    if (!accepted) {
      setError('Tenés que aceptar el aviso de privacidad para continuar');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean }>('/portal/auth/register', {
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (res && res.ok === true) {
        setDone(true);
      }
    } catch (err) {
      setError((err as Error).message || 'No se pudo crear la cuenta');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <BrandLogo alt="SolidoCS" size={110} />
        <p className="login-sub">Crear cuenta en el portal de clientes</p>

        {done ? (
          <>
            <div className="notice" style={{ marginTop: 8 }}>
              Te enviamos un correo para verificar tu dirección. Revisá tu casilla (y la carpeta de
              spam) y seguí el enlace para activar la cuenta.
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <a href="/portal/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>
                Volver al login
              </a>
            </div>
          </>
        ) : (
          <>
            {error && <div className="notice notice-error">{error}</div>}
            <form onSubmit={onSubmit}>
              <div className="field">
                <label>Nombre y apellido</label>
                <input
                  className="input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
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
                  minLength={8}
                />
              </div>
              <div className="field">
                <label>Confirmar contraseña</label>
                <input
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  Acepto el <Link href="/portal/privacidad" className="link">aviso de privacidad</Link>
                </span>
              </label>
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'creando cuenta…' : 'crear cuenta'}
              </button>
            </form>
            <p className="card-meta" style={{ marginTop: 16, textAlign: 'center' }}>
              ¿Ya tenés cuenta?{' '}
              <a href="/portal/login" className="link">Volver al login</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}