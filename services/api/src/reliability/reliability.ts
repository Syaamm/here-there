/**
 * Reliability level: how dependable a person has been at turning up, worked out ONLY from verified, completed plans.
 * It is deliberately not a number people compete on, and it never uses likes, profile views or whether people "got on".
 *
 * What counts (everything else is ignored):
 *   kept          a plan or trip they were approved for (or hosted with at least one guest) that finished, with no
 *                 unsettled no-show note against them. It counts once the host's 48-hour window has passed.
 *   no_show       a host's note that they did not come, CONFIRMED: the person had 7 days to dispute it and did not, or a
 *                 moderator upheld it. A disputed, pending or overturned note counts for nothing.
 *   late_cancel   leaving a plan within 2 hours of its start (a trip: within 7 days); a host cancelling that late
 *                 (a trip: within 14 days) with guests booked
 *   upheld_report a report about them (or about a plan they host) that a moderator resolved. Reports alone never count.
 * Old events fade (half-life 180 days) and drop out after 2 years.
 */
export type Level = 'new' | 'reliable' | 'very_reliable' | 'needs_care';
export const LEVEL_LABEL: Record<Level, string> = { new: 'New', reliable: 'Reliable', very_reliable: 'Very reliable', needs_care: 'Needs care' };

export type FactKind = 'kept' | 'no_show' | 'late_cancel' | 'host_late_cancel' | 'upheld_report';
export type Fact = { kind: FactKind; at: Date; label: string };

export const DAY = 24 * 3600 * 1000;
export const HOUR = 3600 * 1000;
export const MARK_WINDOW_H = 48; // after a plan ends, how long the host has to say who did not come
export const DISPUTE_DAYS = 7; // how long a person has to dispute a note
export const HALF_LIFE_DAYS = 180;
export const HORIZON_DAYS = 730;
export const MAX_KEPT_PER_DAY = 2; // two plans a day at most count: back-to-back fake meetups cannot farm a level
export const LATE_ACTIVITY_H = 2;
export const LATE_TRIP_DAYS = 7;
export const LATE_HOST_TRIP_DAYS = 14;
export const RELIABLE_AT = 3; // kept plans needed to leave "New"
export const VERY_RELIABLE_AT = 10; // kept plans (with a clean record) for the top level

/** How much each bad event weighs against a good one. */
export const PENALTY: Record<Exclude<FactKind, 'kept'>, number> = { no_show: 3, late_cancel: 1.5, host_late_cancel: 2.5, upheld_report: 4 };

export const weightOf = (at: Date, now: Date) => {
  const age = (+now - +at) / DAY;
  return age > HORIZON_DAYS ? 0 : 0.5 ** (Math.max(0, age) / HALF_LIFE_DAYS);
};

export type Summary = {
  level: Level;
  kept: number;
  noShows: number;
  lateCancels: number;
  upheld: number;
  upheldRecent: number; // in the last 12 months
  rate: number; // weighted share of good events (1 = nothing bad)
};

/** Keeps at most MAX_KEPT_PER_DAY kept-events per calendar day (UTC), newest day first. */
export function capPerDay(facts: Fact[]): Fact[] {
  const perDay = new Map<string, number>();
  return [...facts]
    .sort((a, b) => +b.at - +a.at)
    .filter((f) => {
      if (f.kind !== 'kept') return true;
      const day = f.at.toISOString().slice(0, 10);
      const n = perDay.get(day) ?? 0;
      perDay.set(day, n + 1);
      return n < MAX_KEPT_PER_DAY;
    });
}

export function summarise(all: Fact[], now = new Date()): Summary {
  const facts = capPerDay(all).filter((f) => weightOf(f.at, now) > 0);
  let good = 0;
  let bad = 0;
  let kept = 0;
  let noShows = 0;
  let lateCancels = 0;
  let upheld = 0;
  let upheldRecent = 0;
  for (const f of facts) {
    const w = weightOf(f.at, now);
    if (f.kind === 'kept') {
      good += w;
      kept++;
    } else {
      bad += w * PENALTY[f.kind];
      if (f.kind === 'no_show') noShows++;
      else if (f.kind === 'upheld_report') {
        upheld++;
        if (+now - +f.at < 365 * DAY) upheldRecent++;
      } else lateCancels++;
    }
  }
  const negatives = noShows + lateCancels + upheld;
  const rate = good + bad === 0 ? 1 : good / (good + bad);
  let level: Level;
  // Someone with little history is "New", not "low": one slip early on does not label them
  if (kept < RELIABLE_AT && negatives < 2 && upheldRecent === 0) level = 'new';
  else if (upheldRecent >= 2 || (negatives >= 2 && rate < 0.6) || (upheldRecent >= 1 && rate < 0.75)) level = 'needs_care';
  else if (kept >= VERY_RELIABLE_AT && rate >= 0.9 && upheldRecent === 0) level = 'very_reliable';
  else level = 'reliable';
  return { level, kept, noShows, lateCancels, upheld, upheldRecent, rate };
}

/** A line of plain words for one event. */
export const describe = (f: Fact) =>
  f.kind === 'kept'
    ? `Kept: ${f.label}`
    : f.kind === 'no_show'
      ? `Confirmed no-show: ${f.label}`
      : f.kind === 'late_cancel'
        ? `Left late: ${f.label}`
        : f.kind === 'host_late_cancel'
          ? `Cancelled late as host: ${f.label}`
          : `A moderator upheld a report: ${f.label}`;

/** What the person can do to get to the next level, in plain words. */
export function nextStep(s: Summary): string {
  if (s.level === 'new') return `Go to ${Math.max(1, 3 - s.kept)} more ${3 - s.kept <= 1 ? 'plan' : 'plans'} to become Reliable.`;
  if (s.level === 'reliable') return s.kept < 10 ? `Keep going to plans: ${10 - s.kept} more kept plans (and no recent problems) make you Very reliable.` : 'Fewer recent problems would make you Very reliable.';
  if (s.level === 'needs_care') return 'Keep your next plans and avoid last-minute cancellations. Older problems count less every month.';
  return 'You are at the top level. Keep it up.';
}

/**
 * "How your level works", in plain words, as short cards (what / how / why), like the retention page. Written from the same
 * constants the rules use, so the text can never disagree with what the system does.
 */
export function reliabilityInfo() {
  const years = HORIZON_DAYS / 365;
  return [
    { what: 'What it is', how: 'A level that shows how dependable someone has been at turning up: New, Reliable, Very reliable or Needs care.', why: 'It helps hosts and members choose who to meet. It is not a score to compete on.' },
    { what: 'What counts', how: 'Plans and trips you were approved for that have finished. Ones that were cancelled, or that you only asked to join, do not.', why: 'Only real, completed meetups should shape a level.' },
    { what: 'Starting out', how: `Everyone starts as New. After ${RELIABLE_AT} kept plans you become Reliable, and after ${VERY_RELIABLE_AT} with a clean record, Very reliable.`, why: 'A newcomer is never marked down just for having no history.' },
    { what: 'What lowers it', how: `A host saying you did not come (if you do not dispute it), leaving a plan in its last ${LATE_ACTIVITY_H} hours, or a report that a moderator upheld.`, why: 'Reports on their own never count. A moderator has to uphold them.' },
    { what: 'If a host says you did not come', how: `You are told, and you have ${DISPUTE_DAYS} days to dispute it. A moderator decides, and can overturn it later.`, why: 'Nothing counts against you until then.' },
    { what: 'How long it counts', how: `Older events count less every month and drop out after ${years} years.`, why: 'You can always build your level back.' },
    { what: 'What it is not', how: 'It is not a safety guarantee, and it has nothing to do with whether people liked you, or with likes or profile views.', why: 'It only reflects turning up.' },
    { what: 'Who sees it', how: 'Verified members can see your level on your profile and when you ask to join.', why: 'People who are verified see each other on equal terms.' },
    { what: 'Your full details', how: 'Everything your level is based on is in your data download.', why: 'Settings, Your data, Download my data.' },
  ];
}
