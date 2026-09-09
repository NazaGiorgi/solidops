'use client';
import { useEffect } from 'react';
import { PortalAuthProvider } from '../../lib/portal-auth';
import { PortalShell } from './portal-shell';

// El portal de clientes es SIEMPRE claro: ignora la preferencia del staff y la
// del sistema operativo. Si por cualquier motivo el tema quedó oscuro sobre
// <html>, se fuerza 'light' acá y se marca data-portal para que los selectores
// del modo oscuro jamás apliquen en /portal/* (ver globals.css y components.css).
function forceLight() {
  const el = document.documentElement;
  el.setAttribute('data-theme', 'light');
  el.setAttribute('data-portal', '');
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  if (typeof document !== 'undefined') forceLight();
  useEffect(() => {
    forceLight();
  }, []);
  return (
    <PortalAuthProvider>
      <PortalShell>{children}</PortalShell>
    </PortalAuthProvider>
  );
}
