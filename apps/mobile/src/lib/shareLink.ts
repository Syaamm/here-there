import { API_URL } from './api';

/**
 * Shared links. A shared activity is `<site>/a/<id>` and a shared trip `<site>/t/<id>`. The site is our own domain in a real
 * build (EXPO_PUBLIC_SHARE_URL); until there is one it is the API's own address, which serves the same pages.
 *
 * Where the app is installed the phone opens the app on such a link; where it is not, the page sends the person to the App
 * Store or Google Play (see the API's share page).
 */
const SITE = (process.env.EXPO_PUBLIC_SHARE_URL || API_URL).replace(/\/+$/, '');

export const shareLink = (kind: 'activity' | 'trip', id: string) => `${SITE}/${kind === 'activity' ? 'a' : 't'}/${encodeURIComponent(id)}`;

/**
 * What an incoming address means inside the app: the screen to open, or null when it is not a shared link. It reads
 * `https://<site>/a/<id>`, `herethere://a/<id>` and a bare `/a/<id>`, and nothing else (the id is letters, digits, - and _).
 */
export function linkTarget(raw: string): string | null {
  const m = /^(?:herethere:\/\/|https?:\/\/[^/?#]+\/|\/)?(a|t)\/([A-Za-z0-9_-]{1,64})\/?(?:[?#].*)?$/i.exec((raw ?? '').trim());
  return m ? `/${m[1].toLowerCase() === 'a' ? 'activity' : 'trip'}/${m[2]}` : null;
}

// A link tapped while signed out is kept here, so signing in carries on to it instead of the home page.
const KEEP_MS = 30 * 60 * 1000;
let pending: { target: string; at: number } | null = null;
export const rememberLink = (target: string) => {
  pending = { target, at: Date.now() };
};
export const forgetLink = () => {
  pending = null;
};
/** The link waiting for the person to sign in, once (and only if it is recent). */
export function takeLink() {
  const p = pending;
  pending = null;
  return p && Date.now() - p.at < KEEP_MS ? p.target : null;
}
