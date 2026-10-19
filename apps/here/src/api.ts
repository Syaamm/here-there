const BASE = import.meta.env.VITE_API_URL ?? `http://${location.hostname}:3000`;
const KEY = 'here_token';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function loadToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function saveToken(t: string | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: stay signed in for this tab only */
  }
}

let token: string | null = loadToken();
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
    throw new ApiError(0, 'NETWORK', "Can't reach HERE right now. Check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/')) onUnauthorized();
    const detail = Array.isArray(data?.details) ? ': ' + data.details.map((d: any) => d.message).join(', ') : '';
    throw new ApiError(res.status, data?.code ?? 'ERROR', (data?.message ?? res.statusText) + detail, data?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

// ---------------------------------------------------------------- shared types
export type Me = {
  id: string;
  email: string;
  role: string;
  adultConfirmed: boolean;
  eligibility: 'unverified' | 'pending' | 'verified' | 'rejected';
  profile: { displayName: string; homeCity: string | null; languages: string[]; interests: string[]; bio: string | null; photoUrl: string | null } | null;
};

export type Activity = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  description: string | null;
  city: string;
  venueName: string;
  lat: number | null;
  lng: number | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  going: number;
  spotsLeft: number;
  status: string;
  visibility: string;
  host: { id: string; displayName: string; verifiedAdult: boolean };
  distanceKm?: number;
  favorited?: boolean;
  // detail only
  isHost?: boolean;
  isMember?: boolean;
  myRequest?: { id: string; state: string } | null;
  conversationId?: string | null;
  participants?: { id: string; displayName: string; verifiedAdult: boolean; role: string }[];
};
