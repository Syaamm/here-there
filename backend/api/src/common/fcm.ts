import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Phone push through Firebase Cloud Messaging (FCM, HTTP v1) for iPhone and Android alike. No extra package: the server signs
 * a short login with the Firebase service account (RS256), swaps it for an access token and posts the message.
 *
 * Settings (both optional; without them nothing is sent and nothing breaks):
 *   FIREBASE_SERVICE_ACCOUNT_JSON   the service account key file's content (one line of JSON)
 *   FIREBASE_SERVICE_ACCOUNT_FILE   or the path to that file
 */
type Account = { project_id: string; client_email: string; private_key: string };

let account: Account | null | undefined;
let cached: { token: string; expiresAt: number } | null = null;
let warned = false;

/** The service account, or null when Firebase is not set up here. Read once. */
export function fcmAccount(): Account | null {
  if (account !== undefined) return account;
  account = null;
  try {
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
    const raw = inline || (file && existsSync(file) ? readFileSync(file, 'utf8') : '');
    if (raw) {
      const j = JSON.parse(raw) as Partial<Account>;
      if (j.project_id && j.client_email && j.private_key) account = { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, '\n') };
    }
  } catch {
    account = null;
  }
  return account;
}

/** For tests: forget what was read and cached. */
export function resetFcm() {
  account = undefined;
  cached = null;
  warned = false;
}

const b64 = (v: object | Buffer) => Buffer.from(v instanceof Buffer ? v : JSON.stringify(v)).toString('base64url');

async function accessToken(a: Account): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - 60 > now) return cached.token;
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const signature = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(a.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64(signature)}` }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cached = { token: j.access_token, expiresAt: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

/** sent: delivered. gone: the device's token is dead, delete it. retry: worth another go. skipped: Firebase is not set up here. */
export type FcmResult = 'sent' | 'gone' | 'retry' | 'skipped';

const refusedOnce = new Set<string>();
const HINT: Record<string, string> = {
  SENDER_ID_MISMATCH: 'the server key (FIREBASE_SERVICE_ACCOUNT_*) belongs to another Firebase project than the one built into the app',
  THIRD_PARTY_AUTH_ERROR: "Apple's push key (.p8) is missing or wrong in Firebase > Project settings > Cloud Messaging (iPhone)",
  PERMISSION_DENIED: 'the service account may not send messages for this Firebase project',
};
function refused(code: string) {
  if (refusedOnce.has(code)) return;
  refusedOnce.add(code);
  console.warn(`Phone push refused by Firebase: ${code}${HINT[code] ? ` (${HINT[code]})` : ''}. Nothing was delivered for this message.`);
}

/** `thread`: pushes about the same thing (one chat) replace each other on Android and are stacked together on iPhone. */
export async function sendFcm(token: string, msg: { title: string; body: string; url?: string; thread?: string }): Promise<FcmResult> {
  const a = fcmAccount();
  if (!a) {
    if (!warned) {
      warned = true;
      console.warn('Phone push (Firebase) is not set up: FIREBASE_SERVICE_ACCOUNT_JSON / _FILE is empty, so no phone push is sent.');
    }
    return 'skipped';
  }
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken(a)}` },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: msg.url || msg.thread ? { ...(msg.url ? { url: msg.url } : {}), ...(msg.thread ? { thread: msg.thread } : {}) } : undefined,
          // icon and colour come from the app (the LAMIS mark, set in app.config.ts), so they are not repeated here
          android: { priority: 'HIGH', notification: { channel_id: 'alerts', sound: 'default', ...(msg.thread ? { tag: msg.thread } : {}) } },
          apns: { payload: { aps: { sound: 'default', ...(msg.thread ? { 'thread-id': msg.thread } : {}) } } },
        },
      }),
    });
    if (res.ok) return 'sent';
    if (res.status === 401) cached = null; // the access token was refused: ask for a new one next time
    if (res.status === 401 || res.status === 429 || res.status >= 500) return 'retry';
    const j = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
    const code = j?.error?.details?.find((d) => d.errorCode)?.errorCode ?? j?.error?.status;
    if (res.status === 404 || code === 'UNREGISTERED' || code === 'NOT_FOUND') return 'gone';
    // any other refusal cannot be fixed by trying again, but it means nothing arrived: say so once per reason, so a set-up
    // problem shows in the logs (SENDER_ID_MISMATCH: the server key is for another Firebase project than the app;
    // THIRD_PARTY_AUTH_ERROR: Apple's push key is missing or wrong in Firebase)
    refused(code ?? String(res.status));
    return 'sent';
  } catch {
    return 'retry'; // no connection to Google
  }
}
