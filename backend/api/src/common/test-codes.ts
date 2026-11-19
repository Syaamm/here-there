import { activeIntegration } from './integration-config';

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

/**
 * The fixed code for this channel, or null when a random one should be used.
 * Settings > Integrations decides first: while an email (or SMS) integration is on, its own "Fixed sign-up code" is used (test mode),
 * and a real provider always means random codes. With none on, the built-in TEST_CODE applies as before.
 */
export function fixedCodeFor(channel: string): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  const kind = channel === 'email' ? 'email' : channel === 'phone' ? 'sms' : null;
  const on = kind ? activeIntegration(kind) : null;
  if (on) {
    const code = (on.values.fixedCode ?? '').trim();
    return on.provider === 'dev' && /^\d{6}$/.test(code) ? code : null;
  }
  if (!TEST_CODE_ENABLED) return null;
  return channel === 'email' || channel === 'phone' ? TEST_CODE : null;
}
