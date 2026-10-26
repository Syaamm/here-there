import { z } from 'zod';
import { ApiError } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'Request validation failed',
      r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return r.data;
}

/** Strong swear words and slurs, English and Italian. Kept short on purpose: only words that are almost never fine. */
const BLOCKED_WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'asshole', 'cunt', 'whore', 'slut', 'bastard', 'nigger', 'nigga', 'faggot', 'retard',
  'cazzo', 'merda', 'stronzo', 'stronza', 'vaffanculo', 'fanculo', 'puttana', 'troia', 'minchia', 'coglione', 'bastardo', 'negro', 'frocio',
];
const LOOKALIKES: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Lower case, no accents, look-alike symbols turned back into letters (f4ck is caught), long runs of a letter shortened. */
export function plainText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1');
}

const BLOCKED = new RegExp(`(^|[^a-z])(${BLOCKED_WORDS.join('|')})($|[^a-z])`);

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'ow.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'buff.ly', 'rebrand.ly', 'lnkd.in', 'wa.me'];
const RISKY_TLDS = new Set(['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'click', 'loan', 'top']);
/** Brands scammers imitate; a link whose host uses the name but is not the real site is treated as a look-alike. */
const BRANDS: [string, string[]][] = [
  ['paypal', ['paypal.com', 'paypal.me']], ['revolut', ['revolut.com', 'revolut.me']], ['intesa', ['intesasanpaolo.com']], ['unicredit', ['unicredit.it']],
  ['poste', ['poste.it', 'postepay.it']], ['apple', ['apple.com']], ['google', ['google.com']], ['booking', ['booking.com']], ['airbnb', ['airbnb.com']],
  ['ryanair', ['ryanair.com']], ['whatsapp', ['whatsapp.com']], ['instagram', ['instagram.com']],
];

/**
 * Looks at every web address in the text (spec 7.5). Ordinary links are allowed (the app warns before opening them);
 * what is refused is a link that hides where it goes or imitates somebody: shorteners, raw IP addresses, look-alike
 * (punycode) names, an @ before the host, odd endings, other schemes, and bank or payment names on the wrong site.
 */
export function linkProblem(text: string): string | null {
  if (/\b(javascript|data|vbscript|file):/i.test(text)) return 'This link is not allowed';
  const found = text.match(/(?:https?:\/\/|www\.)[^\s<>"']+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,24})\/[^\s<>"']*/gi) ?? [];
  for (const raw of found) {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return 'This link does not look right';
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.username || url.password) return 'This link hides where it goes';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[.*\]$/.test(host) || /^\d+$/.test(host)) return 'Links to a bare number address are not allowed';
    if (host.split('.').some((l) => l.startsWith('xn--'))) return 'This link uses a look-alike address';
    if (SHORTENERS.some((d) => host === d || host.endsWith(`.${d}`))) return 'Shortened links hide where they go. Share the full address.';
    const tld = host.split('.').pop() ?? '';
    if (RISKY_TLDS.has(tld)) return 'This link ends in an address type often used for scams';
    for (const [brand, real] of BRANDS) if (host.includes(brand) && !real.some((d) => host === d || host.endsWith(`.${d}`))) return 'This link imitates another website';
  }
  return null;
}

/** Asking for money or payment details: refused everywhere (spec 7.5). */
const MONEY_ASK = [
  /\b(send|transfer|wire|give|lend|pay|venmo|zelle)\s+(me|us|to me|to us)\b[^.!?\n]{0,40}(€|\$|£|eur\b|euros?\b|usd\b|dollars?\b|money|cash|funds|deposit|fee)/i,
  /\b(send|transfer|wire)\s+(me\s+|us\s+)?(some\s+)?(money|cash|funds)\b/i,
  /\b(deposit|advance payment|booking fee|reservation fee|down payment|upfront payment)\b[^.!?\n]{0,40}\b(send|pay|transfer|wire|required|needed|first)\b|\b(send|pay|transfer|wire)\b[^.!?\n]{0,40}\b(deposit|advance payment|booking fee|reservation fee|down payment)\b/i,
  /western union|money\s?gram|paypal\.me|revolut\.me|cash\s?app|venmo|zelle|gift\s?cards?|crypto\s*(wallet|invest)|bitcoin|\busdt\b/i,
  /\bbank transfer\b|\bsort code\b|\biban\b/i,
];
/** Account and card numbers: never shared in a listing or chat. */
const PAYMENT_DETAILS = [/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/, /\b(?:\d{4}[ -]){3}\d{3,4}\b/, /\b0x[a-fA-F0-9]{40}\b/, /\bbc1[a-z0-9]{30,60}\b/];

/**
 * Cheap content rules for titles, descriptions, intros and chat (spec 4.2 / 7.5): spam links, repetition, shouting, scam
 * wording, suspicious links, requests for money and payment details, and strong swear words (English and Italian). Real
 * moderation sits on top. Returns the reason to show the person, or null when the text is fine.
 */
export function contentProblem(text?: string | null): string | null {
  if (!text) return null;
  const urls = text.match(/(?:https?:\/\/|www\.)[^\s]+/gi)?.length ?? 0; // one address counts once, with or without www
  if (urls > 1) return 'Too many links';
  if (/(.)\1{9,}/.test(text)) return 'Spam-like repetition';
  const words = text.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
  if (words.length >= 6 && words.some((w) => words.filter((x) => x === w).length >= Math.max(5, words.length * 0.4))) return 'Spam-like repetition';
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 15 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.8) return 'Please do not write everything in capitals';
  if (BLOCKED.test(plainText(text))) return 'Please keep the language respectful';
  if (MONEY_ASK.some((r) => r.test(text))) return 'Financial solicitation is not allowed';
  if (PAYMENT_DETAILS.some((r) => r.test(text))) return 'Please do not share bank, card or wallet details';
  const link = linkProblem(text);
  if (link) return link;
  if (/click here|free followers|only\s?fans|guaranteed (profit|income|returns)|work from home and earn|t\.me\/|telegram\.me\//i.test(text)) return 'This looks like spam';
  return null;
}
