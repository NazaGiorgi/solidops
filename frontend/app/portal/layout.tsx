'use client';
import { PortalAuthProvider } from '../../lib/portal-auth';
import { PortalShell } from './portal-shell';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalAuthProvider>
      <PortalShell>{children}</PortalShell>
    </PortalAuthProvider>
  );
}
