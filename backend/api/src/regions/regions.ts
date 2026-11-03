/**
 * Planning limits by place. How far ahead an activity (HERE) or a trip (THERE) may be planned is not one number for the
 * whole service: the admin of a place sets it for that place, and a place that sets nothing follows the place above it
 * (city -> region -> country -> the whole service -> the built-in defaults below).
 */
export const DEFAULT_HERE_MONTHS = 1;
export const DEFAULT_THERE_MONTHS = 6;
export const HERE_MONTHS_RANGE = { min: 1, max: 12 } as const;
export const THERE_MONTHS_RANGE = { min: 1, max: 24 } as const;

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

export type RegionRow = { key: string; name: string; kind: string; parentKey: string | null; cityKey: string | null; hereMonths: number | null; thereMonths: number | null };

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

/** The first place on the chain that sets this limit, or the built-in default. */
export function effectiveMonths(chain: RegionRow[], which: 'here' | 'there') {
  for (const r of chain) {
    const v = which === 'here' ? r.hereMonths : r.thereMonths;
    if (v !== null && v !== undefined) return { months: v, from: { key: r.key, name: r.name, kind: r.kind } };
  }
  return { months: which === 'here' ? DEFAULT_HERE_MONTHS : DEFAULT_THERE_MONTHS, from: null };
}

/** Every place under `rootKey` (including itself). */
export function subtree(rows: RegionRow[], rootKey: string): RegionRow[] {
  const kids = new Map<string, RegionRow[]>();
  for (const r of rows) if (r.parentKey) kids.set(r.parentKey, [...(kids.get(r.parentKey) ?? []), r]);
  const root = rows.find((r) => r.key === rootKey);
  if (!root) return [];
  const out: RegionRow[] = [];
  const seen = new Set<string>();
  const walk = (r: RegionRow) => {
    if (seen.has(r.key)) return;
    seen.add(r.key);
    out.push(r);
    for (const k of kids.get(r.key) ?? []) walk(k);
  };
  walk(root);
  return out;
}

/** What a staff account may reach: a place and everything under it. `null` means the whole service. */
export type Scope = { regionKey: string; name: string; kind: string; regionKeys: Set<string>; cityKeys: Set<string> };

export function scopeFor(rows: RegionRow[], regionKey: string | null | undefined): Scope | null {
  if (!regionKey) return null;
  const inside = subtree(rows, regionKey);
  const root = inside[0];
  // a scope that points at a place that no longer exists reaches nothing (it never falls back to "everything")
  return { regionKey, name: root?.name ?? regionKey, kind: root?.kind ?? 'city', regionKeys: new Set(inside.map((r) => r.key)), cityKeys: new Set(inside.map((r) => r.cityKey).filter((k): k is string => !!k)) };
}

export const inScope = (scope: Scope | null, cityKey: string | null | undefined) => !scope || (!!cityKey && scope.cityKeys.has(cityKey));
