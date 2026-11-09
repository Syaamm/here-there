import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { decodeKeyset, pageLimit, sliceKeyset, pageOf } from '../common/paging';
import { PrismaService } from '../common/prisma.service';

/** One product's alerts plus the ones for both; no filter when the product is not given. */
function productFilter(raw?: string) {
  return raw === 'here' || raw === 'there' ? { OR: [{ product: raw }, { product: null }] } : {};
}

/** Alerts that wait for the person to do something: they are only read once it is done, never by "Mark all read". */
export const ACTION_TYPES = ['join_request', 'trip_application', 'host_handover_offer', 'trip_dates_proposed'];

@Controller('v1/notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Newest first, a page at a time: `?limit=` (default 100) and `?cursor=` from the previous answer's `nextCursor`.
   * `scope=alerts` leaves out new-message alerts (those belong to the Chats tab). `unreadCount` is always the whole count.
   */
  @Get()
  async list(@CurrentUser() me: User, @Query('unread') unread?: string, @Query('scope') scope?: string, @Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string, @Query('product') productRaw?: string) {
    const product = productFilter(productRaw);
    const page = await pageOf((a) => this.prisma.notification.findMany(a), {
      limit: pageLimit(limitRaw, 100),
      cursor: cursorRaw,
      where: {
        userId: me.id,
        ...(unread === 'true' ? { readAt: null } : {}),
        ...(scope === 'alerts' ? { type: { not: 'chat_message' } } : {}),
        ...product,
      },
    });
    // unread that belongs to exactly one product, so the app can say "2 new in HERE" while you are in THERE
    // one grouped count instead of three separate ones: total unread, and the unread of exactly one product
    const byProduct = await this.prisma.notification.groupBy({ by: ['product'], where: { userId: me.id, readAt: null }, _count: { _all: true } });
    const countOf = (p: string | null) => byProduct.find((g) => g.product === p)?._count._all ?? 0;
    const unreadCount = byProduct.reduce((n, g) => n + g._count._all, 0);
    const here = countOf('here');
    const there = countOf('there');
    return {
      items: await this.withReasons(page.items.map((n) => ({ ...n, data: (n.data ? JSON.parse(n.data) : null) as Record<string, unknown> | null }))),
      nextCursor: page.nextCursor,
      unreadCount,
      unreadByProduct: { here, there },
    };
  }

  /**
   * A moderator's warning or removed message opens to show what the moderator wrote. Alerts sent before the reason was stored
   * with them get it here from the warning or the message itself (two small reads for the whole page, only when needed).
   */
  private async withReasons<T extends { type: string; data: Record<string, unknown> | null }>(items: T[]): Promise<T[]> {
    const warnIds = items.filter((n) => n.type === 'warning' && n.data?.warningId && (!n.data.reason || !n.data.aboutId)).map((n) => String(n.data!.warningId));
    const msgIds = items.filter((n) => n.type === 'message_removed' && n.data?.messageId && !n.data.reason).map((n) => String(n.data!.messageId));
    if (warnIds.length === 0 && msgIds.length === 0) return items;
    const [warns, msgs] = await Promise.all([
      warnIds.length ? this.prisma.userWarning.findMany({ where: { id: { in: warnIds } }, select: { id: true, reason: true, aboutType: true, aboutId: true } }) : [],
      msgIds.length ? this.prisma.message.findMany({ where: { id: { in: msgIds } }, select: { id: true, removedReason: true } }) : [],
    ]);
    const reasonOf = new Map<string, string | null>([...warns.map((w) => [w.id, w.reason] as const), ...msgs.map((m) => [m.id, m.removedReason] as const)]);
    // older warnings: the plan they are about, with its name, so the alert and the warning's page can say which one it was
    const plans = warns.filter((w) => w.aboutId && w.aboutType);
    const [acts, trips] = await Promise.all([
      plans.some((w) => w.aboutType === 'activity') ? this.prisma.activity.findMany({ where: { id: { in: plans.filter((w) => w.aboutType === 'activity').map((w) => w.aboutId!) } }, select: { id: true, title: true } }) : [],
      plans.some((w) => w.aboutType === 'trip') ? this.prisma.trip.findMany({ where: { id: { in: plans.filter((w) => w.aboutType === 'trip').map((w) => w.aboutId!) } }, select: { id: true, title: true } }) : [],
    ]);
    const titleOf = new Map<string, string>([...acts, ...trips].map((p) => [p.id, p.title] as const));
    const aboutOf = new Map(plans.filter((w) => titleOf.has(w.aboutId!)).map((w) => [w.id, { aboutType: w.aboutType!, aboutId: w.aboutId!, aboutTitle: titleOf.get(w.aboutId!)! }] as const));
    return items.map((n) => {
      const key = n.type === 'warning' ? n.data?.warningId : n.type === 'message_removed' ? n.data?.messageId : undefined;
      const reason = key ? reasonOf.get(String(key)) : undefined;
      const about = n.type === 'warning' && key && !n.data?.aboutId ? aboutOf.get(String(key)) : undefined;
      return reason || about ? { ...n, data: { ...n.data, ...(n.data?.reason ? {} : reason ? { reason } : {}), ...(about ?? {}) } } : n;
    });
  }

  @Post('read-all')
  async readAll(@CurrentUser() me: User, @Query('scope') scope?: string, @Query('product') productRaw?: string) {
    // scope=alerts: the alerts that only tell you something. New-message alerts belong to the Chats tab, and alerts that wait
    // for you to act (a join request or application to answer, hosting offered to you, trip dates to confirm) stay until you
    // act on them: those are marked read when they are answered, never by "Mark all read".
    // scope=chats: the new-message alerts (the Chats tab's own "Mark all read").
    // product: only that product's alerts (and the ones for both), so reading HERE never clears THERE
    const types = scope === 'alerts' ? { type: { notIn: ['chat_message', ...ACTION_TYPES] } } : scope === 'chats' ? { type: 'chat_message' } : { type: { notIn: ACTION_TYPES } };
    await this.prisma.notification.updateMany({
      where: { userId: me.id, readAt: null, ...types, ...productFilter(productRaw) },
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
