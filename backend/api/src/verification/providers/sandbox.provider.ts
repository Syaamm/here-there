import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../common/errors';
import type { IdentityProvider, ProviderOutcome, WebhookHeaders } from './types';

/**
 * A local stand-in for a real vendor, so the complete flow can be built and tested before keys exist:
 * hosted page -> user decision -> HMAC-signed webhook -> our webhook handler. It uses the exact same path a real
 * provider will. Development only: the API refuses to start in production with VERIFICATION_MODE=sandbox.
 *
 * To add Veriff / Sumsub / Persona: implement IdentityProvider (create a session with their API, verify THEIR
 * webhook signature in parseWebhook, map THEIR statuses to ProviderOutcome) and register it in VerificationService.
 */
const SECRET = process.env.SANDBOX_WEBHOOK_SECRET ?? randomBytes(32).toString('hex');
export const signSandbox = (raw: Buffer | string) => createHmac('sha256', SECRET).update(raw).digest('hex');

const RESULTS = { approved: 'approved', declined: 'declined', resubmission_requested: 'needs_resubmission', revoked: 'revoked' } as const;
const REASONS = ['underage', 'document', 'liveness', 'fraud', 'other'] as const;

export class SandboxProvider implements IdentityProvider {
  readonly name = 'sandbox';

  async createSession(_user: { id: string; email: string }, ctx: { baseUrl: string }) {
    const providerRef = `sbx_${randomUUID()}`;
    return { providerRef, url: this.resumeUrl(providerRef, ctx.baseUrl) };
  }

  resumeUrl(providerRef: string, baseUrl: string) {
    return `${baseUrl}/v1/verification/sandbox/${providerRef}`;
  }

  parseWebhook(raw: Buffer, headers: WebhookHeaders): ProviderOutcome {
    const given = String(headers['x-sandbox-signature'] ?? '');
    const wanted = signSandbox(raw);
    if (given.length !== wanted.length || !timingSafeEqual(Buffer.from(given), Buffer.from(wanted)))
      throw new ApiError(401, 'INVALID_SIGNATURE', 'Webhook signature is not valid');

    let body: any;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'Webhook body is not valid JSON');
    }
    const result = RESULTS[body?.status as keyof typeof RESULTS];
    if (!result || typeof body?.providerRef !== 'string') throw new ApiError(400, 'INVALID_PAYLOAD', 'Unknown webhook payload');

    // Only these fields are read. Anything else a provider sends (names, birth dates, document numbers, images)
    // is dropped here and never reaches our code or our database.
    return {
      providerRef: body.providerRef,
      result,
      adult: typeof body.adult === 'boolean' ? body.adult : undefined,
      reason: REASONS.includes(body.reason) ? body.reason : undefined,
    };
  }
}
