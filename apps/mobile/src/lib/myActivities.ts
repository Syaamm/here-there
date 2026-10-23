import type { Activity } from './api';

export type MyActivitiesData = { joined: (Activity & { role: string })[]; requests: { requestId: string; state: string; activity: Activity }[] };
export type MyActivityItem = {
  key: string;
  activity: Activity;
  /** mine = hosted or going, pending = waiting for the host, rejected = the host said no */
  kind: 'mine' | 'pending' | 'rejected';
  label: string;
  tone: 'ok' | 'warn' | 'bad';
  /** the person hosts it and it is still upcoming, so there are requests to manage */
  hostOf: boolean;
};

const HOUR = 3600e3;
const FINISHED = ['cancelled', 'completed', 'archived'];

/**
 * What is coming up for the person: happening right now, or starting within `hours`. Soonest start first; at the same
 * start, what they host comes before what they are going to, and that before what they have only asked for.
 */
export function comingUp(d: MyActivitiesData | null | undefined, now = Date.now(), hours = 3): MyActivityItem[] {
  const rank = (x: MyActivityItem) => (x.label === 'You host this' ? 0 : x.kind === 'mine' ? 1 : 2);
  return myActivityItems(d)
    .filter((x) => x.kind !== 'rejected' && !FINISHED.includes(x.activity.status) && +new Date(x.activity.endsAt) > now && +new Date(x.activity.startsAt) <= now + hours * HOUR)
    .sort((x, y) => +new Date(x.activity.startsAt) - +new Date(y.activity.startsAt) || rank(x) - rank(y));
}

/** The plans the person already has (hosting, going, or asked) whose time overlaps this activity's. */
export function clashesWith(d: MyActivitiesData | null | undefined, a: Pick<Activity, 'id' | 'startsAt' | 'endsAt'>, now = Date.now()): MyActivityItem[] {
  const start = +new Date(a.startsAt);
  const end = +new Date(a.endsAt);
  return myActivityItems(d).filter(
    (x) => x.activity.id !== a.id && x.kind !== 'rejected' && !FINISHED.includes(x.activity.status) && +new Date(x.activity.endsAt) > now && +new Date(x.activity.startsAt) < end && start < +new Date(x.activity.endsAt),
  );
}

/** Everything the person hosts, joined or asked to join, newest start first. Withdrawn requests are not listed. */
export function myActivityItems(d: MyActivitiesData | null | undefined): MyActivityItem[] {
  if (!d) return [];
  const items: MyActivityItem[] = [
    ...d.joined.map((a): MyActivityItem => ({ key: `j-${a.id}`, activity: a, kind: 'mine', label: a.role === 'host' ? 'You host this' : 'Going', tone: 'ok', hostOf: a.role === 'host' && !['completed', 'archived', 'cancelled', 'in_progress'].includes(a.status) })),
    ...d.requests
      .filter((r) => r.state === 'requested' || r.state === 'waitlisted' || r.state === 'declined')
      .map((r): MyActivityItem => ({
        key: `r-${r.requestId}`,
        activity: r.activity,
        kind: r.state === 'declined' ? 'rejected' : 'pending',
        label: r.state === 'requested' ? 'Request pending' : r.state === 'waitlisted' ? 'On the waiting list' : 'Rejected',
        tone: r.state === 'declined' ? 'bad' : 'warn',
        hostOf: false,
      })),
  ];
  return items.sort((x, y) => +new Date(y.activity.startsAt) - +new Date(x.activity.startsAt));
}
