import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { PixelRatio, Platform } from 'react-native';
import { currentLang, t } from './i18n';

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
const REFRESH_KEY = 'ht_refresh';

// On phones the sign-in tokens live in the system keychain / keystore. Browsers have no such thing, so the
// web preview falls back to localStorage (preview only).
async function readSecret(key: string): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? localStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}
async function writeSecret(key: string, value: string | null) {
  try {
    if (Platform.OS === 'web') {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      return;
    }
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    /* storage unavailable: the session lasts until the app closes */
  }
}
export const loadToken = () => readSecret(TOKEN_KEY);
export const loadRefreshToken = () => readSecret(REFRESH_KEY);
export const saveToken = (t: string | null) => writeSecret(TOKEN_KEY, t);
export const saveRefreshToken = (t: string | null) => writeSecret(REFRESH_KEY, t);

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
// The long-lived half of a sign-in. It is sent only to /v1/auth/refresh, to get a new short-lived token when the old one ends.
let refreshToken: string | null = null;

// A random id made once for this install (never anything about the phone itself). The server keeps only a keyed fingerprint
// of it, to limit how many accounts one device can create and to stop a banned person starting over.
const DEVICE_KEY = 'ht_device';
let device: string | null = null;
async function deviceId() {
  if (device) return device;
  try {
    const stored = Platform.OS === 'web' ? localStorage.getItem(DEVICE_KEY) : await SecureStore.getItemAsync(DEVICE_KEY);
    if (stored) return (device = stored);
  } catch {
    /* unreadable: make a new one below */
  }
  const fresh = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  try {
    if (Platform.OS === 'web') localStorage.setItem(DEVICE_KEY, fresh);
    else await SecureStore.setItemAsync(DEVICE_KEY, fresh);
  } catch {
    /* it lasts until the app closes */
  }
  return (device = fresh);
}

// The last answer to each GET, with the server's version tag. The next time the same page is asked for, the tag goes along;
// if nothing changed the server replies "304 not modified" with no body and the remembered answer is used. Polling a
// list that has not changed then costs almost nothing.
const etags = new Map<string, { tag: string; data: unknown }>();
const MAX_TAGS = 150;
let onUnauthorized: () => void = () => {};
export const setToken = (t: string | null) => {
  if (t !== token) etags.clear(); // one person's answers are never reused for another
  token = t;
};
export const getToken = () => token;
export const setRefreshToken = (t: string | null) => (refreshToken = t);
export const getRefreshToken = () => refreshToken;
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

// how many changes (anything but a read) this person has made: screens use it to know whether what they show can be stale
let writes = 0;
export const writeCount = () => writes;

/** When a token ends, in milliseconds since 1970 (read from the token itself; 0 if it cannot be read). */
function tokenExpiry(t: string | null): number {
  try {
    const body = t?.split('.')[1];
    if (!body) return 0;
    const json = JSON.parse(globalThis.atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

// One refresh at a time: when several requests find the token ended together, they share a single refresh.
let refreshing: Promise<boolean> | null = null;
/**
 * Swap the refresh token for a new pair. true = signed in again; false = the server says this sign-in is over (sign out).
 * A lost connection or a server fault throws instead, so a bad moment on the network never signs anybody out.
 */
function refreshSession(): Promise<boolean> {
  if (!refreshToken) return Promise.resolve(false);
  const sent = refreshToken;
  return (refreshing ??= (async () => {
    try {
      const res = await fetch(API_URL + '/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': await deviceId() }, body: JSON.stringify({ refreshToken: sent }) });
      if (res.ok) {
        const d = await res.json();
        // somebody (a sign-out) may have changed the session while this was in flight: only keep the answer if it is still the same one
        if (refreshToken !== sent) return !!token;
        setToken(d.token);
        refreshToken = d.refreshToken;
        await Promise.all([saveToken(d.token), saveRefreshToken(d.refreshToken)]);
        return true;
      }
      if (res.status === 401 || res.status === 400) return false;
      throw new ApiError(0, 'NETWORK', t("Can't reach the server right now. Check your connection and try again."));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0, 'NETWORK', t("Can't reach the server right now. Check your connection and try again."));
    } finally {
      refreshing = null;
    }
  })());
}

/** A token that is good for at least another minute, refreshing first if it is about to end (the live connection needs one when it reconnects). */
export async function freshToken(): Promise<string | null> {
  if (token && refreshToken && tokenExpiry(token) - Date.now() < 60_000) {
    try {
      await refreshSession();
    } catch {
      /* no connection: the old one is tried, and the next attempt refreshes */
    }
  }
  return token;
}

// A write that did not get an answer (the connection dropped) may or may not have happened. The same action tried again
// carries the same Idempotency-Key, so the server does it once; the key is forgotten as soon as any answer comes back.
const pendingKeys = new Map<string, { key: string; at: number }>();
const KEY_KEEP_MS = 10 * 60_000;
function idempotencyKey(sig: string) {
  const now = Date.now();
  for (const [k, v] of pendingKeys) if (now - v.at > KEY_KEEP_MS) pendingKeys.delete(k);
  const kept = pendingKeys.get(sig);
  if (kept) return kept.key;
  const key = `${now.toString(36)}-${Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
  pendingKeys.set(sig, { key, at: now });
  return key;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== 'GET') writes++;
  const known = method === 'GET' ? etags.get(path) : undefined;
  const deviceHeader = await deviceId();
  const bodyText = body === undefined ? undefined : JSON.stringify(body);
  // writes by a signed-in person are safe to repeat (not sign-in itself, which has no person yet)
  const sig = method !== 'GET' && token && !path.startsWith('/v1/auth/') ? `${method} ${path} ${bodyText ?? ''}` : null;
  let res: Response;
  let data: any = null;
  for (let tries = 0; ; tries++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      res = await fetch(API_URL + path, {
        method,
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-device-id': deviceHeader, 'accept-language': currentLang(), ...(known ? { 'if-none-match': known.tag } : {}), ...(sig ? { 'idempotency-key': idempotencyKey(sig) } : {}) },
        body: bodyText,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', t("Can't reach the server right now. Check your connection and try again.")); // the key is kept, so trying again is safe
    } finally {
      clearTimeout(timer);
    }
    if (sig) pendingKeys.delete(sig); // an answer came back: the next try is a new action
    if (res.status === 304 && known) return known.data as T; // nothing changed since the last time
    const text = await res.text();
    data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error page */
    }
    // the short-lived token ended: get a new one and ask again, once, without the person noticing
    if (res.status === 401 && tries === 0 && refreshToken && !path.startsWith('/v1/auth/') && (await refreshSession())) continue;
    break;
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/')) onUnauthorized();
    const detail = Array.isArray(data?.details) ? ': ' + data.details.map((d: any) => t(d.message)).join(', ') : '';
    throw new ApiError(res.status, data?.code ?? 'ERROR', t(data?.message ?? res.statusText) + detail, data?.details);
  }
  const tag = method === 'GET' ? res.headers.get('etag') : null;
  if (tag) {
    etags.delete(path);
    etags.set(path, { tag, data });
    if (etags.size > MAX_TAGS) etags.delete(etags.keys().next().value!);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
/** A profile picture's address as the API returns it ("/v1/users/…/photo?v=…") turned into a full URL. */
export const photoSrc = (p?: string | null, px?: number) => {
  if (!p) return undefined;
  const url = /^https?:/.test(p) ? p : API_URL + p;
  // a list shows a small face: ask for a small copy of our own pictures (96 or 192 pixels) instead of the full one
  if (px === undefined || !/\/v1\/users\/[^/]+\/photo/.test(url)) return url;
  const need = px * PixelRatio.get();
  return need <= 96 ? `${url}${url.includes('?') ? '&' : '?'}s=96` : need <= 192 ? `${url}${url.includes('?') ? '&' : '?'}s=192` : url;
};

/** The server keeps a 384-pixel picture, so a phone photo of several megapixels is cut to 768 on the long side first (about 100 KB, not several MB). Falls back to the original if the phone cannot do it. */
async function shrinkPhoto(uri: string): Promise<string> {
  try {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const ctx = ImageManipulator.manipulate(uri);
    const img = await ctx.renderAsync();
    const long = Math.max(img.width, img.height);
    if (long <= 768) return uri;
    const small = await (img.width >= img.height ? ImageManipulator.manipulate(uri).resize({ width: 768 }) : ImageManipulator.manipulate(uri).resize({ height: 768 })).renderAsync();
    return (await small.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })).uri;
  } catch {
    return uri;
  }
}

/** Sends a picked image to the API, which crops it square, shrinks it and stores it as webp. */
export async function uploadPhoto(uri: string): Promise<{ photoUrl: string }> {
  const blob = await (await fetch(await shrinkPhoto(uri))).blob();
  let res: Response;
  try {
    res = await fetch(API_URL + '/v1/me/photo', { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: blob });
  } catch {
    throw new ApiError(0, 'NETWORK', t("Can't reach the server right now. Check your connection and try again."));
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'ERROR', t(data?.message ?? 'Could not upload the picture.'));
  return data;
}

export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);
export const put = <T = any>(p: string, b: unknown = {}) => api<T>('PUT', p, b);

/** An activity or trip saved for later. `data` is the form as the person left it. */
export type ServerDraft = { id: string; kind: 'activity' | 'trip'; title: string | null; data: Record<string, unknown>; updatedAt: string };
/** A person's request to have a decision looked at again. */
export type MyAppeal = { id: string; kind: 'verification' | 'suspension' | 'removal' | 'report' | 'warning' | 'message'; what: string; state: 'open' | 'upheld' | 'rejected'; decision: string | null; message: string; createdAt: string; decidedAt: string | null };

// ---------------------------------------------------------------- shared types
/** One row of "my trips" from the server: a trip you organise or are in, or one you applied to. */
export type MyTripRow = (Trip & { row: 'joined'; role: string }) | { row: 'application'; applicationId: string; state: string; trip: Trip };
export type MyTripsPage = { items: MyTripRow[]; nextCursor: string | null; counts: { joined: number; applications: number } };
/** One row of "my activities": one you host or are going to, or one you asked to join. */
export type MyActivityRow = (Activity & { row: 'joined'; role: string }) | { row: 'request'; requestId: string; state: string; activity: Activity };
export type MyActivitiesPage = { items: MyActivityRow[]; nextCursor: string | null; counts: { mine: number; pending: number; rejected: number } };

/** A person's reliability level as another verified member sees it. */
export type Reliability = { level: 'new' | 'reliable' | 'very_reliable' | 'needs_care'; label: string };
/** My own level: just the level and one short line. */
export type MyReliability = { level: Reliability['level']; label: string; line: string };
/** A host's note that I did not come. */
export type MyNoShow = { id: string; kind: string; targetId: string; title: string; state: string; markedAt: string; canDispute: boolean; disputeUntil: string; counts: boolean; decisionNote: string | null };
/** The host's list of who was in the plan, with any note already made. */
export type NoShowList = {
  title: string;
  startsAt: string;
  endsAt: string;
  canMark: boolean;
  markableFrom: string;
  markableUntil: string;
  items: { userId: string; displayName: string; photoUrl: string | null; mark: { id: string; state: string; markedAt: string } | null }[];
};

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
type Participant = { id: string; displayName: string; photoUrl?: string | null; verifiedAdult: boolean; role: string; /** trips, while final dates wait for everyone: has this person said yes */ datesConfirmed?: boolean };

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
  /** instant: whoever asks while there is room is in at once; host_approval: the host decides on each request */
  joinPolicy?: 'host_approval' | 'instant';
  host: HostInfo;
  distanceKm?: number;
  /** the host's reliability level, shown to verified members on the activity page */
  hostReliability?: Reliability | null;
  /** how many of your buddies (you follow each other) are going or hosting (only on the ranked feed) */
  buddiesGoing?: number;
  /** how many people you follow (who do not follow back) are going or hosting */
  followingGoing?: number;
  favorited?: boolean;
  // detail only
  isHost?: boolean;
  isMember?: boolean;
  /** staff removed it and the host can still ask for a review */
  canAppealRemoval?: boolean;
  myRequest?: { id: string; state: string; /** a declined request can be asked about once more */ canAppeal?: boolean; /** 1 = first in line, when state is waitlisted */ position?: number } | null;
  conversationId?: string | null;
  participants?: Participant[];
  /** the host changed the time or place: this member is asked to confirm they can still come */
  needsReconfirm?: boolean;
  /** hosting was offered to someone: to me (accept or decline) or, for the host, to whom */
  handover?: { toMe: boolean; toName?: string } | null;
  /** my own, voluntary answer once it ended */
  myAttendance?: 'unknown' | 'attended' | 'no_show';
  /** how many activities the host has run or has coming up (cancelled ones excluded) */
  activitiesHosted?: number;
};

export type Trip = {
  id: string;
  /** saved with the heart by the person looking */
  favorited?: boolean;
  title: string;
  destination: string;
  originCity: string;
  dateStart: string;
  dateEnd: string;
  dateFlexibility: string;
  /** tentative, or proposed: the final dates were put to the group and every member must still confirm them */
  datesState?: string;
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
  canAppealRemoval?: boolean;
  myApplication?: { id: string; state: string; message: string; canAppeal?: boolean } | null;
  conversationId?: string | null;
  participants?: Participant[];
  datesConfirmedCount?: number;
  myDatesConfirmed?: boolean;
  /** your circle going on this trip: buddies, and people you follow */
  buddiesGoing?: number;
  followingGoing?: number;
};

export type Notif = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { activityId?: string; tripId?: string; conversationId?: string; warningId?: string; messageId?: string; /** which product it is about; missing means both */ product?: 'here' | 'there' } | null;
  readAt: string | null;
  createdAt: string;
};

/** "Group info": what the group is and who is in it. The host is the group admin. */
export type GroupInfo = {
  id: string;
  scope: 'activity' | 'trip' | 'match';
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

export type ConversationRef = { conversationId: string; scope: 'activity' | 'trip' | 'match'; scopeId: string; title: string; category?: string | null; startsAt?: string; endsAt?: string; /** the newest message: who wrote it ("You" for yours), the first 140 characters and when */ lastMessage?: { body: string; at: string; from: string | null } | null };
