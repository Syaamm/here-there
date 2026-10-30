import { Injectable } from '@nestjs/common';
import { LiveService } from '../common/live.service';
import { PrismaService } from '../common/prisma.service';
import { PushService } from '../common/push.service';

export type Product = 'here' | 'there';

/** How long a second alert about the same thing still joins the first (instead of being a new one). */
export const GROUP_WINDOW_MS = 60 * 60 * 1000;
/** `marker` is a piece of the alert's data that identifies the thing (e.g. `"activityId":"abc"`); `title` words the grouped alert. */
export type NotifyOptions = { group?: { marker: string; windowMs?: number; title?: (count: number) => string } };

/** Which product an alert is about: an activity is HERE, a trip or travel match is THERE; null (follows, warnings, verification) is for both. */
export function productOf(type: string, data?: Record<string, unknown> | null): Product | null {
  const given = data?.product;
  if (given === 'here' || given === 'there') return given;
  if (data?.tripId || type === 'travel_match' || type.startsWith('trip_')) return 'there';
  if (data?.activityId || type.startsWith('activity_') || type.startsWith('host_handover')) return 'here';
  return null;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
    private readonly push: PushService,
  ) {}

  /**
   * The in-app record, then: an app that is open hears about it straight away (live connection); everyone else gets a
   * push. Chat messages are handled by the conversations service, which pushes every message, not just the first alert.
   */
  async notify(userId: string, type: string, title: string, body: string, data?: Record<string, unknown>, opts: NotifyOptions = {}) {
    // which product it belongs to travels with the alert, so an open app can tell a HERE alert from a THERE one
    const product = productOf(type, data);
    if (product && data) data.product = product;
    const url = (() => {
      const d = data as { activityId?: string; tripId?: string } | undefined;
      return d?.activityId ? `/activity/${d.activityId}` : d?.tripId ? `/trip/${d.tripId}` : '/inbox';
    })();
    // Repeats are grouped: if this person already has an unread alert of this kind about the same thing, it is updated with
    // a count instead of a second one being added (many messages in one chat, a plan edited several times in a row).
    if (opts.group) {
      const existing = await this.prisma.notification.findFirst({
        where: { userId, type, readAt: null, createdAt: { gte: new Date(Date.now() - (opts.group.windowMs ?? GROUP_WINDOW_MS)) }, data: { contains: opts.group.marker } },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const count = ((existing.data ? (JSON.parse(existing.data) as { count?: number }).count : 1) ?? 1) + 1;
        const merged = { ...data, count };
        const newTitle = opts.group.title ? opts.group.title(count) : title;
        // it moves back to the top of the list, so a chat that is still busy is not buried under older alerts
        await this.prisma.notification.update({ where: { id: existing.id }, data: { title: newTitle, body, data: JSON.stringify(merged), createdAt: new Date() } });
        this.live.send(userId, { type: 'alerts-changed' });
        if (type !== 'chat_message') this.push.queue(userId, { title: newTitle, body, url, alert: { type, data }, group: opts.group.marker });
        return;
      }
    }
    const n = await this.prisma.notification.create({
      data: { userId, type, title, body, data: data ? JSON.stringify(data) : null, product },
    });
    this.live.send(userId, { type: 'notification', notification: { id: n.id, type, title, body, data: data ?? null, createdAt: n.createdAt } });
    if (type !== 'chat_message') this.push.queue(userId, { title, body, url, alert: { type, data }, ...(opts.group ? { group: opts.group.marker } : {}) });
  }

  /**
   * A join request or trip application has been settled (approved, declined, withdrawn, closed): the host's "wants to
   * join" alert for that one person has nothing left to ask, so it goes away. Newer alerts carry the applicant's id;
   * older ones are matched by the name at the start of their text. The host's open apps are told to look again.
   */
  async settleRequest(hostId: string, type: 'join_request' | 'trip_application', scope: { activityId?: string; tripId?: string }, applicantId: string) {
    const scopeMarker = scope.activityId ? `"activityId":"${scope.activityId}"` : `"tripId":"${scope.tripId}"`;
    const profile = await this.prisma.profile.findUnique({ where: { userId: applicantId } });
    const name = profile?.displayName;
    const rows = await this.prisma.notification.findMany({ where: { userId: hostId, type, data: { contains: scopeMarker } } });
    const mine = rows.filter((n) => (n.data ?? '').includes(`"applicantId":"${applicantId}"`) || (!(n.data ?? '').includes('"applicantId"') && !!name && n.body.startsWith(`${name} `)));
    if (mine.length === 0) return;
    await this.prisma.notification.deleteMany({ where: { id: { in: mine.map((n) => n.id) } } });
    this.live.send(hostId, { type: 'alerts-changed' });
  }

  async notifyMany(userIds: string[], type: string, title: string, body: string, data?: Record<string, unknown>, opts: NotifyOptions = {}) {
    // each person gets their own copy of the data: notify() adds to it, and grouped alerts keep a count of their own
    for (const id of new Set(userIds)) await this.notify(id, type, title, body, data ? { ...data } : undefined, opts);
  }
}
