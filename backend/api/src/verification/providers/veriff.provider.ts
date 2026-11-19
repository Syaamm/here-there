import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../common/errors';
import { setting } from '../../common/integration-config';
import { ageFrom } from './persona.provider';
import type { IdentityProvider, ProviderOutcome, WebhookHeaders } from './types';

/**
 * Veriff (veriff.com), through its hosted flow: we create a "session" for the person, Veriff hosts the page where they photograph
 * their ID and take a selfie, and Veriff tells us the decision by a signed webhook.
 *
 * DATA MINIMISATION (see types.ts): the ID images, selfie, name and birth date stay with Veriff. From a decision we read only the
 * session id, the outcome, a reason class, and one yes/no answer to "is this person 18 or older?", worked out from a birth date
 * that is dropped on the spot. Once we hold the outcome the session is deleted at Veriff (see eraseSession).
 *
 * Settings (Settings > Integrations, or environment):
 *   VERIFF_API_KEY        the integration's API key (sent as X-AUTH-CLIENT). A secret.
 *   VERIFF_API_SECRET     the integration's shared secret key: signs webhooks and requests (HMAC-SHA256). A secret.
 *   VERIFF_REDIRECT_URI   where Veriff sends the person's browser when they finish (optional, HTTPS)
 *   VERIFF_BASE_URL       API address (default https://stationapi.veriff.com)
 *   VERIFF_REDACT         "false" keeps the session's personal data at Veriff after the decision (testing only)
 *   VERIFF_ENFORCES_18    "true" when the account refuses under-18s and sends no birth date
 *
 * AGE: an approval counts as "adult" only when it can be shown: the decision carries a birth date and the person is 18 or older,
 * or VERIFF_ENFORCES_18=true says the account refuses under-18s. Otherwise it is not accepted (and logged).
 */
const DEFAULT_BASE = 'https://stationapi.veriff.com';
const env = (k: string) => setting('verification', k);
const base = () => (env('VERIFF_BASE_URL') || DEFAULT_BASE).replace(/\/$/, '');
const sign = (payload: string | Buffer) => createHmac('sha256', env('VERIFF_API_SECRET')).update(payload).digest('hex');
const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

export class VeriffProvider implements IdentityProvider {
  readonly name = 'veriff';

  /** Refuses to start the API in production with Veriff switched on but not set up. */
  assertReady() {
    const missing = ['VERIFF_API_KEY', 'VERIFF_API_SECRET'].filter((k) => !env(k));
    if (missing.length) throw new Error(`VERIFICATION_MODE=veriff needs ${missing.join(', ')}`);
  }

  private async call(method: string, path: string, headers: Record<string, string>, body?: unknown) {
    let res: Response;
    try {
      res = await fetch(`${base()}${path}`, { method, headers: { 'X-AUTH-CLIENT': env('VERIFF_API_KEY'), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service could not be reached. Please try again in a moment.');
    }
    if (!res.ok) {
      // the provider's own error text can name people or documents: it is logged without the body, never shown or stored
      console.error(`Veriff ${method} ${path.replace(/[A-Za-z0-9-]{16,}/, ':id')} answered ${res.status}`);
      throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service could not start the check. Please try again in a moment.');
    }
    return res.json().catch(() => ({}));
  }

  async createSession(user: { id: string; email: string }) {
    this.assertReady();
    const redirect = env('VERIFF_REDIRECT_URI');
    // our own user id is the reference (it names no one); no name or email is sent, the person types what Veriff asks for
    const out: any = await this.call('POST', '/v1/sessions', {}, { verification: { vendorData: user.id, ...(redirect ? { callback: redirect } : {}) } });
    const id = out?.verification?.id;
    const url = out?.verification?.url;
    if (typeof id !== 'string' || !SESSION_ID.test(id) || typeof url !== 'string' || !/^https:\/\//.test(url)) throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service gave an unexpected answer. Please try again.');
    return { providerRef: id, url };
  }

  /** Deletes the session at Veriff: its personal data (ID images, selfie, name, birth date) is erased for good. */
  async eraseSession(providerRef: string) {
    if (env('VERIFF_REDACT').toLowerCase() === 'false' || !SESSION_ID.test(providerRef)) return;
    await this.call('DELETE', `/v1/sessions/${providerRef}`, { 'X-HMAC-SIGNATURE': sign(providerRef) });
  }

  /** Checks Veriff's signature: `X-HMAC-SIGNATURE` is the hex HMAC-SHA256 of the raw body with the shared secret key. */
  private verify(raw: Buffer, header: string) {
    const got = header.trim().toLowerCase();
    if (!env('VERIFF_API_SECRET') || !/^[0-9a-f]{64}$/.test(got) || !timingSafeEqual(Buffer.from(got), Buffer.from(sign(raw)))) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is not valid');
  }

  parseWebhook(raw: Buffer, headers: WebhookHeaders): ProviderOutcome | null {
    const sig = headers['x-hmac-signature'];
    this.verify(raw, Array.isArray(sig) ? sig[0] : String(sig ?? ''));
    let body: any;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'Webhook body is not valid JSON');
    }
    // Veriff also sends event notices (started, submitted): they carry `action` and decide nothing
    if (body?.action && !body?.verification) return null;
    const v = body?.verification;
    if (!v || typeof v.id !== 'string' || !SESSION_ID.test(v.id)) throw new ApiError(400, 'INVALID_PAYLOAD', 'Unknown webhook payload');
    return this.outcomeOf(v);
  }

  /** Asks Veriff where a session stands, for when its webhook did not arrive: the same decision a webhook would carry, or null while undecided. */
  async lookup(providerRef: string): Promise<ProviderOutcome | null> {
    if (!SESSION_ID.test(providerRef)) return null;
    const out: any = await this.call('GET', `/v1/sessions/${providerRef}/decision`, { 'X-HMAC-SIGNATURE': sign(providerRef) });
    const v = out?.verification;
    return v && typeof v.status === 'string' ? this.outcomeOf({ ...v, id: v.id ?? providerRef }) : null;
  }

  private outcomeOf(v: any): ProviderOutcome | null {
    const providerRef: string = v.id;
    const age = ageFrom(v.person?.dateOfBirth); // the date itself goes no further than this function
    const reason = (): ProviderOutcome['reason'] => {
      const text = `${v.reason ?? ''} ${v.reasonCode ?? ''}`.toLowerCase();
      if (/face|selfie|live|spoof|video/.test(text)) return 'liveness';
      if (/fraud|forg|fake|tamper/.test(text)) return 'fraud';
      return 'document';
    };
    switch (v.status) {
      case 'approved': {
        if (age !== null && age < 18) return { providerRef, result: 'declined', adult: false, reason: 'underage' };
        const adult = age !== null ? age >= 18 : env('VERIFF_ENFORCES_18').toLowerCase() === 'true' ? true : undefined;
        if (adult !== true) {
          // approved, but nothing shows the person is an adult: never accept that silently
          console.error('Veriff approved a session with no birth date and VERIFF_ENFORCES_18 is not set: it was not accepted. Ask Veriff to return the date of birth, or set the account to refuse under-18s.');
          return { providerRef, result: 'declined', reason: 'other' };
        }
        return { providerRef, result: 'approved', adult: true };
      }
      case 'declined':
        return { providerRef, result: 'declined', ...(age !== null && age < 18 ? { adult: false } : {}), reason: age !== null && age < 18 ? 'underage' : reason() };
      case 'resubmission_requested':
      case 'expired':
      case 'abandoned':
        return { providerRef, result: 'needs_resubmission' };
      default:
        return null; // review, created, started, submitted: nothing to decide yet
    }
  }
}
