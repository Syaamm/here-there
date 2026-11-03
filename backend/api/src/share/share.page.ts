/**
 * The page a shared link opens in a browser: https://<our domain>/a/<id> for an activity, /t/<id> for a trip.
 *
 * Where the app is installed, the phone opens the app on that link and this page is never seen (iOS Universal Links and
 * Android App Links, switched on by the two files in .well-known). This page is for everyone else: on an iPhone it goes to
 * the App Store, on Android to Google Play, and on a computer it shows both. It carries only what any signed-out visitor may
 * see: the title, the day and the city. Never a venue, a host, a member or anything private.
 */

export type Platform = 'ios' | 'android' | 'other';

export type ShareConfig = {
  appStoreUrl: string | null;
  playStoreUrl: string | null;
  androidPackage: string;
  scheme: string;
  timeZone: string;
};

/** The page's settings, from the environment. The store addresses stay empty until the app is listed. */
export function shareConfig(env: Record<string, string | undefined> = process.env): ShareConfig {
  const https = (v: string | undefined) => (v && /^https:\/\//i.test(v.trim()) ? v.trim() : null);
  return {
    appStoreUrl: https(env.APP_STORE_URL),
    playStoreUrl: https(env.PLAY_STORE_URL),
    androidPackage: env.ANDROID_PACKAGE?.trim() || 'io.herethere.app',
    scheme: env.APP_SCHEME?.trim() || 'herethere',
    timeZone: env.SHARE_TIMEZONE?.trim() || 'Europe/Rome',
  };
}

export const platformOf = (ua: string | undefined): Platform => (/iPhone|iPad|iPod/i.test(ua ?? '') ? 'ios' : /Android/i.test(ua ?? '') ? 'android' : 'other');

/** What the page says about the plan. `null` is "nothing to show" (it does not exist, is not public, or is over). */
export type ShareItem = { kind: 'activity' | 'trip'; id: string; title: string; lines: string[] } | null;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Only plans that are still on, and open to anyone, are described. Anything else looks the same as a plan that never existed. */
export const ACTIVITY_SHAREABLE = ['published', 'full', 'confirmed']; // and it has not started yet (the share page checks the time too)
export const TRIP_SHAREABLE = ['published', 'full', 'planning', 'confirmed'];

const dayFormat = (d: Date, tz: string, withTime: boolean) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: tz }).format(d);

export function activityLines(a: { startsAt: Date; city: string }, tz: string) {
  return [dayFormat(a.startsAt, tz, true), a.city];
}

export function tripLines(t: { destination: string; dateStart: Date; dateEnd: Date }, tz: string) {
  const short = (d: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(d);
  const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: tz }).format(t.dateEnd);
  return [t.destination, `${short(t.dateStart)} to ${short(t.dateEnd)} ${year}`];
}

/** The address that opens this plan inside the app (the app maps it to the right screen). */
export const appLink = (cfg: ShareConfig, kind: 'activity' | 'trip', id: string) => `${cfg.scheme}://${kind === 'activity' ? 'a' : 't'}/${encodeURIComponent(id)}`;

/** Android: open the app if it is installed, otherwise go to Google Play (the phone decides, nothing is guessed). */
export function androidIntent(cfg: ShareConfig, kind: 'activity' | 'trip', id: string) {
  const path = `${kind === 'activity' ? 'a' : 't'}/${encodeURIComponent(id)}`;
  const fallback = cfg.playStoreUrl ? `;S.browser_fallback_url=${encodeURIComponent(cfg.playStoreUrl)}` : '';
  return `intent://${path}#Intent;scheme=${cfg.scheme};package=${cfg.androidPackage}${fallback};end`;
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:#E9E5DD;color:#102F29;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:440px}.brand{font-weight:800;letter-spacing:.04em;font-size:14px;margin:0 0 14px;color:#24604D}
.card{background:#F4F1EA;border:1px solid #DAD2BE;border-radius:22px;padding:22px}
.kind{display:inline-block;background:#DAD2BE;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:800;margin:0 0 12px}
h1{font-size:24px;line-height:1.25;margin:0 0 8px}p{margin:0 0 6px}.muted{color:#4d625c;font-size:14px}
.btns{display:flex;flex-direction:column;gap:10px;margin-top:18px}
a.btn{display:block;text-align:center;text-decoration:none;font-weight:800;border-radius:14px;padding:13px 16px;border:1.5px solid #102F29}
a.primary{background:#102F29;color:#fff}a.secondary{background:transparent;color:#102F29}
.small{font-size:13px;color:#4d625c;margin-top:14px}
`;

/**
 * The whole page. `ua` is the visitor's browser, used only to tell an iPhone from an Android phone from a computer.
 * On a phone, with the matching store address set, the page also moves on to the store by itself after a moment (a plain
 * meta refresh: the page runs no scripts at all).
 */
export function renderSharePage(kind: 'activity' | 'trip', id: string, item: ShareItem, ua: string | undefined, cfg: ShareConfig) {
  const platform = platformOf(ua);
  const store = platform === 'ios' ? cfg.appStoreUrl : platform === 'android' ? cfg.playStoreUrl : null;
  const title = item?.title ?? (kind === 'activity' ? 'This activity is not available' : 'This trip is not available');
  const lines = item?.lines ?? ['It may have ended, been cancelled, or be private.'];
  const open = platform === 'android' ? androidIntent(cfg, kind, id) : appLink(cfg, kind, id);
  const kindLabel = kind === 'activity' ? 'Activity on HERE' : 'Trip on THERE';

  const buttons: string[] = [];
  if (platform === 'other') {
    if (cfg.appStoreUrl) buttons.push(`<a class="btn primary" href="${esc(cfg.appStoreUrl)}">Download on the App Store</a>`);
    if (cfg.playStoreUrl) buttons.push(`<a class="btn ${cfg.appStoreUrl ? 'secondary' : 'primary'}" href="${esc(cfg.playStoreUrl)}">Get it on Google Play</a>`);
  } else {
    if (store) buttons.push(`<a class="btn primary" href="${esc(store)}">${platform === 'ios' ? 'Get the app on the App Store' : 'Get the app on Google Play'}</a>`);
    buttons.push(`<a class="btn ${store ? 'secondary' : 'primary'}" href="${esc(open)}">I have the app: open it</a>`);
  }
  const note =
    platform === 'other'
      ? cfg.appStoreUrl || cfg.playStoreUrl
        ? 'Open this link on your phone to see it in the app.'
        : 'HERE &amp; THERE is coming soon to the App Store and Google Play.'
      : store
        ? `Taking you to ${platform === 'ios' ? 'the App Store' : 'Google Play'} in a moment…`
        : 'HERE &amp; THERE is coming soon to the App Store and Google Play.';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · HERE &amp; THERE</title>
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta property="og:site_name" content="HERE &amp; THERE"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${item ? esc(lines.join(' · ')) : 'Meet people in HERE &amp; THERE.'}">
${item && store ? `<meta http-equiv="refresh" content="2;url=${esc(store)}">` : ''}
<style>${STYLE}</style></head>
<body><main><p class="brand">HERE &amp; THERE</p>
<div class="card"><span class="kind">${kindLabel}</span><h1>${esc(title)}</h1>${lines.map((l) => `<p class="muted">${esc(l)}</p>`).join('')}
<div class="btns">${buttons.join('')}</div><p class="small">${note}</p></div></main></body></html>`;
  return { status: item ? 200 : 404, html };
}

/** apple-app-site-association: which paths on this domain open the app on an iPhone. `null` until the Apple team id is known. */
export function appleAssociation(env: Record<string, string | undefined> = process.env) {
  const team = env.APPLE_TEAM_ID?.trim();
  if (!team) return null;
  const appId = `${team}.${env.IOS_BUNDLE_ID?.trim() || 'io.herethere.app'}`;
  return {
    applinks: {
      details: [
        { appIDs: [appId], components: [{ '/': '/a/*' }, { '/': '/t/*' }] },
        // iOS 12 and older read this form
        { appID: appId, paths: ['/a/*', '/t/*'] },
      ],
    },
  };
}

/** assetlinks.json: which app Android may open for this domain. `null` until the app signing fingerprint is known. */
export function androidAssociation(env: Record<string, string | undefined> = process.env) {
  const prints = (env.ANDROID_CERT_SHA256 ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!prints.length) return null;
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: env.ANDROID_PACKAGE?.trim() || 'io.herethere.app', sha256_cert_fingerprints: prints } }];
}
