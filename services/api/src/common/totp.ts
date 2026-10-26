import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238), the 6-digit codes that Google Authenticator, Microsoft Authenticator,
 * 1Password, Authy and others show. HMAC-SHA1, 30-second steps, which is what every authenticator app expects.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, as the text people type into an authenticator app (160 bits). */
export const newSecret = () => base32Encode(randomBytes(20));

/** The code for one 30-second step. */
export function totp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', secret).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Is this the right code right now? The step before and after are accepted (clocks drift). A step that was already used
 * (`lastStep`) is refused, so a code seen over someone's shoulder cannot be replayed. Returns the step that matched.
 */
export function checkTotp(secretBase32: string, code: string, lastStep: number | null | undefined, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = Math.floor(now / 30_000);
  for (const step of [current, current - 1, current + 1]) {
    if (lastStep != null && step <= lastStep) continue;
    const want = Buffer.from(totp(secret, step));
    const got = Buffer.from(code);
    if (want.length === got.length && timingSafeEqual(want, got)) return step;
  }
  return null;
}

/** The address an authenticator app reads from a QR code (or that can be opened directly). */
export const otpauthUri = (account: string, secretBase32: string, issuer = 'HERE & THERE') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
