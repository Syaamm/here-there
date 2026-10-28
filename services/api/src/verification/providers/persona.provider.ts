import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError, E } from '../../common/errors';
import type { IdentityProvider, ProviderOutcome, WebhookHeaders } from './types';

/**
 * Persona (withpersona.com), through its Hosted Flow: we create an "inquiry" for the person, Persona hosts the page where
 * they photograph their ID (and, for the face route, take a selfie), and Persona tells us the outcome by a signed webhook.
 *
 * DATA MINIMISATION (see types.ts): the ID images, selfie, name and birth date stay with Persona. From a webhook we read
 * only the inquiry id, the outcome, the reason class, and one yes/no answer to "is this person 18 or older?", worked out
 * from a birth date that is dropped on the spot. Once we hold the outcome the inquiry is redacted at Persona (see eraseSession).
 *
 * Settings (environment):
 *   PERSONA_API_KEY            server-side API key (sandbox key while developing). A secret.
 *   PERSONA_WEBHOOK_SECRET     the webhook secret. A secret. Several, comma separated, while a secret is being rotated.
 *   PERSONA_TEMPLATE_ID        inquiry template for the FACE route: government ID + selfie ("itmpl_...")
 *   PERSONA_TEMPLATE_ID_DOCUMENT   inquiry template for the DOCUMENT route: government ID only, no selfie, nothing biometric
 *   PERSONA_VERSION            API version header (default below)
 *   PERSONA_REDIRECT_URI       where Persona sends the person's browser when they finish (optional)
 *   PERSONA_REDACT             "false" keeps the inquiry's personal data at Persona after the decision (testing only)
 *   PERSONA_TEMPLATE_ENFORCES_18   "true" when the template itself refuses people under 18 (see "age" below)
 *
 * AGE: an approval counts as "adult" only when it can be shown. Either the payload carries a birth date (read from the
 * template's `birthdate` field or from the government ID verification) and the person is 18 or older, or the template is
 * set up to refuse under-18s and PERSONA_TEMPLATE_ENFORCES_18=true says so. Otherwise an approval is not accepted (it is
 * logged, so the template can be fixed): an under-age person must never be marked verified by accident.
 */
const API = 'https://api.withpersona.com/api/v1';
const DEFAULT_VERSION = '2026-09-29';
const TOLERANCE_SECONDS = 5 * 60; // a signed message older than this is refused (replay protection; Persona gives no window)
const REASONS = ['underage', 'document', 'liveness', 'fraud', 'other'] as const;

const env = (k: string) => (process.env[k] ?? '').trim();

/** Persona writes keys in kebab-case, but the style can be changed: read camelCase and snake_case the same way. */
const kebab = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
function normalise(v: unknown): any {
  if (Array.isArray(v)) return v.map(normalise);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [kebab(k), normalise(x)]));
  return v;
}

/** Full years between a YYYY-MM-DD birth date and now, or null when it is not a date. */
export function ageFrom(birthdate: unknown, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birthdate ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(y > 1900) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age;
}

export class PersonaProvider implements IdentityProvider {
  readonly name = 'persona';

  /** Refuses to start the API in production with Persona switched on but not set up. */
  assertReady() {
    const missing = ['PERSONA_API_KEY', 'PERSONA_WEBHOOK_SECRET', 'PERSONA_TEMPLATE_ID'].filter((k) => !env(k));
    if (missing.length) throw new Error(`VERIFICATION_MODE=persona needs ${missing.join(', ')}`);
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${env('PERSONA_API_KEY')}`,
      'Content-Type': 'application/json',
      'Persona-Version': env('PERSONA_VERSION') || DEFAULT_VERSION,
      'Key-Inflection': 'kebab',
      ...extra,
    };
  }

  private async call(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, { method, headers: this.headers(extra), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service could not be reached. Please try again in a moment.');
    }
    if (!res.ok) {
      // the provider's own error text can name people or documents: it is logged without the body, never shown or stored
      console.error(`Persona ${method} ${path} answered ${res.status}`);
      throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service could not start the check. Please try again in a moment.');
    }
    return normalise(await res.json());
  }

  async createSession(user: { id: string; email: string }, ctx: { checkId: string; baseUrl: string; method: 'face' | 'document' }) {
    this.assertReady();
    const template = ctx.method === 'document' ? env('PERSONA_TEMPLATE_ID_DOCUMENT') : env('PERSONA_TEMPLATE_ID');
    if (!template) throw E.badRequest('VERIFICATION_METHOD_UNAVAILABLE', 'This kind of identity check is not available right now');
    const out = await this.call(
      'POST',
      '/inquiries',
      {
        data: { attributes: { 'inquiry-template-id': template, ...(env('PERSONA_REDIRECT_URI') ? { 'redirect-uri': env('PERSONA_REDIRECT_URI') } : {}) } },
        // our own user id is the reference (it names no one), so the person can be found in the Persona dashboard if support needs it
        meta: { 'auto-create-account-reference-id': user.id, 'auto-create-one-time-link': true },
      },
      { 'Idempotency-Key': `verification-${ctx.checkId}` },
    );
    const id = out?.data?.id;
    const url = out?.meta?.['one-time-link'];
    if (typeof id !== 'string' || !id.startsWith('inq_') || typeof url !== 'string' || !/^https:\/\//.test(url)) throw new ApiError(502, 'VERIFICATION_UNAVAILABLE', 'The identity check service gave an unexpected answer. Please try again.');
    return { providerRef: id, url };
  }

  /** A person who closed the page continues: Persona's links work once, so a fresh one is made for the same inquiry. */
  async resumeUrl(providerRef: string) {
    if (!/^inq_[A-Za-z0-9]+$/.test(providerRef)) return undefined;
    try {
      const out = await this.call('POST', `/inquiries/${providerRef}/generate-one-time-link`, { meta: { 'expires-in-seconds': 3600 } });
      const url = out?.meta?.['one-time-link'];
      return typeof url === 'string' && /^https:\/\//.test(url) ? url : undefined;
    } catch {
      return undefined; // the person can cancel and start again
    }
  }

  /** Redacts the inquiry at Persona: its personal data (ID images, selfie, name, birth date) is deleted for good. */
  async eraseSession(providerRef: string) {
    if (env('PERSONA_REDACT').toLowerCase() === 'false' || !/^inq_[A-Za-z0-9]+$/.test(providerRef)) return;
    await this.call('DELETE', `/inquiries/${providerRef}`);
  }

  /** Checks Persona's signature: `Persona-Signature: t=<unix time>,v1=<hex>` (one such pair per active secret, space separated). */
  private verify(raw: Buffer, header: string) {
    const secrets = env('PERSONA_WEBHOOK_SECRET').split(',').map((s) => s.trim()).filter(Boolean);
    if (!secrets.length) throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is not valid');
    for (const set of header.split(/\s+/).filter(Boolean)) {
      const parts = Object.fromEntries(set.split(',').map((p) => p.split(/=(.*)/s).slice(0, 2) as [string, string]));
      const t = parts.t;
      const v1 = parts.v1;
      if (!t || !v1 || !/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/i.test(v1)) continue;
      if (Math.abs(Date.now() / 1000 - Number(t)) > TOLERANCE_SECONDS) continue; // stale: could be a replay
      for (const secret of secrets) {
        const want = createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
        if (timingSafeEqual(Buffer.from(v1.toLowerCase()), Buffer.from(want))) return;
      }
    }
    throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is not valid');
  }

  parseWebhook(raw: Buffer, headers: WebhookHeaders): ProviderOutcome | null {
    const sig = headers['persona-signature'];
    this.verify(raw, Array.isArray(sig) ? sig.join(' ') : String(sig ?? ''));

    let body: any;
    try {
      body = normalise(JSON.parse(raw.toString('utf8')));
    } catch {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'Webhook body is not valid JSON');
    }
    const event = body?.data?.attributes?.name;
    const inquiry = body?.data?.attributes?.payload?.data;
    if (typeof event !== 'string' || inquiry?.type !== 'inquiry' || typeof inquiry?.id !== 'string' || !inquiry.id.startsWith('inq_'))
      throw new ApiError(400, 'INVALID_PAYLOAD', 'Unknown webhook payload');
    return this.outcomeOf(event, inquiry, Array.isArray(body.data.attributes.payload.included) ? body.data.attributes.payload.included : []);
  }

  /**
   * Asks Persona where an inquiry stands, for when its webhook did not arrive (a tunnel or server that was down):
   * the same decision a webhook would have produced, or null while nothing is decided yet.
   */
  async lookup(providerRef: string): Promise<ProviderOutcome | null> {
    if (!/^inq_[A-Za-z0-9]+$/.test(providerRef)) return null;
    const out = await this.call('GET', `/inquiries/${providerRef}?include=verifications`);
    const inquiry = out?.data;
    const status = inquiry?.attributes?.status;
    if (inquiry?.type !== 'inquiry' || typeof status !== 'string') return null;
    return this.outcomeOf(`inquiry.${status}`, inquiry, Array.isArray(out?.included) ? out.included : []);
  }

  private outcomeOf(event: string, inquiry: any, included: any[]): ProviderOutcome | null {
    const providerRef: string = inquiry.id;
    const checks = included.filter((x) => typeof x?.type === 'string' && x.type.startsWith('verification/'));

    // What the person's age is, if the payload says (the date itself goes no further than this function).
    const birth = inquiry.attributes?.fields?.birthdate?.value ?? checks.map((c) => c?.attributes?.birthdate).find(Boolean);
    const age = ageFrom(birth);
    const adult = age !== null ? age >= 18 : env('PERSONA_TEMPLATE_ENFORCES_18').toLowerCase() === 'true' ? true : undefined;
    const reasonOf = (): ProviderOutcome['reason'] => {
      const failed = checks.filter((c) => ['failed', 'declined'].includes(String(c?.attributes?.status)));
      const kinds = failed.map((c) => String(c.type));
      const reason = kinds.some((k) => k.includes('selfie')) ? 'liveness' : failed.length ? 'document' : 'other';
      return (REASONS as readonly string[]).includes(reason) ? reason : 'other';
    };

    const approve = (): ProviderOutcome | null => {
      if (age !== null && age < 18) return { providerRef, result: 'declined', adult: false, reason: 'underage' };
      if (adult !== true) {
        // approved, but nothing shows the person is an adult: never accept that silently
        console.error('Persona approved an inquiry with no birth date and PERSONA_TEMPLATE_ENFORCES_18 is not set: it was not accepted. Collect the birth date in the template or set the template to refuse under-18s.');
        return { providerRef, result: 'declined', reason: 'other' };
      }
      return { providerRef, result: 'approved', adult: true };
    };

    switch (event) {
      case 'inquiry.approved':
        return approve();
      case 'inquiry.completed': {
        // every check passed, with no human or workflow decision yet: that is an approval when nothing failed
        const passed = checks.length > 0 && checks.every((c) => String(c?.attributes?.status) === 'passed');
        return passed ? approve() : null;
      }
      case 'inquiry.declined':
      case 'inquiry.failed':
        return { providerRef, result: 'declined', reason: age !== null && age < 18 ? 'underage' : reasonOf() };
      case 'inquiry.expired':
        return { providerRef, result: 'needs_resubmission' };
      default:
        return null; // started, created, transitioned, marked-for-review ...: nothing to decide yet
    }
  }
}
