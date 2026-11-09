import { localeTag, t, tn } from './i18n';

const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

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

export function timeText(at: Date | string) {
  const d = asDate(at);
  return italian() ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
/** "Mon 9 Nov"; `weekday: false` gives "9 Nov"; the year is added when it is not this year (or `year: true`). */
export function dateText(at: Date | string, opts: { weekday?: boolean; year?: boolean } = {}) {
  const d = asDate(at);
  const year = opts.year ?? d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(dateLang(), { ...(opts.weekday === false ? {} : { weekday: 'short' }), day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
}
/** "Monday 9 November" (the year when it is not this year, or `year: true`). */
export function longDateText(at: Date | string, year?: boolean) {
  const d = asDate(at);
  const y = year ?? d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(dateLang(), { weekday: 'long', day: 'numeric', month: 'long', ...(y ? { year: 'numeric' } : {}) });
}
/** "Mon 9 Nov, 2:05 PM" */
export const dateTimeText = (at: Date | string) => `${dateText(at)}, ${timeText(at)}`;
const clock = (d: Date) => timeText(d);

/** The day on its own, with no time and no comma: "Today", "Tomorrow", "Mon 9 Nov". */
export function dayWord(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((day0(d) - day0(new Date())) / 864e5);
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Tomorrow');
  return dateText(d);
}
/** The day and the time: "Today, 2:05 PM", "Tomorrow, 2:05 PM", "Mon 9 Nov, 2:05 PM". */
export function when(iso: string) {
  return `${dayWord(iso)}, ${clock(new Date(iso))}`;
}
export const timeRange = (a: string, b: string) => `${when(a)}–${clock(new Date(b))}`;
export const hhmm = (iso: string) => clock(new Date(iso));

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((day0(new Date()) - day0(d)) / 864e5);
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Yesterday');
  return longDateText(d);
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return t('now');
  if (m < 60) return `${m}${t('m')}`;
  if (m < 1440) return `${Math.round(m / 60)}${t('h')}`;
  return `${Math.round(m / 1440)}${t('d')}`;
}

export const shortDate = (iso: string) => dateText(iso, { weekday: false, year: false });
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

/** The small line on a card about your circle: "2 friends going", or "1 you follow is going" when no buddy is. */
export const circleLine = (buddies?: number, following?: number) => {
  const b = buddies ?? 0;
  const f = following ?? 0;
  return b > 0 ? tn(b, '{n} friend going', '{n} friends going') : f > 0 ? tn(f, '{n} you follow is going', '{n} you follow are going') : null;
};
