import * as bcrypt from 'bcryptjs';
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

export const hashPassword = (plain: string, rounds = Number(process.env.BCRYPT_ROUNDS ?? 12)) => slot(() => bcrypt.hash(plain, rounds));
export const checkPassword = (plain: string, hash: string) => slot(() => bcrypt.compare(plain, hash));
