import { Injectable } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
import { ApiError, E } from '../common/errors';

export type SocialProvider = 'apple' | 'google';
export type SocialProfile = { provider: SocialProvider; subject: string; email: string | null; emailVerified: boolean; name: string | null };

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };

const CONFIG: Record<SocialProvider, { jwks: string; issuers: string[]; clientIdsEnv: string }> = {
  apple: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'], clientIdsEnv: 'APPLE_CLIENT_IDS' },
  google: { jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'], clientIdsEnv: 'GOOGLE_CLIENT_IDS' },
};

const b64 = (s: string) => Buffer.from(s, 'base64url');

/**
 * "Sign in with Apple / Google". The phone gets a signed identity token from the provider; this checks it properly:
 * the signature against the provider's published keys, who issued it, that it was made for OUR app, and that it has not
 * expired. Only then is the person trusted. A provider is switched on by listing its app ids:
 *
 *   APPLE_CLIENT_IDS   the app's bundle id (and the web service id, if any), comma separated
 *   GOOGLE_CLIENT_IDS  the OAuth client ids (iOS, Android, web), comma separated
 */
@Injectable()
export class SocialService {
  private cache = new Map<SocialProvider, { at: number; keys: Jwk[] }>();

  /** Where the provider's public keys come from. A field, so tests can supply their own. */
  fetchJwks: (url: string) => Promise<{ keys: Jwk[] }> = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`keys unavailable (${r.status})`);
    return (await r.json()) as { keys: Jwk[] };
  };

  clientIds(provider: SocialProvider) {
    return (process.env[CONFIG[provider].clientIdsEnv] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  enabled() {
    return { apple: this.clientIds('apple').length > 0, google: this.clientIds('google').length > 0 };
  }

  private async keys(provider: SocialProvider, refresh = false) {
    const hit = this.cache.get(provider);
    if (hit && !refresh && Date.now() - hit.at < 3600_000) return hit.keys;
    const { keys } = await this.fetchJwks(CONFIG[provider].jwks);
    this.cache.set(provider, { at: Date.now(), keys });
    return keys;
  }

  /** Checks the token and says who it belongs to. Throws one generic error for anything wrong with it. */
  async verifyIdToken(provider: SocialProvider, idToken: string, now = Date.now()): Promise<SocialProfile> {
    if (this.clientIds(provider).length === 0) throw E.notFound('Sign in with this provider');
    const bad = () => E.unauthorized('INVALID_SOCIAL_TOKEN', 'We could not confirm that sign-in. Try again.');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw bad();
    let header: { kid?: string; alg?: string };
    let claims: { iss?: string; aud?: string | string[]; exp?: number; sub?: string; email?: string; email_verified?: boolean | string; name?: string };
    try {
      header = JSON.parse(b64(parts[0]).toString());
      claims = JSON.parse(b64(parts[1]).toString());
    } catch {
      throw bad();
    }
    if (header.alg !== 'RS256' || !header.kid) throw bad(); // never "none", never a shared secret

    let jwk: Jwk | undefined;
    try {
      jwk = (await this.keys(provider)).find((k) => k.kid === header.kid) ?? (await this.keys(provider, true)).find((k) => k.kid === header.kid); // the provider may have rotated its keys
    } catch {
      throw new ApiError(503, 'SOCIAL_UNAVAILABLE', 'Sign-in with this provider is unavailable right now. Try again in a moment.');
    }
    if (!jwk) throw bad();
    const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' }), b64(parts[2]));
    if (!ok) throw bad();

    if (!claims.iss || !CONFIG[provider].issuers.includes(claims.iss)) throw bad();
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.some((a) => a && this.clientIds(provider).includes(a))) throw bad(); // made for some other app
    if (!claims.exp || claims.exp * 1000 < now) throw bad();
    if (!claims.sub) throw bad();
    return {
      provider,
      subject: claims.sub,
      email: claims.email?.toLowerCase() ?? null,
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      name: claims.name ?? null,
    };
  }
}
