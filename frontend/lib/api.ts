// Minimal typed fetch client for the NestJS API.
//
// BASE = base-origin of the API.
//  - Dev:  NEXT_PUBLIC_API_URL=http://localhost:4000  (absolute, cross-origin)
//  - Prod: unset -> '' (same-origin relative). Caddy reverse-proxies /api and
//          /socket.io to the backend, so the browser can call same-origin.
export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const TOKEN_KEY = 'opssm_access';
const REFRESH_KEY = 'opssm_refresh';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh?: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, access);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { formData?: boolean; retry?: boolean },
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body && !opts?.formData) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers,
    body:
      opts?.formData && body instanceof FormData
        ? body
        : body && !opts?.formData
          ? JSON.stringify(body)
          : undefined,
  });

  // Try refresh once on 401.
  if (res.status === 401 && getRefreshToken() && opts?.retry !== false) {
    const ok = await tryRefresh();
    if (ok) return request<T>(method, path, body, { ...opts, retry: false });
  }

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const json = await res.json();
      msg = json.message || msg;
    } catch {
      /* ignore */
    }
    if (res.status === 401 && onUnauthorized) onUnauthorized();
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join(', ') : msg);
  }

  if (res.status === 204) return undefined as T;
  // Algunos endpoint responden 2xx con cuerpo vacío (ej. "marcar como visto").
  // Intentar res.json() sobre un cuerpo de 0 bytes lanza "Unexpected end of
  // JSON input". Leemos el texto y, si está vacío, devolvemos undefined.
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as T;
  }
}

export async function tryRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  // El token de acceso y el refresh se comparten entre staff y portal (mismo
  // localStorage). Distinguimos el contexto leyendo el claim `type` del token de
  // acceso: 'portal' -> refresh del portal; 'access' (staff) -> refresh de staff.
  const token = getToken();
  let isPortal = false;
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      isPortal = payload.type === 'portal';
    } catch {
      isPortal = false;
    }
  }
  const endpoint = isPortal ? '/api/portal/auth/refresh' : '/api/auth/refresh';
  try {
    const res = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const json = await res.json();
    // El refresh del portal devuelve `{ token }`; el de staff `{ accessToken }`.
    const accessToken = json.token || json.accessToken;
    if (!accessToken) return false;
    setTokens(accessToken, json.refreshToken);
    return true;
  } catch {
    return false;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, form: FormData) =>
    request<T>('POST', path, form, { formData: true }),
};
