'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  clearTokens,
  getToken,
  setTokens,
  setOnUnauthorized,
} from './api';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  roleId: string;
  technicianId?: string | null;
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  hasPerm: (perm: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setOnUnauthorized(() => {
      clearTokens();
      setUser(null);
      // El token es compartido entre staff y portal (mismo localStorage). Si el
      // 401 ocurre en una ruta del portal, se redirige al login del portal; si no,
      // al login interno de staff. Así el logout del portal no cae en /login.
      const isPortal = typeof window !== 'undefined' && window.location.pathname.startsWith('/portal');
      router.push(isPortal ? '/portal/login' : '/login');
    });
    // Bootstrap: decode the stored user.
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem('opssm_user') : null;
    if (raw && getToken()) {
      try {
        const cached = JSON.parse(raw) as AuthUser;
        // Re-sync de permisos: si al user cacheado le falta un permiso que el
        // sistema considera de TODOS los roles (p.ej. notes:read, agregado en una
        // iteración anterior y que ya existe en la BD), es señal de que la sesión
        // es de un login anterior al cambio. En ese caso descartamos el cache y
        // forzamos re-autenticación para regenerar los permisos actualizados.
        // Sin esto, el sidebar filtra los ítems nuevos y no aparecen hasta hacer
        // logout/login manual.
        if (!ensureAllRolePermissions(cached)) {
          clearTokens();
          sessionStorage.removeItem('opssm_user');
          setUser(null);
          setLoading(false);
          router.push('/login');
          return;
        }
        setUser(cached);
        // Re-sync de permisos desde la BD sin obligar logout/login: el rol puede
        // haber ganado permisos nuevos (p.ej. workshop:* al dar de alta el módulo
        // Taller) después del login. Como el JWT.strategy del backend resuelve los
        // permisos frescos en cada request, aquí los leemos una vez al arrancar
        // para que el sidebar muestre los ítems nuevos sin que el usuario tenga que
        // salir y volver a entrar.
        api
          .get<AuthUser>('/auth/me')
          .then((fresh) => {
            if (!fresh) return;
            setUser(fresh);
            sessionStorage.setItem('opssm_user', JSON.stringify(fresh));
          })
          .catch(() => {});
      } catch {
        /* ignore */
      }
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(email: string, password: string) {
    const res = await api.post<{ accessToken: string; refreshToken: string; user: AuthUser }>(
      '/auth/login',
      { email, password },
    );
    setTokens(res.accessToken, res.refreshToken);
    sessionStorage.setItem('opssm_user', JSON.stringify(res.user));
    setUser(res.user);
    // Route by role entry screen.
    const isSupervisor = res.user.role === 'Supervisor' || res.user.role === 'Administrador';
    router.push(isSupervisor ? '/dashboard' : '/mi-dia');
  }

  function logout() {
    clearTokens();
    sessionStorage.removeItem('opssm_user');
    setUser(null);
    router.push('/login');
  }

  function hasPerm(perm: string) {
    return !!user?.permissions?.includes(perm);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPerm }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Permisos que TODOS los roles del sistema poseen (se sincronizan con el seed de
// roles del backend). Si al user cacheado le falta alguno, es un cache de un login
// anterior al alta de ese permiso → hay que re-autenticar para regenerarlo.
const ALL_ROLE_PERMISSIONS = ['notes:read', 'notes:write'];

function ensureAllRolePermissions(user: AuthUser): boolean {
  return ALL_ROLE_PERMISSIONS.every((p) => user.permissions?.includes(p));
}
