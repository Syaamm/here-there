const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const KEY = 'ht_admin_session';

export type Role = 'user' | 'support' | 'moderator' | 'trust_lead' | 'admin';
/** The part of the service a staff account looks after: one city, region or country. `null` = the whole service. */
export type Scope = { key: string; name: string; kind: string } | null;
export type Session = { token: string; refreshToken?: string; email: string; role: Role; name: string; scope?: Scope };

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

const PLACE_KEY = 'ht_admin_place';
/** Where this person chose to work after signing in: a place key, "all" (the whole service), or nothing yet. */
export const getPlace = (): { key: string; name: string } | null => {
  try {
    const raw = sessionStorage.getItem(PLACE_KEY);
    return raw ? (JSON.parse(raw) as { key: string; name: string }) : null;
  } catch {
    return null;
  }
};
export function setPlace(p: { key: string; name: string } | null) {
  try {
    if (p) sessionStorage.setItem(PLACE_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(PLACE_KEY);
  } catch {
    /* storage unavailable: the choice just lives until the page is reloaded */
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
// the long-lived half of the sign-in: sent only to /v1/auth/refresh when the short-lived token (15 minutes) has ended
let refreshToken: string | null = loadSession()?.refreshToken ?? null;
let onUnauthorized: () => void = () => {};
export const setToken = (t: string | null) => (token = t);
export const setRefreshToken = (t: string | null) => (refreshToken = t);
export const getRefreshToken = () => refreshToken;

// one refresh at a time: requests that find the token ended together share a single refresh
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  if (!refreshToken) return Promise.resolve(false);
  const sent = refreshToken;
  return (refreshing ??= (async () => {
    try {
      const res = await fetch(BASE + '/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: sent }) });
      if (res.ok) {
        const d = await res.json();
        if (refreshToken !== sent) return !!token; // signed out meanwhile
        token = d.token;
        refreshToken = d.refreshToken;
        const cur = loadSession();
        if (cur) saveSession({ ...cur, token: d.token, refreshToken: d.refreshToken });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })());
}
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  const send = async () => {
    try {
      return await fetch(BASE + path, {
        method,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(getPlace() && getPlace()!.key !== 'all' ? { 'x-admin-place': getPlace()!.key } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', `Cannot reach the API at ${BASE}. Is it running?`);
    }
  };
  res = await send();
  // the short-lived token ended: get a new one and ask again, once
  if (res.status === 401 && refreshToken && !path.startsWith('/v1/auth/') && (await refreshSession())) res = await send();
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/')) onUnauthorized();
    const detail = Array.isArray(data?.details) ? ': ' + data.details.map((d: any) => d.message).join(', ') : '';
    throw new ApiError(res.status, data?.code ?? 'ERROR', (data?.message ?? res.statusText) + detail);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
