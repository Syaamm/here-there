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

  async notifyMany(userIds: string[], type: string, title: string, body: string, data?: Record<string, unknown>) {
    for (const id of new Set(userIds)) await this.notify(id, type, title, body, data);
  }
}
