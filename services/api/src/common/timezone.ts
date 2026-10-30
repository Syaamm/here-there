import tzlookup from 'tz-lookup';

/**
 * Time zones. Every moment is stored as an exact instant (UTC), which is already right for "starts in an hour" and for
 * reminders: they compare instants and need no zone. A zone is needed only to answer questions about a CALENDAR DAY, such as
 * "which day of the trip is it" or "what date does the share page show", and that must be the venue's or destination's day,
 * not the server's. These helpers answer those questions with the IANA zone name (Europe/Rome), so daylight-saving changes
 * (a 23-hour or 25-hour day) are handled by the platform's own time-zone data and not by adding 24 hours.
 */

/** Used when a place has no known zone. Override with DEFAULT_TIME_ZONE. */
export const defaultZone = () => process.env.DEFAULT_TIME_ZONE?.trim() || 'Europe/Rome';

/** Is this a zone name the platform knows? */
export function isZone(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 60) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** The zone a place is in, from its coordinates (an offline table, no outside service). Falls back to the default. */
export function zoneFor(lat?: number | null, lng?: number | null): string {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return defaultZone();
  try {
    const z = tzlookup(lat, lng);
    return isZone(z) ? z : defaultZone();
  } catch {
    return defaultZone();
  }
}

const parts = (d: Date, zone: string) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second };
};

/** The calendar day (YYYY-MM-DD) that this instant falls on in the zone. */
export function localDay(at: Date, zone: string): string {
  const p = parts(at, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes after local midnight, in the zone (0 to 1439). */
export function localMinutes(at: Date, zone: string): number {
  const p = parts(at, zone);
  return p.hour * 60 + p.minute;
}

/** How far ahead of UTC the zone is at this instant, in minutes (Rome: 60 in winter, 120 in summer). */
export function offsetMinutes(at: Date, zone: string): number {
  const p = parts(at, zone);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(+at / 1000) * 1000) / 60_000);
}

/** The instant a calendar day begins in the zone (local midnight). On a day with a clock change this is not "UTC midnight minus the usual offset". */
export function startOfLocalDay(day: string, zone: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  // start from "midnight as if the zone were UTC", then correct by the zone's offset at that moment; once more in case the
  // correction itself crossed a clock change
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMinutes(new Date(guess), zone) * 60_000;
  return new Date(guess);
}

/** The calendar day after the given YYYY-MM-DD (not tied to any zone). */
export function nextDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * "Today" for a place whose zone may not be known. With a zone, it is that zone's today. Without one it is the earliest
 * calendar day anywhere on earth (12 hours behind UTC), so nobody's own today is ever treated as already past.
 */
export function todayFor(zone: string | null | undefined, now = new Date()): string {
  return zone && isZone(zone) ? localDay(now, zone) : new Date(+now - 12 * 3600 * 1000).toISOString().slice(0, 10);
}
