import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Fase 1: the JWT is stored in localStorage (not an httpOnly cookie), so this
// middleware cannot read it. Real authorization happens on the backend via the
// JWT guard + RBAC roles. This middleware is a pass-through used purely as a
// client-side shim; remove or strengthen it (httpOnly cookie) in a later phase.
export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/mi-dia/:path*',
    '/dashboard/:path*',
    '/tickets/:path*',
    '/clientes/:path*',
    '/tecnicos/:path*',
    '/agenda/:path*',
    '/usuarios/:path*',
    '/notificaciones/:path*',
  ],
};
