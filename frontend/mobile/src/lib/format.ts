import { localeTag, t, tn } from './i18n';

// ---------------------------------------------------------------- ONE date and time format for the whole app
// Every date and time on screen goes through these, so they look the same everywhere and on every phone (the phone's own
// region no longer decides between 09/11 and 11/9, or 14:05 and 2:05 PM).
//   time       English 2:05 PM (12-hour, as in the admin console)   Italian 14:05
//   date       Mon 9 Nov (the year only when it is not this year)   lun 9 nov
//   long date  Monday 9 November                                    lunedì 9 novembre
//   both       Mon 9 Nov, 2:05 PM   ·   Today, 2:05 PM
const italian = () => localeTag() === 'it-IT';
/** The language dates are written in: day before month in English too ("9 Nov"). */
export const dateLang = () => (italian() ? 'it-IT' : 'en-GB');
const asDate = (at: Date | string) => (typeof at === 'string' ? new Date(at) : at);

// ---------------------------------------------------------------- TIME ZONES
// The app never depends on the phone's time zone. Every moment is an exact instant; it is WRITTEN in the zone of the place it is
// about: the activity's own venue zone when the caller knows it (`tz`), else the zone of the city being browsed (set by lib/city),
// else (nothing known yet) the phone's own. Switching the city to Paris therefore shows Paris clocks even on a phone set to India.
// `WALL` marks a Date that already holds a place's wall-clock numbers in its local fields (the create form): no conversion.
export const WALL = 'wall';
let viewZone: string | undefined;
export const setViewZone = (z?: string | null) => void (viewZone = z || undefined);
export const getViewZone = () => viewZone;
const zoneOf = (tz?: string) => (tz === WALL ? undefined : tz ?? viewZone);
const parts = (d: Date, tz?: string) => {
  const o: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-CA', { timeZone: zoneOf(tz), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
};
/** A Date whose LOCAL fields show the clock in `tz` (the form's "wall time"); undo with instantOf. */
export function wallOf(at: Date | number, tz?: string) {
  const p = parts(new Date(at), tz);
  return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, 0, 0);
}
/** The real moment when the clock in `tz` shows the local fields of `wall`. */
export function instantOf(wall: Date, tz?: string) {
  const z = zoneOf(tz);
  if (!z) return new Date(wall);
  const want = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes());
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(t), z);
    t += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return new Date(t);
}
/** The calendar day of a moment in the zone, as a number of days (for "today / tomorrow"). */
const dayNo = (d: Date, tz?: string) => {
  const p = parts(d, tz);
  return Math.round(Date.UTC(p.y, p.mo - 1, p.d) / 864e5);
};
/** A short zone name ("GMT+2", "CET") to show when the place's clock differs from the phone's, else ''. */
export function zoneTag(tz?: string | null, at: Date | string = new Date()) {
  if (!tz) return '';
  try {
    const d = asDate(at);
    const name = (z?: string) => new Intl.DateTimeFormat('en-GB', { timeZone: z, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const here = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    const there = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
    return here === there ? '' : name(tz);
  } catch {
    return '';
  }
}

export function timeText(at: Date | string, tz?: string) {
  const d = asDate(at);
  const timeZone = zoneOf(tz);
  return italian() ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }) : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone });
}
/** "Mon 9 Nov"; `weekday: false` gives "9 Nov"; the year is added when it is not this year (or `year: true`). */
export function dateText(at: Date | string, opts: { weekday?: boolean; year?: boolean } = {}, tz?: string) {
  const d = asDate(at);
  const year = opts.year ?? parts(d, tz).y !== parts(new Date(), tz).y;
  return d.toLocaleDateString(dateLang(), { ...(opts.weekday === false ? {} : { weekday: 'short' }), day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: zoneOf(tz) });
}
/** "Monday 9 November" (the year when it is not this year, or `year: true`). */
export function longDateText(at: Date | string, year?: boolean, tz?: string) {
  const d = asDate(at);
  const y = year ?? parts(d, tz).y !== parts(new Date(), tz).y;
  return d.toLocaleDateString(dateLang(), { weekday: 'long', day: 'numeric', month: 'long', ...(y ? { year: 'numeric' } : {}), timeZone: zoneOf(tz) });
}
/** "Mon 9 Nov, 2:05 PM" */
export const dateTimeText = (at: Date | string, tz?: string) => `${dateText(at, {}, tz)}, ${timeText(at, tz)}`;
const clock = (d: Date, tz?: string) => timeText(d, tz);

/** The day on its own, with no time and no comma: "Today", "Tomorrow", "Mon 9 Nov". */
export function dayWord(iso: string, tz?: string) {
  const d = new Date(iso);
  const diff = dayNo(d, tz) - dayNo(new Date(), tz);
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Tomorrow');
  return dateText(d, {}, tz);
}
/** The day and the time: "Today, 2:05 PM", "Tomorrow, 2:05 PM", "Mon 9 Nov, 2:05 PM". */
export function when(iso: string, tz?: string) {
  return `${dayWord(iso, tz)}, ${clock(new Date(iso), tz)}`;
}
export const timeRange = (a: string, b: string, tz?: string) => `${when(a, tz)}–${clock(new Date(b), tz)}`;
export const hhmm = (iso: string, tz?: string) => clock(new Date(iso), tz);

export function dayLabel(iso: string, tz?: string) {
  const d = new Date(iso);
  const diff = dayNo(new Date(), tz) - dayNo(d, tz);
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Yesterday');
  return longDateText(d, undefined, tz);
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return t('now');
  if (m < 60) return `${m}${t('m')}`;
  if (m < 1440) return `${Math.round(m / 60)}${t('h')}`;
  return `${Math.round(m / 1440)}${t('d')}`;
}

export const shortDate = (iso: string, tz?: string) => dateText(iso, { weekday: false, year: false }, tz);
export const dateSpan = (a: string, b: string) => `${shortDate(a)}–${shortDate(b)} ${new Date(b).getFullYear()}`;

const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
export const money = (n: number, cur: string) => `${SYMBOL[cur] ?? cur + ' '}${n.toLocaleString(localeTag())}`;

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parses a strict YYYY-MM-DD string into a local date at midnight, or null if it is not a real date. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** The small line on a card about your circle: "2 friends going", or "1 person you follow is going" when no friend is. */
export const circleLine = (buddies?: number, following?: number) => {
  const b = buddies ?? 0;
  const f = following ?? 0;
  return b > 0 ? tn(b, '{n} friend going', '{n} friends going') : f > 0 ? tn(f, '{n} person you follow is going', '{n} people you follow are going') : null;
};

/** A count for a tab or a "more" button: the exact number up to 10 (6, 7, 8 ...), then just "10+" (the full number is not needed there). */
export const capCount = (n: number, max = 10) => (n > max ? `${max}+` : String(n));

/** A big count in few characters: 0 to 9999 as they are, then 12.3k, 120k, 1.2M (a count in a narrow column must never be cut off). */
export const compactCount = (n: number) => {
  if (n < 10_000) return String(n);
  if (n < 1_000_000) return `${n < 100_000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
};
