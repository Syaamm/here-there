import type { Activity } from './api';

export type MyActivitiesData = { joined: (Activity & { role: string })[]; requests: { requestId: string; state: string; activity: Activity }[] };
export type MyActivityItem = {
  key: string;
  activity: Activity;
  /** mine = hosted or going, pending = waiting for the host, rejected = the host said no */
  kind: 'mine' | 'pending' | 'rejected';
  label: string;
  tone: 'ok' | 'warn' | 'bad';
  hostOf: boolean;
};

/** Everything the person hosts, joined or asked to join, newest start first. Withdrawn requests are not listed. */
export function myActivityItems(d: MyActivitiesData | null | undefined): MyActivityItem[] {
  if (!d) return [];
  const items: MyActivityItem[] = [
    ...d.joined.map((a): MyActivityItem => ({ key: `j-${a.id}`, activity: a, kind: 'mine', label: a.role === 'host' ? 'You host this' : 'Going', tone: 'ok', hostOf: a.role === 'host' })),
    ...d.requests
      .filter((r) => r.state === 'requested' || r.state === 'declined')
      .map((r): MyActivityItem => ({
        key: `r-${r.requestId}`,
        activity: r.activity,
        kind: r.state === 'requested' ? 'pending' : 'rejected',
        label: r.state === 'requested' ? 'Request pending' : 'Not approved',
        tone: r.state === 'requested' ? 'warn' : 'bad',
        hostOf: false,
      })),
  ];
  return items.sort((x, y) => +new Date(y.activity.startsAt) - +new Date(x.activity.startsAt));
}
