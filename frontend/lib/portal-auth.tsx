'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, api, getToken, getRefreshToken, setTokens, clearTokens } from './api';

export interface PortalUser {
  id: string;
  name: string;
  email: string | null;
  customerId: string | null;
}

interface PortalAuthValue {
  user: PortalUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const PORTAL_USER_KEY = 'opsmsp_portal_user';
const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Portal auth reuses the same token storage (localStorage) as the staff app
  // but a dedicated user key, so a contact's session never maps to staff roles.
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem(PORTAL_USER_KEY) : null;
    if (raw && getToken()) {
      try {
        setUser(JSON.parse(raw));
        // Refresca los datos del contacto (p.ej. la empresa puede asignarse en
        // cualquier momento desde la bandeja de staff).
        fetchMe().then((fresh) => {
          if (fresh) {
            sessionStorage.setItem(PORTAL_USER_KEY, JSON.stringify(fresh));
            setUser(fresh);
          }
        });
      } catch {
        /* ignore */
      }
    }
    setLoading(false);
  }, []);

  async function fetchMe(): Promise<PortalUser | null> {
    try {
      return await api.get<PortalUser>('/api/portal/auth/me');
    } catch {
      return null;
    }
  }

  async function login(email: string, password: string) {
    const res = await fetch(`${API_URL}/api/portal/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.message) || 'Credenciales de portal inválidas');
    }
    setTokens(data.token, data.refreshToken); // store as the access token for portal calls
    sessionStorage.setItem(PORTAL_USER_KEY, JSON.stringify(data.contact));
    setUser(data.contact);
    router.push('/portal');
  }

  async function refreshUser() {
    const fresh = await fetchMe();
    if (fresh) {
      sessionStorage.setItem(PORTAL_USER_KEY, JSON.stringify(fresh));
      setUser(fresh);
    }
  }

  function logout() {
    clearTokens();
    sessionStorage.removeItem(PORTAL_USER_KEY);
    setUser(null);
    router.push('/portal/login');
  }

  return (
    <PortalAuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </PortalAuthContext.Provider>
  );
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider');
  return ctx;
}
