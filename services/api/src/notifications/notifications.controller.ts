import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() me: User, @Query('unread') unread?: string) {
    const items = await this.prisma.notification.findMany({
      where: { userId: me.id, ...(unread === 'true' ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      items: items.map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null })),
      unreadCount: await this.prisma.notification.count({ where: { userId: me.id, readAt: null } }),
    };
  }

  @Post('read-all')
  async readAll(@CurrentUser() me: User, @Query('scope') scope?: string) {
    // scope=alerts: everything except new-message alerts, which belong to the Chats tab and are read by opening the chat
    await this.prisma.notification.updateMany({
      where: { userId: me.id, readAt: null, ...(scope === 'alerts' ? { type: { not: 'chat_message' } } : {}) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Post(':id/read')
  async read(@CurrentUser() me: User, @Param('id') id: string) {
    const n = await this.prisma.notification.findFirst({ where: { id, userId: me.id } });
    if (!n) throw E.notFound('Notification');
    await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return { ok: true };
  }
}
