import * as bcrypt from 'bcryptjs';
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { E } from './errors';

/**
 * Password hashing is slow on purpose and runs on the server's one thread, so a burst of sign-ins could starve every other
 * request. All hashing and checking goes through here: only a few run at the same time, the rest wait in line, and if the
 * line gets very long the extra sign-ins are turned away at once ("try again in a moment") instead of piling up.
 */
const LIMIT = Math.max(1, Number(process.env.PASSWORD_CONCURRENCY ?? 4));
const MAX_WAITING = Math.max(1, Number(process.env.PASSWORD_QUEUE ?? 200));

let running = 0;
const waiting: Array<() => void> = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= LIMIT) {
    if (waiting.length >= MAX_WAITING) throw E.tooMany('We are busy right now. Please try again in a moment.');
    await new Promise<void>((go) => waiting.push(go));
  } else running++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next(); // the freed place goes straight to the next in line
    else running--;
  }
}

/**
 * New passwords use Argon2id (memory-hard, so graphics cards and custom chips gain little), run by Node's own crypto on its
 * worker threads rather than on the server's one thread. Passwords stored before this are bcrypt: they still work, and are
 * quietly re-saved as Argon2id the next time that person signs in (see needsRehash). Needs Node 24.7 or newer.
 * Settings follow OWASP's guidance (19 MiB, 2 passes, 1 lane); raise them as the servers allow.
 */
const MEMORY_KIB = Number(process.env.ARGON2_MEMORY_KIB ?? 19456);
const PASSES = Number(process.env.ARGON2_PASSES ?? 2);
const LANES = 1;
const TAG = 32;

const derive = (plain: string, salt: Buffer, memory: number, passes: number, lanes: number, tagLength: number) =>
  new Promise<Buffer>((ok, fail) =>
    argon2('argon2id', { message: plain, nonce: salt, parallelism: lanes, tagLength, memory, passes }, (err, key) => (err ? fail(err) : ok(Buffer.from(key)))),
  );

const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');

/** `$argon2id$v=19$m=…,t=…,p=…$salt$hash` (the standard text form), or null if this is not one. */
function parseArgon(stored: string) {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(stored);
  if (!m) return null;
  return { memory: Number(m[1]), passes: Number(m[2]), lanes: Number(m[3]), salt: Buffer.from(m[4], 'base64'), tag: Buffer.from(m[5], 'base64') };
}

export const hashPassword = (plain: string) =>
  slot(async () => {
    const salt = randomBytes(16);
    const tag = await derive(plain, salt, MEMORY_KIB, PASSES, LANES, TAG);
    return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${LANES}$${b64(salt)}$${b64(tag)}`;
  });

export const checkPassword = (plain: string, stored: string) =>
  slot(async () => {
    const a = parseArgon(stored);
    if (!a) return bcrypt.compare(plain, stored); // an older (bcrypt) password; a non-hash like "!" never matches
    const tag = await derive(plain, a.salt, a.memory, a.passes, a.lanes, a.tag.length);
    return tag.length === a.tag.length && timingSafeEqual(tag, a.tag);
  });

/** True when a stored password should be saved again with today's method or settings (an old bcrypt one, or weaker Argon2 settings). */
export function needsRehash(stored: string) {
  const a = parseArgon(stored);
  if (!a) return stored.startsWith('$2'); // bcrypt; "!" (no password) is left alone
  return a.memory < MEMORY_KIB || a.passes < PASSES;
}
