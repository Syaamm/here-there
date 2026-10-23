import { Injectable } from '@nestjs/common';
import { LiveService } from '../common/live.service';
import { PrismaService } from '../common/prisma.service';
import { PushService } from '../common/push.service';

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
  async notify(userId: string, type: string, title: string, body: string, data?: Record<string, unknown>) {
    const n = await this.prisma.notification.create({
      data: { userId, type, title, body, data: data ? JSON.stringify(data) : null },
    });
    this.live.send(userId, { type: 'notification', notification: { id: n.id, type, title, body, data: data ?? null, createdAt: n.createdAt } });
    if (type !== 'chat_message') {
      const d = data as { activityId?: string; tripId?: string } | undefined;
      const url = d?.activityId ? `/activity/${d.activityId}` : d?.tripId ? `/trip/${d.tripId}` : '/inbox';
      void this.push.send(userId, { title, body, url });
    }
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

  async notifyMany(userIds: string[], type: string, title: string, body: string, data?: Record<string, unknown>) {
    for (const id of new Set(userIds)) await this.notify(id, type, title, body, data);
  }
}
