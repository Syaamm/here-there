import type { Activity } from './api';

/**
 * HERE shows everything that is on from now on. How far ahead a plan can be made is set per city by its admin (a month
 * unless they set it otherwise, a year at the most), so the feed asks for a year and simply finds what exists.
 */
export function feedRange(): [Date, Date] {
  const from = new Date();
  const to = new Date(from);
  to.setFullYear(to.getFullYear() + 1);
  return [from, to];
}

export type FeedSection = { id: 'soon' | 'tonight' | 'tomorrow' | 'later'; title: string; items: Activity[] };

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Next 2 hours, then the rest of today ("Tonight"), then tomorrow, then everything further ahead ("Later"). Each activity lands in exactly one section; the server's order (best match first) is kept inside each. */
export function splitFeed(all: Activity[], now = new Date()): FeedSection[] {
  const soonCut = +now + 2 * 3600e3;
  const tomorrow = new Date(+now + 24 * 3600e3);
  const soon: Activity[] = [];
  const tonight: Activity[] = [];
  const tmrw: Activity[] = [];
  const later: Activity[] = [];
  for (const a of all) {
    const t = new Date(a.startsAt);
    if (+t <= soonCut) soon.push(a);
    else if (sameDay(t, now)) tonight.push(a);
    else if (sameDay(t, tomorrow)) tmrw.push(a);
    else if (+t > +now) later.push(a);
  }
  return [
    { id: 'soon', title: 'Next 2 hours', items: soon },
    { id: 'tonight', title: 'Tonight', items: tonight },
    { id: 'tomorrow', title: 'Tomorrow', items: tmrw },
    { id: 'later', title: 'Later', items: later },
  ];
}
