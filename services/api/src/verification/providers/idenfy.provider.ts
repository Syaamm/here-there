import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../common/errors';
import { ageFrom } from './persona.provider';
import type { IdentityProvider, ProviderOutcome, WebhookHeaders } from './types';

/**
 * iDenfy (idenfy.com, Lithuania, data kept in EU data centres), through its hosted verification page: we create a session
 * for the person, iDenfy hosts the page where they photograph their ID (and, for the face route, take a selfie), and iDenfy
 * tells us the outcome by a signed webhook.
 *
 * DATA MINIMISATION (see types.ts): the ID images, selfie, name and birth date stay with iDenfy. From a result we read only
 * the scan reference, the outcome, the reason class, and one yes/no answer to "is this person 18 or older?", worked out from
 * a birth date that is dropped on the spot. Once we hold the outcome the personal data is deleted at iDenfy (see eraseSession).
 *
 * Settings (environment):
 *   IDENFY_API_KEY, IDENFY_API_SECRET   the API key pair (the pair decides sandbox or live). Secrets.
 *   IDENFY_WEBHOOK_SECRET               the signing key set on the webhook (Settings > System notifications > Signing key).
 *                                       A secret. Several, comma separated, while a key is being rotated.
 *   IDENFY_REDIRECT_URI                 where iDenfy sends the person's browser when they finish (optional, HTTPS)
 *   IDENFY_BASE_URL                     API address (default https://ivs.idenfy.com)
 *   IDENFY_REDACT                       "false" keeps the personal data at iDenfy after the decision (testing only)
 *   IDENFY_ENFORCES_18                  "true" when the account refuses under-18s and sends no birth date (see "age" below)
 *
 * ROUTES: the face route asks for tokenType IDENTIFICATION (document + selfie); the document route asks for DOCUMENT
 * (document only: no selfie, no face match, nothing biometric). We also send ageLimit 18, so iDenfy itself flags anyone younger.
 *
 * AGE: same rule as every provider. An approval counts as "adult" only when it can be shown: the result carries a birth
 * date and the person is 18 or older, or IDENFY_ENFORCES_18=true says the account refuses under-18s. Otherwise it is declined
 * and logged. An under-age person must never be marked verified by accident.
 *
 * Signing: iDenfy sends `Idenfy-Signature`, the hex HMAC-SHA256 of the raw body under the signing key. It carries no
 * timestamp, so a replayed message cannot be told apart by age; it is harmless because a decided check ignores later messages.
 */
const DEFAULT_BASE = 'https://ivs.idenfy.com';
const REASONS = ['underage', 'document', 'liveness', 'fraud', 'other'] as const;
const LOOKUP_EVERY_MS = 30_000; // iDenfy asks that its status address is not polled: this is only the safety net

const env = (k: string) => (process.env[k] ?? '').trim();
const base = () => (env('IDENFY_BASE_URL') || DEFAULT_BASE).replace(/\/$/, '');

type Result = {
  scanRef: string;
  overall: string;
  final: boolean;
  fraudTags: string[];
  mismatchTags: string[];
  autoFace: string;
  manualFace: string;
  docDob: unknown;
};

export class IdenfyProvider implements IdentityProvider {
  readonly name = 'idenfy';
  private lastLookup = new Map<string, number>();

  /** Refuses to start the API in production with iDenfy switched on but not set up. */
  assertReady() {
    const missing = ['IDENFY_API_KEY', 'IDENFY_API_SECRET', 'IDENFY_WEBHOOK_SECRET'].filter((k) => !env(k));
    if (missing.length) throw new Error(`VERIFICATION_MODE=idenfy needs ${missing.join(', ')}`);
  }

  private async call(path: string, body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${base()}${path}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${env('IDENFY_API_KEY')}:${env('IDENFY_API_SECRET')}`).toString('base64')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service could not be reached. Please try again in a moment.');
    }
    if (!res.ok) {
      // the provider's own error text can name people or documents: it is logged without the body, never shown or stored
      console.error(`iDenfy POST ${path} answered ${res.status}`);
      throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service could not start the check. Please try again in a moment.');
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  async createSession(user: { id: string; email: string }, ctx: { checkId: string; baseUrl: string; method: 'face' | 'document' }) {
    this.assertReady();
    const redirect = env('IDENFY_REDIRECT_URI');
    const out = await this.call('/api/v2/token', {
      // our own user id is the client id (it names no one), so the person can be found in the iDenfy dashboard if support needs it
      clientId: user.id,
      externalRef: ctx.checkId.slice(0, 40),
      tokenType: ctx.method === 'document' ? 'DOCUMENT' : 'IDENTIFICATION',
      ageLimit: 18,
      ...(/^https:\/\//.test(redirect) ? { successUrl: redirect, errorUrl: redirect, unverifiedUrl: redirect } : {}),
    });
    const scanRef = out?.scanRef;
    const token = out?.authToken;
    // iDenfy's reply carries the session's token, not a ready link: the hosted page is opened through its redirect address
    if (typeof scanRef !== 'string' || !scanRef || typeof token !== 'string' || !/^[A-Za-z0-9._-]{8,200}$/.test(token)) throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service gave an unexpected answer. Please try again.');
    const url = `${base()}/api/v2/redirect?authToken=${encodeURIComponent(token)}`;
    if (!/^https:\/\//.test(url)) throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service gave an unexpected answer. Please try again.');
    return { providerRef: scanRef, url };
  }

  /** Deletes the person's data at iDenfy: ID images, selfie, parsed document fields, names. A reply of 200 has no body. */
  async eraseSession(providerRef: string) {
    if (env('IDENFY_REDACT').toLowerCase() === 'false' || !/^[A-Za-z0-9-]{8,64}$/.test(providerRef)) return;
    await this.call('/api/v2/delete', { scanRef: providerRef });
  }

  /** Checks the signature: the hex HMAC-SHA256 of the raw body, under any active signing key. */
  private verify(raw: Buffer, header: string) {
    const secrets = env('IDENFY_WEBHOOK_SECRET').split(',').map((s) => s.trim()).filter(Boolean);
    const got = header.trim().toLowerCase();
    if (!secrets.length || !/^[0-9a-f]{64}$/.test(got)) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is not valid');
    for (const secret of secrets) {
      const want = createHmac('sha256', secret).update(raw).digest('hex');
      if (timingSafeEqual(Buffer.from(got), Buffer.from(want))) return;
    }
    throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is not valid');
  }

  parseWebhook(raw: Buffer, headers: WebhookHeaders): ProviderOutcome | null {
    const sig = headers['idenfy-signature'];
    this.verify(raw, Array.isArray(sig) ? sig.join('') : String(sig ?? ''));

    let body: any;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'Webhook body is not valid JSON');
    }
    const eventHeader = headers['idenfy-event-type'];
    const event = Array.isArray(eventHeader) ? eventHeader[0] : eventHeader;
    // a person who walked away, or a session nobody used, decides nothing: the check stays open until they cancel or retry
    if (event === 'IDENTIFICATION_CANCELLED') return null;
    if (typeof body?.scanRef !== 'string' || !body.scanRef) throw new ApiError(400, 'INVALID_PAYLOAD', 'Unknown webhook payload');
    return this.outcomeOf({
      scanRef: body.scanRef,
      overall: String(body?.status?.overall ?? ''),
      final: body?.final !== false, // a preliminary result (manual review still to come) is "final: false"
      fraudTags: Array.isArray(body?.status?.fraudTags) ? body.status.fraudTags : [],
      mismatchTags: Array.isArray(body?.status?.mismatchTags) ? body.status.mismatchTags : [],
      autoFace: String(body?.status?.autoFace ?? ''),
      manualFace: String(body?.status?.manualFace ?? ''),
      docDob: body?.data?.docDob,
    });
  }

  /**
   * Asks iDenfy where a session stands, for when its webhook did not arrive (a tunnel or server that was down). It is a
   * safety net, not a poll: at most once every 30 seconds per check. Null while nothing is decided yet.
   */
  async lookup(providerRef: string): Promise<ProviderOutcome | null> {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(providerRef)) return null;
    const now = Date.now();
    if (now - (this.lastLookup.get(providerRef) ?? 0) < LOOKUP_EVERY_MS) return null;
    this.lastLookup.set(providerRef, now);
    if (this.lastLookup.size > 1000) this.lastLookup.clear();
    const s = await this.call('/api/v2/status', { scanRef: providerRef });
    const overall = String(s?.status ?? '');
    if (!['APPROVED', 'DENIED', 'SUSPECTED', 'EXPIRED'].includes(overall)) return null;
    let docDob: unknown;
    if (overall === 'APPROVED') docDob = (await this.call('/api/v2/data', { scanRef: providerRef }))?.docDob;
    return this.outcomeOf({
      scanRef: providerRef,
      overall,
      final: true,
      fraudTags: Array.isArray(s?.fraudTags) ? s.fraudTags : [],
      mismatchTags: Array.isArray(s?.mismatchTags) ? s.mismatchTags : [],
      autoFace: String(s?.autoFace ?? ''),
      manualFace: String(s?.manualFace ?? ''),
      docDob,
    });
  }

  private outcomeOf(r: Result): ProviderOutcome | null {
    const providerRef = r.scanRef;
    const age = ageFrom(r.docDob); // the date itself goes no further than this function
    const underage = r.mismatchTags.includes('UNDER_AGE') || (age !== null && age < 18);
    const reasonOf = (): ProviderOutcome['reason'] => {
      if (underage) return 'underage';
      const face = [r.autoFace, r.manualFace].some((f) => ['FACE_MISMATCH', 'NO_FACE_FOUND', 'TOO_MANY_FACES', 'FACE_TOO_BLURRY', 'FACE_GLARED', 'FACE_UNCERTAIN', 'FAKE_FACE'].includes(f));
      const reason = face ? 'liveness' : r.fraudTags.length ? 'fraud' : 'document';
      return (REASONS as readonly string[]).includes(reason) ? reason : 'other';
    };

    switch (r.overall) {
      case 'APPROVED': {
        if (!r.final) return null; // preliminary: manual review is still to come
        if (underage) return { providerRef, result: 'declined', adult: false, reason: 'underage' };
        const adult = age !== null ? age >= 18 : env('IDENFY_ENFORCES_18').toLowerCase() === 'true' ? true : undefined;
        if (adult !== true) {
          // approved, but nothing shows the person is an adult: never accept that silently
          console.error('iDenfy approved a verification with no birth date and IDENFY_ENFORCES_18 is not set: it was not accepted.');
          return { providerRef, result: 'declined', reason: 'other' };
        }
        return { providerRef, result: 'approved', adult: true };
      }
      case 'DENIED':
      case 'SUSPECTED': // flagged (fraud signs, under the age limit...): not accepted; staff can reopen it from the admin console
        if (!r.final) return null;
        return { providerRef, result: 'declined', reason: reasonOf() };
      case 'EXPIRED':
        return { providerRef, result: 'needs_resubmission' };
      default:
        return null; // active, reviewing, archived, deleted: nothing to decide yet
    }
  }
}
