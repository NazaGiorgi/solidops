'use client';
import { useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { api } from '../../lib/api';

function ResetForm() {
  const search = useSearchParams();
  const router = useRouter();
  const token = search.get('token') || '';
  const type = search.get('type') === 'portal' ? 'portal' : 'staff';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    try {
      const endpoint =
        type === 'portal' ? '/portal/auth/reset-password' : '/auth/reset-password';
      await api.post(endpoint, { token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message || 'No se pudo reestablecer la contraseña');
    } finally {
      setBusy(false);
    }
  }

  const portal = type === 'portal';
  const backHref = portal ? '/portal/login' : '/login';

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1 className="login-title">{portal ? 'Portal de clientes' : 'SolidOps'}</h1>
        {!token ? (
          <>
            <p className="login-sub">Este enlace no es válido.</p>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <a href={backHref} className="link">Volver al login</a>
            </div>
          </>
        ) : done ? (
          <>
            <p className="login-sub">Tu contraseña se actualizó correctamente. Ya podés iniciar sesión.</p>
            <div className="notice" style={{ marginTop: 16 }}>
              Podés iniciar sesión con tu nueva contraseña.
            </div>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => router.push(backHref)}>
                Ir al login
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="login-sub">Definí tu nueva contraseña</p>
            {error && <div className="notice notice-error">{error}</div>}
            <form onSubmit={onSubmit}>
              <div className="field">
                <label>Nueva contraseña</label>
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
              <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="login-wrap"><div className="empty">cargando…</div></div>}>
      <ResetForm />
    </Suspense>
  );
}
