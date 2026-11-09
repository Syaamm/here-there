// "same-origin" (the build the API serves at /admin/, `npm run build:web`): the API is wherever this page came from
export const BASE = import.meta.env.VITE_API_URL === 'same-origin' ? window.location.origin : (import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
const KEY = 'ht_admin_session';

export type Role = 'user' | 'guest' | 'staff' | 'admin';
/** The parts of the console an admin can switch on or off for each staff member. */
export type Permission = 'reports' | 'verification' | 'users' | 'content';
export const PERMISSIONS: { id: Permission; label: string }[] = [
  { id: 'reports', label: 'Reports' },
  { id: 'verification', label: 'Verification' },
  { id: 'users', label: 'Users' },
  { id: 'content', label: 'Content' },
];
/** The part of the service a staff account looks after: one city, region or country. `null` = the whole service. */
export type Scope = { key: string; name: string; kind: string } | null;
export type Session = { token: string; refreshToken?: string; email: string; role: Role; name: string; scope?: Scope; permissions?: Permission[] };

export const STAFF: Role[] = ['staff', 'admin'];
/** Two kinds of console account: Admin (everything, everywhere) and Staff (one area, the parts an admin allowed). The server decides. */
export const can = {
  moderate: (r: Role) => r === 'staff' || r === 'admin',
  verify: (r: Role) => r === 'staff' || r === 'admin',
  /** overturning, resetting or re-requesting an identity check, the audit log */
  trust: (r: Role) => r === 'admin',
  admin: (r: Role) => r === 'admin',
};
export const roleLabel = (r: Role | string) => (r === 'admin' ? 'Admin' : r === 'staff' ? 'Staff' : 'Member');

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

// Tabs opened from one another (Duplicate tab) start with the same sign-in. When one tab renews it, the others take the new
// tokens too; otherwise the next tab to renew would present the old token, and the server ends a sign-in whose token comes back.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ht_admin_auth') : null;
channel?.addEventListener('message', (e: MessageEvent<{ sent: string; token: string; refreshToken: string }>) => {
  if (!e.data || e.data.sent !== refreshToken) return;
  token = e.data.token;
  refreshToken = e.data.refreshToken;
  const cur = loadSession();
  if (cur) saveSession({ ...cur, token: e.data.token, refreshToken: e.data.refreshToken });
});

/** ok: renewed. denied: the server says this sign-in is over (sign out). retry: a passing problem (busy, rate limit, network). */
type Renewal = 'ok' | 'denied' | 'retry';
// one refresh at a time: requests that find the token ended together share a single refresh
let refreshing: Promise<Renewal> | null = null;
function refreshSession(): Promise<Renewal> {
  if (!refreshToken) return Promise.resolve('denied');
  const sent = refreshToken;
  return (refreshing ??= (async (): Promise<Renewal> => {
    try {
      const res = await fetch(BASE + '/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: sent }) });
      if (res.ok) {
        const d = await res.json();
        if (refreshToken !== sent) return token ? 'ok' : 'denied'; // renewed by another tab, or signed out, meanwhile
        token = d.token;
        refreshToken = d.refreshToken;
        const cur = loadSession();
        if (cur) saveSession({ ...cur, token: d.token, refreshToken: d.refreshToken });
        channel?.postMessage({ sent, token: d.token, refreshToken: d.refreshToken });
        return 'ok';
      }
      if (refreshToken !== sent) return 'ok'; // another tab renewed it while this one asked
      return res.status === 401 ? 'denied' : 'retry';
    } catch {
      return 'retry';
    } finally {
      refreshing = null;
    }
  })());
}
/** Renew, waiting a little and trying again (twice) when the problem is a passing one. */
async function renew(): Promise<Renewal> {
  for (let i = 0; i < 3; i++) {
    const r = await refreshSession();
    if (r !== 'retry') return r;
    await new Promise((ok) => setTimeout(ok, 700 * (i + 1)));
  }
  return 'retry';
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
  // a wrong current password (choosing a new password) is a 401 too, but the sign-in itself is fine: no refresh, no sign-out
  const wrongPassword = async (r: Response) => r.status === 401 && (await r.clone().json().catch(() => null))?.code === 'WRONG_PASSWORD';
  // the short-lived token ended: get a new one and ask again, once
  if (res.status === 401 && refreshToken && !path.startsWith('/v1/auth/') && !(await wrongPassword(res))) {
    const renewed = await renew();
    // a passing problem is not a reason to sign anyone out: say so, and the next action tries again
    if (renewed === 'retry') throw new ApiError(0, 'RENEW_FAILED', 'Could not renew your sign-in just now. Please try again.');
    if (renewed === 'ok') res = await send();
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/') && data?.code !== 'WRONG_PASSWORD') onUnauthorized();
    const detail = Array.isArray(data?.details) ? ': ' + data.details.map((d: any) => d.message).join(', ') : '';
    throw new ApiError(res.status, data?.code ?? 'ERROR', (data?.message ?? res.statusText) + detail);
  }
  return data as T;
}

/**
 * A private picture (a proof photo sent with an appeal or a dispute) as an address the page can show. Fetched with the sign-in,
 * because an <img> cannot send it. Release it with URL.revokeObjectURL when it is no longer shown.
 */
export async function getImage(path: string): Promise<string> {
  const send = () => fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && refreshToken && (await renew()) === 'ok') res = await send();
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the API at ${BASE}. Is it running?`);
  }
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Could not load the photo');
  return URL.createObjectURL(await res.blob());
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);
