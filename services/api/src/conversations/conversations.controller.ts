import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { Conversation, User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, requireVerified } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { SafetyService } from '../safety/safety.service';

const sendSchema = z.object({ body: z.string().trim().min(1).max(2000) });

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Authorization is derived from LIVE membership rows on every call (spec 5.1 / 10.3),
   * so rejection, leaving, removal or suspension revokes access instantly.
   * Returns whether the scope is still writable.
   */
  private async assertAccess(me: User, conversationId: string): Promise<{ conv: Conversation; writable: boolean; ended: boolean }> {
    // Chatting is for verified adults only, even for an approved member whose verification was later revoked.
    requireVerified(me);
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw E.notFound('Conversation');

    if (conv.scopeType === 'activity' && conv.activityId) {
      const m = await this.prisma.activityMembership.findUnique({
        where: { activityId_userId: { activityId: conv.activityId, userId: me.id } },
      });
      if (!m || m.state !== 'approved') throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to approved members');
      const a = await this.prisma.activity.findUniqueOrThrow({ where: { id: conv.activityId } });
      return { conv, writable: !['cancelled', 'archived'].includes(a.status), ended: a.status === 'cancelled' };
    }
    if (conv.scopeType === 'trip' && conv.tripId) {
      const m = await this.prisma.tripMembership.findUnique({
        where: { tripId_userId: { tripId: conv.tripId, userId: me.id } },
      });
      if (!m || m.state !== 'approved') throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to approved members');
      const t = await this.prisma.trip.findUniqueOrThrow({ where: { id: conv.tripId } });
      return { conv, writable: !['cancelled'].includes(t.status), ended: t.status === 'cancelled' };
    }
    throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to approved members');
  }

  async messages(me: User, id: string, cursor?: string, limit = 50) {
    const { writable, ended } = await this.assertAccess(me, id);
    // The host cancelled: the chat is terminated. Members get nothing back (the rows stay server-side for moderation).
    if (ended) return { writable: false, ended: true, items: [], nextCursor: null };
    const blocked = await this.safety.blockedWith(me.id);
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        moderationState: { not: 'removed' },
        senderId: { notIn: blocked },
        ...(cursor ? { createdAt: { lt: new Date(Buffer.from(cursor, 'base64url').toString()) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      include: { sender: { select: { id: true, profile: { select: { displayName: true, photoUrl: true } } } } },
    });
    const page = rows.slice(0, take);
    return {
      writable,
      ended: false,
      items: page
        .map((m) => ({
          id: m.id,
          body: m.body,
          createdAt: m.createdAt,
          sender: { id: m.sender.id, displayName: m.sender.profile?.displayName ?? 'Member', photoUrl: m.sender.profile?.photoUrl ?? null },
        }))
        .reverse(),
      nextCursor:
        rows.length > take ? Buffer.from(page[page.length - 1].createdAt.toISOString()).toString('base64url') : null,
    };
  }

  /**
   * "Group info" (like tapping the title in a messaging app): what the group is about and who is in it, with the host
   * marked as the group admin. Same access rule as reading the chat. People blocked either way are left out.
   */
  async info(me: User, id: string) {
    const { conv } = await this.assertAccess(me, id);
    const blocked = new Set(await this.safety.blockedWith(me.id));
    const person = (u: { id: string; eligibility: string; profile: { displayName: string; photoUrl: string | null } | null }, host: boolean) => ({
      id: u.id,
      displayName: u.profile?.displayName ?? 'Member',
      photoUrl: u.profile?.photoUrl ?? null,
      verifiedAdult: u.eligibility === 'verified',
      role: host ? ('host' as const) : ('member' as const),
      isMe: u.id === me.id,
    });
    const userSel = { select: { id: true, eligibility: true, profile: { select: { displayName: true, photoUrl: true } } } };
    const order = <T extends { role: string; displayName: string }>(xs: T[]) =>
      xs.sort((a, b) => (a.role === 'host' ? -1 : 0) - (b.role === 'host' ? -1 : 0) || a.displayName.localeCompare(b.displayName));

    if (conv.scopeType === 'activity' && conv.activityId) {
      const a = await this.prisma.activity.findUniqueOrThrow({ where: { id: conv.activityId } });
      const rows = await this.prisma.activityMembership.findMany({ where: { activityId: a.id, state: 'approved' }, include: { user: userSel } });
      const members = order(rows.filter((r) => r.userId === me.id || !blocked.has(r.userId)).map((r) => person(r.user, r.userId === a.hostId)));
      return {
        id: conv.id,
        scope: 'activity' as const,
        scopeId: a.id,
        title: a.title,
        category: a.category,
        status: a.status,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        place: `${a.venueName}, ${a.city}`,
        capacity: a.capacity,
        members,
      };
    }
    const t = await this.prisma.trip.findUniqueOrThrow({ where: { id: conv.tripId! } });
    const rows = await this.prisma.tripMembership.findMany({ where: { tripId: t.id, state: 'approved' }, include: { user: userSel } });
    const members = order(rows.filter((r) => r.userId === me.id || !blocked.has(r.userId)).map((r) => person(r.user, r.userId === t.hostId)));
    return {
      id: conv.id,
      scope: 'trip' as const,
      scopeId: t.id,
      title: t.title,
      category: null,
      status: t.status,
      startsAt: t.dateStart,
      endsAt: t.dateEnd,
      place: t.destination,
      capacity: t.maxCapacity,
      members,
    };
  }

  async send(me: User, id: string, body: unknown) {
    const dto = parse(sendSchema, body);
    const { conv, writable } = await this.assertAccess(me, id);
    if (!writable) throw E.conflict('CONVERSATION_CLOSED', 'This conversation is closed');
    const bad = contentProblem(dto.body);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);

    // new accounts get tighter limits (spec 5.1)
    const isNew = Date.now() - me.createdAt.getTime() < 24 * 3600 * 1000;
    this.limiter.hit(`msg:${me.id}`, isNew ? 10 : 30, 60 * 1000);

    const m = await this.prisma.message.create({ data: { conversationId: id, senderId: me.id, body: dto.body } });
    await this.notifyOthers(me, conv, dto.body);
    return { id: m.id, body: m.body, createdAt: m.createdAt };
  }

  /**
   * Tell the other approved members there is something new, without flooding them:
   * one unread "chat_message" alert per person per conversation until they read it.
   * People who blocked the sender (or were blocked by them) are skipped.
   */
  private async notifyOthers(sender: User, conv: Conversation, body: string) {
    let userIds: string[] = [];
    let title = 'your group';
    if (conv.scopeType === 'activity' && conv.activityId) {
      userIds = (await this.prisma.activityMembership.findMany({ where: { activityId: conv.activityId, state: 'approved' } })).map((m) => m.userId);
      title = (await this.prisma.activity.findUnique({ where: { id: conv.activityId } }))?.title ?? title;
    } else if (conv.scopeType === 'trip' && conv.tripId) {
      userIds = (await this.prisma.tripMembership.findMany({ where: { tripId: conv.tripId, state: 'approved' } })).map((m) => m.userId);
      title = (await this.prisma.trip.findUnique({ where: { id: conv.tripId } }))?.title ?? title;
    }
    const blocked = new Set(await this.safety.blockedWith(sender.id));
    const name = (await this.prisma.profile.findUnique({ where: { userId: sender.id } }))?.displayName ?? 'Someone';
    const marker = `"conversationId":"${conv.id}"`;
    for (const userId of userIds) {
      if (userId === sender.id || blocked.has(userId)) continue;
      const alreadyUnread = await this.prisma.notification.findFirst({
        where: { userId, type: 'chat_message', readAt: null, data: { contains: marker } },
      });
      if (alreadyUnread) continue;
      await this.notifications.notify(userId, 'chat_message', `New message in ${title}`, `${name}: ${body.slice(0, 80)}`, { conversationId: conv.id });
    }
  }

  async mine(me: User) {
    const [acts, trips] = await Promise.all([
      this.prisma.activityMembership.findMany({
        where: { userId: me.id, state: 'approved', activity: { status: { not: 'cancelled' } } },
        include: { activity: { include: { conversation: true } } },
      }),
      this.prisma.tripMembership.findMany({
        where: { userId: me.id, state: 'approved', trip: { status: { not: 'cancelled' } } },
        include: { trip: { include: { conversation: true } } },
      }),
    ]);
    const items = [
      ...acts.filter((m) => m.activity.conversation).map((m) => ({
        conversationId: m.activity.conversation!.id,
        scope: 'activity' as const,
        scopeId: m.activityId,
        title: m.activity.title,
        category: m.activity.category as string | null,
        startsAt: m.activity.startsAt,
      })),
      ...trips.filter((m) => m.trip.conversation).map((m) => ({
        conversationId: m.trip.conversation!.id,
        scope: 'trip' as const,
        scopeId: m.tripId,
        title: m.trip.title,
        category: null as string | null,
        startsAt: m.trip.dateStart,
      })),
    ];
    // Soonest first: what is coming up next leads, then what has already started, most recent first.
    const now = Date.now();
    const rank = (x: { startsAt: Date }) => (+x.startsAt >= now ? +x.startsAt - now : Number.MAX_SAFE_INTEGER / 2 + (now - +x.startsAt));
    return { items: items.sort((x, y) => rank(x) - rank(y)) };
  }
}

@Controller('v1')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get('me/conversations')
  mine(@CurrentUser() me: User) {
    return this.conversations.mine(me);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.conversations.messages(me, id, cursor, limit ? Number(limit) || 50 : 50);
  }

  @Get('conversations/:id/info')
  info(@CurrentUser() me: User, @Param('id') id: string) {
    return this.conversations.info(me, id);
  }

  @Post('conversations/:id/messages')
  send(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.conversations.send(me, id, body);
  }
}
