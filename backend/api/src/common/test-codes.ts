/**
 * TESTING ONLY. The one place that decides the fixed sign-up confirmation code.
 *
 * While no email/SMS provider is chosen, the email code and the phone (SMS) code are always TEST_CODE.
 * When a real provider is connected, set ENABLED to false (or delete this file and its one use in
 * auth/contact-verification.service.ts) and codes become random again.
 * It is also always off when NODE_ENV=production.
 */
export const TEST_CODE = '123456';
export const TEST_CODE_ENABLED = true;

/** The fixed code for this channel, or null when a random one should be used. */
export function fixedCodeFor(channel: string): string | null {
  if (!TEST_CODE_ENABLED || process.env.NODE_ENV === 'production') return null;
  return channel === 'email' || channel === 'phone' ? TEST_CODE : null;
}
