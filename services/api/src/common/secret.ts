/**
 * The one place that reads JWT_SECRET. Sign-in tokens, sign-up tickets, emailed-code hashes and download links are all signed
 * with it, so in production a missing value must stop the server rather than fall back to a string anyone can read here.
 */
export function authSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  return 'dev-only-secret-change-me';
}
