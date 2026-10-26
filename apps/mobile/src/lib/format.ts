const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
const clock = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function when(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((day0(d) - day0(new Date())) / 864e5);
  if (diff === 0) return `Today ${clock(d)}`;
  if (diff === 1) return `Tomorrow ${clock(d)}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${clock(d)}`;
}
export const timeRange = (a: string, b: string) => `${when(a)}–${clock(new Date(b))}`;
export const hhmm = (iso: string) => clock(new Date(iso));

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const diff = Math.round((day0(new Date()) - day0(d)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

export function ago(iso: string) {
  const m = Math.round((Date.now() - +new Date(iso)) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
export const dateSpan = (a: string, b: string) => `${shortDate(a)}–${shortDate(b)} ${new Date(b).getFullYear()}`;

const SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
export const money = (n: number, cur: string) => `${SYMBOL[cur] ?? cur + ' '}${n.toLocaleString()}`;

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Parses a strict YYYY-MM-DD string into a local date at midnight, or null if it is not a real date. */
export function parseDay(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** The small line on a card about your circle: "2 buddies going", or "1 you follow is going" when no buddy is. */
export const circleLine = (buddies?: number, following?: number) => {
  const b = buddies ?? 0;
  const f = following ?? 0;
  return b > 0 ? `${b} ${b === 1 ? 'buddy' : 'buddies'} going` : f > 0 ? `${f} you follow ${f === 1 ? 'is' : 'are'} going` : null;
};
