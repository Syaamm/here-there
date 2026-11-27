/**
 * Planning limits by place. How far ahead an activity (HERE) or a trip (THERE) may be planned is not one number for the
 * whole service: the admin of a place sets it for that place, and a place that sets nothing follows the place above it
 * (city -> region -> country -> the whole service -> the built-in defaults below).
 */
export const DEFAULT_HERE_MONTHS = 1;
export const DEFAULT_THERE_MONTHS = 6;
export const HERE_MONTHS_RANGE = { min: 1, max: 12 } as const;
export const THERE_MONTHS_RANGE = { min: 1, max: 24 } as const;

/** How far around a city's centre its activities are shown, and may be placed (km). A place without its own value follows the one above. */
export const DEFAULT_AREA_KM = 25;
export const AREA_KM_RANGE = { min: 1, max: 100 } as const;

export type Kind = 'global' | 'country' | 'region' | 'city';
export const GLOBAL_KEY = 'global';

/** The name a city is filed under: lowercase, no spaces at the ends. Activities (cityKey), trips (originKey) and people (homeCityKey) all use it. */
export const cityKeyOf = (name: string | null | undefined) => (name ?? '').trim().toLowerCase();

/** `from` plus whole calendar months. 31 January plus one month is 28 (or 29) February, never 3 March. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** The last moment a plan may start: the end of the day that is `months` months from now. */
export function latestStart(months: number, now = new Date()): Date {
  const d = addMonths(now, months);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

const WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** "one month", "six months", "18 months": for messages people read. */
export const monthsWord = (n: number) => `${WORDS[n] || n} ${n === 1 ? 'month' : 'months'}`;

export type RegionRow = { key: string; name: string; kind: string; parentKey: string | null; cityKey: string | null; hereMonths: number | null; thereMonths: number | null; areaKm?: number | null };

/** The place itself, then the place above it, and so on up to the whole service. Stops if the chain is broken or loops. */
export function chainOf(rows: RegionRow[], from: RegionRow | null): RegionRow[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: RegionRow[] = [];
  let at = from;
  while (at && out.length < 10 && !out.includes(at)) {
    out.push(at);
    at = at.parentKey ? (byKey.get(at.parentKey) ?? null) : null;
  }
  return out;
}

/** The first place on the chain that sets a coverage distance, or the built-in 25 km. */
export function effectiveAreaKm(chain: RegionRow[]) {
  for (const r of chain) if (r.areaKm !== null && r.areaKm !== undefined) return { km: r.areaKm, from: { key: r.key, name: r.name, kind: r.kind } };
  return { km: DEFAULT_AREA_KM, from: null };
}

/** The first place on the chain that sets this limit, or the built-in default. */
export function effectiveMonths(chain: RegionRow[], which: 'here' | 'there') {
  for (const r of chain) {
    const v = which === 'here' ? r.hereMonths : r.thereMonths;
    if (v !== null && v !== undefined) return { months: v, from: { key: r.key, name: r.name, kind: r.kind } };
  }
  return { months: which === 'here' ? DEFAULT_HERE_MONTHS : DEFAULT_THERE_MONTHS, from: null };
}

