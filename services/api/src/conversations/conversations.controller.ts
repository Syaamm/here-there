import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { Conversation, User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { SafetyService } from '../safety/safety.service';

const sendSchema = z.object({ body: z.string().trim().min(1).max(2000) });

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly limiter: RateLimiter,
  ) {}

  /**
   * Authorization is derived from LIVE membership rows on every call (spec 5.1 / 10.3),
   * so rejection, leaving, removal or suspension revokes access instantly.
   * Returns whether the scope is still writable.
   */
  private async assertAccess(me: User, conversationId: string): Promise<{ conv: Conversation; writable: boolean }> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw E.notFound('Conversation');

    if (conv.scopeType === 'activity' && conv.activityId) {
      const m = await this.prisma.activityMembership.findUnique({
        where: { activityId_userId: { activityId: conv.activityId, userId: me.id } },
      });
      if (!m || m.state !== 'approved') throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to approved members');
      const a = await this.prisma.activity.findUniqueOrThrow({ where: { id: conv.activityId } });
      return { conv, writable: !['cancelled', 'archived'].includes(a.status) };
    }
    if (conv.scopeType === 'trip' && conv.tripId) {
      const m = await this.prisma.tripMembership.findUnique({
        where: { tripId_userId: { tripId: conv.tripId, userId: me.id } },
      });
      if (!m || m.state !== 'approved') throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to approved members');
      const t = await this.prisma.trip.findUniqueOrThrow({ where: { id: conv.tripId } });
      return { conv, writable: !['cancelled'].includes(t.status) };
    }
    throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to approved members');
  }

  async messages(me: User, id: string, cursor?: string, limit = 50) {
    const { writable } = await this.assertAccess(me, id);
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
      include: { sender: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
    const page = rows.slice(0, take);
    return {
      writable,
      items: page
        .map((m) => ({
          id: m.id,
          body: m.body,
          createdAt: m.createdAt,
          sender: { id: m.sender.id, displayName: m.sender.profile?.displayName ?? 'Member' },
        }))
        .reverse(),
      nextCursor:
        rows.length > take ? Buffer.from(page[page.length - 1].createdAt.toISOString()).toString('base64url') : null,
    };
  }

  async send(me: User, id: string, body: unknown) {
    const dto = parse(sendSchema, body);
    const { writable } = await this.assertAccess(me, id);
    if (!writable) throw E.conflict('CONVERSATION_CLOSED', 'This conversation is closed');
    const bad = contentProblem(dto.body);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);

    // new accounts get tighter limits (spec 5.1)
    const isNew = Date.now() - me.createdAt.getTime() < 24 * 3600 * 1000;
    this.limiter.hit(`msg:${me.id}`, isNew ? 10 : 30, 60 * 1000);

    const m = await this.prisma.message.create({ data: { conversationId: id, senderId: me.id, body: dto.body } });
    return { id: m.id, body: m.body, createdAt: m.createdAt };
  }

  async mine(me: User) {
    const [acts, trips] = await Promise.all([
      this.prisma.activityMembership.findMany({
        where: { userId: me.id, state: 'approved' },
        include: { activity: { include: { conversation: true } } },
      }),
      this.prisma.tripMembership.findMany({
        where: { userId: me.id, state: 'approved' },
        include: { trip: { include: { conversation: true } } },
      }),
    ]);
    return {
      items: [
        ...acts.filter((m) => m.activity.conversation).map((m) => ({
          conversationId: m.activity.conversation!.id,
          scope: 'activity',
          scopeId: m.activityId,
          title: m.activity.title,
        })),
        ...trips.filter((m) => m.trip.conversation).map((m) => ({
          conversationId: m.trip.conversation!.id,
          scope: 'trip',
          scopeId: m.tripId,
          title: m.trip.title,
        })),
      ],
    };
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

  @Post('conversations/:id/messages')
  send(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.conversations.send(me, id, body);
  }
}
