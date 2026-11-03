/**
 * What every identity-verification provider (Sumsub, Veriff, Persona, ...) must offer.
 *
 * DATA MINIMISATION: nothing in this interface carries documents, selfies, face data, names or birth dates.
 * The provider holds those. We only ever receive an outcome, plus an "is an adult" answer.
 */
export type ProviderOutcome = {
  /** the provider's id for the session we created */
  providerRef: string;
  result: 'approved' | 'declined' | 'needs_resubmission' | 'revoked';
  /** the provider's answer to "is this person 18 or older?". Never the birth date itself. */
  adult?: boolean;
  reason?: 'underage' | 'document' | 'liveness' | 'fraud' | 'other';
};

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface IdentityProvider {
  readonly name: string;

  /**
   * Opens a check for this user. `url` is the provider's hosted flow (ID photo + selfie with liveness) that the
   * app opens. Providers that decide offline (manual review) return no url.
   */
  createSession(user: { id: string; email: string }, ctx: { checkId: string; baseUrl: string; method: 'face' | 'document' }): Promise<{ providerRef: string; url?: string }>;

  /** Lets a user who closed the browser pick the same session up again (it may ask the provider for a fresh link). */
  resumeUrl?(providerRef: string, baseUrl: string): string | undefined | Promise<string | undefined>;

  /**
   * Verifies the webhook signature (throw on failure) and normalises the body. Must ignore every field not listed in
   * ProviderOutcome. Returns null for an event that decides nothing yet (a check started, a review opened...).
   */
  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): ProviderOutcome | null;

  /** Asks the provider for the session's outcome directly: the safety net for a webhook that never arrived. Null while undecided. */
  lookup?(providerRef: string): Promise<ProviderOutcome | null>;

  /** Asks the provider to erase the session's personal data now that we hold the outcome. */
  eraseSession?(providerRef: string): Promise<void>;
}
