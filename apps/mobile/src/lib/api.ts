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
export const setUnauthorizedHandler = (fn: () => void) => (onUnauthorized = fn);

// how many changes (anything but a read) this person has made: screens use it to know whether what they show can be stale
let writes = 0;
export const writeCount = () => writes;

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== 'GET') writes++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  let res: Response;
  const known = method === 'GET' ? etags.get(path) : undefined;
  const deviceHeader = await deviceId();
  try {
    res = await fetch(API_URL + path, {
      method,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-device-id': deviceHeader, ...(known ? { 'if-none-match': known.tag } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', "Can't reach the server right now. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 304 && known) return known.data as T; // nothing changed since the last time
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
  data: { activityId?: string; tripId?: string; conversationId?: string; warningId?: string; messageId?: string } | null;
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
