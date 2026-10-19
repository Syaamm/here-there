const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const KEY = 'ht_admin_session';

export type Role = 'user' | 'support' | 'moderator' | 'trust_lead' | 'admin';
export type Session = { token: string; email: string; role: Role; name: string };

export const STAFF: Role[] = ['support', 'moderator', 'trust_lead', 'admin'];
/** Mirrors the server's @Staff() groups in admin.controller.ts; the server stays the source of truth. */
export const can = {
  moderate: (r: Role) => ['moderator', 'trust_lead', 'admin'].includes(r),
  trust: (r: Role) => ['trust_lead', 'admin'].includes(r),
  admin: (r: Role) => r === 'admin',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the session just lives in memory */
  }
}

let token: string | null = loadSession()?.token ?? null;
let onUnauthorized: () => void = () => {};
export const setToken = (t: string | null) => (token = t);
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the API at ${BASE}. Is it running?`);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/v1/auth/login') onUnauthorized();
    const detail = Array.isArray(data?.details) ? ': ' + data.details.map((d: any) => d.message).join(', ') : '';
    throw new ApiError(res.status, data?.code ?? 'ERROR', (data?.message ?? res.statusText) + detail);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
