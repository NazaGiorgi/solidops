import Link from 'next/link';

export default function PortalPrivacyPage() {
  return (
    <div className="login-wrap">
      <div className="card login-card" style={{ maxWidth: 560 }}>
        <p className="login-sub">Aviso de privacidad — Portal de clientes</p>
        <div style={{ fontSize: 13, lineHeight: 1.7, textAlign: 'left' }}>
          <p>
            Al crear tu cuenta en este portal nos brindás tu nombre, dirección de correo y una
            contraseña. Usamos esa información únicamente para:
          </p>
          <ul style={{ paddingLeft: 20 }}>
            <li>Gestionar tu acceso al portal y verificar tu identidad.</li>
            <li>
              Identificar tu empresa (según el dominio de tu correo) y mostrar únicamente los
              tickets de tu propia empresa.
            </li>
            <li>Enviarte correos transaccionales (verificación, recuperación de contraseña).</li>
            <li>
              Permitir que el equipo de soporte pueda asociar tu cuenta a la empresa correcta si el
              vínculo automático no fue posible.
            </li>
          </ul>
          <p>
            No compartimos tus datos con terceros. Tu contraseña se almacena de forma segura
            (hash). Podés solicitar la baja de tu cuenta contactando a soporte.
          </p>
          <p>
            Este registro es un servicio ofrecido por Solido Connecting Solutions a sus clientes.
            Para consultas sobre tus datos escribinos a soporte@solidocs.com.ar.
          </p>
        </div>
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link href="/portal/register" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            Volver al registro
          </Link>
        </div>
      </div>
    </div>
  );
}