import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { PrismaService } from '../common/prisma.service';

/** One product's alerts plus the ones for both; no filter when the product is not given. */
function productFilter(raw?: string) {
  return raw === 'here' || raw === 'there' ? { OR: [{ product: raw }, { product: null }] } : {};
}

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Newest first, a page at a time: `?limit=` (default 100) and `?cursor=` from the previous answer's `nextCursor`.
   * `scope=alerts` leaves out new-message alerts (those belong to the Chats tab). `unreadCount` is always the whole count.
   */
  @Get()
  async list(@CurrentUser() me: User, @Query('unread') unread?: string, @Query('scope') scope?: string, @Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string, @Query('product') productRaw?: string) {
    const limit = pageLimit(limitRaw, 100);
    const cur = decodeKeyset(cursorRaw);
    const product = productFilter(productRaw);
    const rows = await this.prisma.notification.findMany({
      where: {
        userId: me.id,
        ...(unread === 'true' ? { readAt: null } : {}),
        ...(scope === 'alerts' ? { type: { not: 'chat_message' } } : {}),
        ...product,
        ...(cur ? { AND: [{ OR: [{ createdAt: { lt: cur.at } }, { createdAt: cur.at, id: { lt: cur.id } }] }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = sliceKeyset(rows, limit, (n) => n.createdAt);
    // unread that belongs to exactly one product, so the app can say "2 new in HERE" while you are in THERE
    const unreadWhere = { userId: me.id, readAt: null };
    const [unreadCount, here, there] = await Promise.all([
      this.prisma.notification.count({ where: unreadWhere }),
      this.prisma.notification.count({ where: { ...unreadWhere, product: 'here' } }),
      this.prisma.notification.count({ where: { ...unreadWhere, product: 'there' } }),
    ]);
    return {
      items: page.items.map((n) => ({ ...n, data: n.data ? JSON.parse(n.data) : null })),
      nextCursor: page.nextCursor,
      unreadCount,
      unreadByProduct: { here, there },
    };
  }

  @Post('read-all')
  async readAll(@CurrentUser() me: User, @Query('scope') scope?: string, @Query('product') productRaw?: string) {
    // scope=alerts: everything except new-message alerts, which belong to the Chats tab and are read by opening the chat
    // product: only that product's alerts (and the ones for both), so reading HERE never clears THERE
    await this.prisma.notification.updateMany({
      where: { userId: me.id, readAt: null, ...(scope === 'alerts' ? { type: { not: 'chat_message' } } : {}), ...productFilter(productRaw) },
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
