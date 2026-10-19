import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** In-app record now; push (APNs/FCM via Expo) plugs in here later. */
  async notify(userId: string, type: string, title: string, body: string, data?: Record<string, unknown>) {
    await this.prisma.notification.create({
      data: { userId, type, title, body, data: data ? JSON.stringify(data) : null },
    });
  }

  async notifyMany(userIds: string[], type: string, title: string, body: string, data?: Record<string, unknown>) {
    for (const id of new Set(userIds)) await this.notify(id, type, title, body, data);
  }
}
