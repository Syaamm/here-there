import type { Activity } from './api';

/** HERE shows what is happening in the next two days at most: now until the end of tomorrow. */
export function feedRange(): [Date, Date] {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  to.setHours(23, 59, 59, 0);
  return [from, to];
}

export type FeedSection = { id: 'soon' | 'tonight' | 'tomorrow'; title: string; items: Activity[] };

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Next 2 hours, then the rest of today ("Tonight"), then tomorrow. Each activity lands in exactly one section; the server's order (best match first) is kept inside each. */
export function splitFeed(all: Activity[], now = new Date()): FeedSection[] {
  const soonCut = +now + 2 * 3600e3;
  const tomorrow = new Date(+now + 24 * 3600e3);
  const soon: Activity[] = [];
  const tonight: Activity[] = [];
  const tmrw: Activity[] = [];
  for (const a of all) {
    const t = new Date(a.startsAt);
    if (+t <= soonCut) soon.push(a);
    else if (sameDay(t, now)) tonight.push(a);
    else if (sameDay(t, tomorrow)) tmrw.push(a);
  }
  return [
    { id: 'soon', title: 'Next 2 hours', items: soon },
    { id: 'tonight', title: 'Tonight', items: tonight },
    { id: 'tomorrow', title: 'Tomorrow', items: tmrw },
  ];
}
