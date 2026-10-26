import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'node:crypto';

/**
 * Field-level encryption for personal data that must be read back (a phone number, a 2FA secret), plus a "blind index":
 * a keyed hash that lets the database ask "is this number already used?" without anyone being able to read the numbers.
 *
 *   DATA_ENCRYPTION_KEY  32 random bytes, base64 (openssl rand -base64 32). Required in production.
 *   BLIND_INDEX_KEY      another 32 random bytes, base64. Required in production.
 *
 * In development, if they are not set, keys are derived from JWT_SECRET so the app still runs. A lost or changed
 * DATA_ENCRYPTION_KEY makes encrypted fields unreadable, so keep it in a secret store and back it up.
 */
const PREFIX = 'enc1:';
let cached: { enc: Buffer; idx: Buffer } | null = null;

function keys() {
  if (cached) return cached;
  const fromEnv = (name: string, label: string) => {
    const v = process.env[name];
    if (v) {
      const b = Buffer.from(v, 'base64');
      if (b.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded (openssl rand -base64 32)`);
      return b;
    }
    if (process.env.NODE_ENV === 'production') throw new Error(`${name} must be set in production`);
    const secret = process.env.JWT_SECRET ?? 'dev-only-secret-change-me';
    return scryptSync(secret, `herethere-${label}`, 32);
  };
  cached = { enc: fromEnv('DATA_ENCRYPTION_KEY', 'data-encryption'), idx: fromEnv('BLIND_INDEX_KEY', 'blind-index') };
  return cached;
}

/** Fails fast at start-up in production if the keys are missing, instead of at the first phone number. */
export function assertVaultReady() {
  keys();
}

export const isEncrypted = (v: string | null | undefined): v is string => !!v && v.startsWith(PREFIX);

/** AES-256-GCM: a fresh random nonce each time, and the authentication tag makes tampering detectable. */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keys().enc, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Reads an encrypted field. A value that was never encrypted (older data) is returned as it is. */
export function decryptField(stored: string): string {
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keys().enc, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** A keyed, one-way fingerprint. The same input always gives the same output, so it can be looked up or made unique. */
export function blindIndex(purpose: string, value: string): string {
  return createHmac('sha256', keys().idx).update(`${purpose}:${value}`).digest('hex');
}

/** "+39 ••••34": enough for the owner to recognise it, never the number. */
export const maskPhone = (p: string) => `${p.slice(0, 3)}••••${p.slice(-2)}`;
