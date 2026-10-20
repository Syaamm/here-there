import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * API address. Priority: EXPO_PUBLIC_API_URL, then the computer running `expo start`
 * (so Expo Go on your phone finds the dev API on the same Wi-Fi), then emulator defaults.
 */
function baseUrl() {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}
export const API_URL = baseUrl();

const TOKEN_KEY = 'ht_token';

// On phones the sign-in token lives in the system keychain / keystore. Browsers have no such thing, so the
// web preview falls back to localStorage (preview only).
export async function loadToken(): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? localStorage.getItem(TOKEN_KEY) : await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}
export async function saveToken(t: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
      return;
    }
    if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session lasts until the app closes */
  }
}

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

let token: string | null = null;
let onUnauthorized: () => void = () => {};
export const setToken = (t: string | null) => (token = t);
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the server right now. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/')) onUnauthorized();
    const detail = Array.isArray(data?.details) ? ': ' + data.details.map((d: any) => d.message).join(', ') : '';
    throw new ApiError(res.status, data?.code ?? 'ERROR', (data?.message ?? res.statusText) + detail, data?.details);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
/** A profile picture's address as the API returns it ("/v1/users/…/photo?v=…") turned into a full URL. */
export const photoSrc = (p?: string | null) => (p ? (/^https?:/.test(p) ? p : API_URL + p) : undefined);

/** Sends a picked image to the API, which crops it square, shrinks it and stores it as webp. */
export async function uploadPhoto(uri: string): Promise<{ photoUrl: string }> {
  const blob = await (await fetch(uri)).blob();
  let res: Response;
  try {
    res = await fetch(API_URL + '/v1/me/photo', { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: blob });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the server right now. Check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', data?.message ?? 'Could not upload the picture.');
  return data;
}

export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

// ---------------------------------------------------------------- shared types
export type Me = {
  id: string;
  email: string;
  role: string;
  // three separate statuses: email, adult (18+), identity
  emailVerified: boolean;
  adultConfirmed: boolean;
  adultVerified: boolean;
  eligibility: 'unverified' | 'pending' | 'verified' | 'rejected' | 'expired' | 'reverification_required';
  verifiedUntil: string | null;
  reverifyReason: string | null;
  // optional mobile number (masked), gates nothing
  phoneVerified: boolean;
  phone: string | null;
  profile: { displayName: string; homeCity: string | null; languages: string[]; interests: string[]; bio: string | null; photoUrl: string | null } | null;
};

type HostInfo = { id: string; displayName: string; photoUrl?: string | null; verifiedAdult: boolean };
type Participant = { id: string; displayName: string; photoUrl?: string | null; verifiedAdult: boolean; role: string };

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
  host: HostInfo;
  distanceKm?: number;
  favorited?: boolean;
  // detail only
  isHost?: boolean;
  isMember?: boolean;
  myRequest?: { id: string; state: string } | null;
  conversationId?: string | null;
  participants?: Participant[];
  /** how many activities the host has run or has coming up (cancelled ones excluded) */
  activitiesHosted?: number;
};

export type Trip = {
  id: string;
  title: string;
  destination: string;
  originCity: string;
  dateStart: string;
  dateEnd: string;
  dateFlexibility: string;
  budget: { label: string; currency: string; min: number; max: number; includesTransport: boolean; scope: string };
  tags: string[];
  description: string | null;
  minCapacity: number;
  maxCapacity: number;
  members: number;
  spotsLeft: number;
  status: string;
  kind: string;
  disclaimer: string;
  host: HostInfo;
  // search only
  match?: { dates: 'exact' | 'approximate' | 'unspecified'; budgetScopeMismatch: boolean; score: number };
  groupOpen?: boolean;
  // detail only
  isHost?: boolean;
  isMember?: boolean;
  myApplication?: { id: string; state: string; message: string } | null;
  conversationId?: string | null;
  participants?: Participant[];
};

export type Notif = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { activityId?: string; tripId?: string; conversationId?: string } | null;
  readAt: string | null;
  createdAt: string;
};

/** "Group info": what the group is and who is in it. The host is the group admin. */
export type GroupInfo = {
  id: string;
  scope: 'activity' | 'trip';
  scopeId: string;
  title: string;
  category: string | null;
  status: string;
  startsAt: string;
  endsAt: string;
  place: string;
  capacity: number;
  members: { id: string; displayName: string; photoUrl: string | null; verifiedAdult: boolean; role: 'host' | 'member'; isMe: boolean }[];
};

export type ConversationRef = { conversationId: string; scope: 'activity' | 'trip'; scopeId: string; title: string; category?: string | null; startsAt?: string };
