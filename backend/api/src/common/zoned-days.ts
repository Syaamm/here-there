/** Calendar days in the viewer's own time zone (an IANA name such as "Asia/Kolkata"); anything unknown falls back to UTC. */

export function safeZone(tz?: string): string {
  if (!tz || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** The calendar day ("YYYY-MM-DD") a moment falls on in that zone. */
export function zonedDay(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** How far the zone is ahead of UTC at that moment, in milliseconds. */
function offsetAt(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(+at / 1000) * 1000;
}

/** The moment a calendar day ("YYYY-MM-DD") begins in that zone. */
export function zonedDayStart(day: string, tz: string): Date {
  const utc = new Date(day + 'T00:00:00.000Z');
  if (tz === 'UTC') return utc;
  // the offset can differ at midnight itself (daylight saving), so settle it in two steps
  let at = new Date(+utc - offsetAt(utc, tz));
  at = new Date(+utc - offsetAt(at, tz));
  return at;
}
