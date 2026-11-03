import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { decodeKeyset, pageLimit, sliceKeyset, pageOf } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';

export const followSchema = z.object({ userId: z.string().min(1) });

/**
 * Following and buddies. Follow is one way and instant; two people who follow each other are buddies. Lists are private:
 * you only ever see your own following, followers and buddies, never anyone else's. Blocking removes the link both ways.
 */
@Controller('v1')
export class FollowsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('follows')
  async follow(@CurrentUser() me: User, @Body() body: unknown) {
    const { userId } = parse(followSchema, body);
    if (userId === me.id) throw E.badRequest('INVALID_TARGET', 'You cannot follow yourself');
    const target = await this.prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    if (!target || target.state !== 'active' || !target.profile) throw E.notFound('User');
    const blocked = await this.prisma.block.findFirst({ where: { OR: [{ blockerId: me.id, blockedId: userId }, { blockerId: userId, blockedId: me.id }] } });
    if (blocked) throw E.notFound('User'); // never reveal that someone blocked you
    const existing = await this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me.id, followingId: userId } } });
    if (!existing) {
      this.limiter.hit(`follow:${me.id}`, 100, 24 * 3600 * 1000); // follow sprees
      await this.prisma.follow.create({ data: { followerId: me.id, followingId: userId } });
      const mine = await this.prisma.profile.findUnique({ where: { userId: me.id } });
      const back = await this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: userId, followingId: me.id } } });
      const name = mine?.displayName ?? 'Someone';
      await this.notifications.notify(userId, 'follow', back ? 'You are now buddies' : 'New follower', back ? `You and ${name} follow each other.` : `${name} started following you.`, { userId: me.id });
    }
    return this.relation(me.id, userId);
  }

  @Delete('follows/:userId')
  async unfollow(@CurrentUser() me: User, @Param('userId') userId: string) {
    await this.prisma.follow.deleteMany({ where: { followerId: me.id, followingId: userId } });
    return this.relation(me.id, userId);
  }

  /**
   * kind: following (people I follow who do not follow back), followers (people who follow me and I do not follow back)
   * or buddies (both ways). Newest first, a page at a time (`limit`, `cursor`). `counts` is the size of all three lists.
   * Closed, hidden and blocked accounts are left out of the lists and the counts alike.
   */
  @Get('me/connections')
  async connections(@CurrentUser() me: User, @Query('kind') kind?: string, @Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string) {
    // an account that can be listed: open, with a profile, and nobody blocked anybody
    const listable = { state: 'active', profile: { isNot: null }, blocksMade: { none: { blockedId: me.id } }, blocksReceived: { none: { blockerId: me.id } } };
    // people I follow: a buddy when they follow me back. People who follow me: shown here only when I do not follow back.
    const iFollow = (back: 'some' | 'none') => ({ followerId: me.id, following: { ...listable, following: { [back]: { followingId: me.id } } } });
    const followMe = { followingId: me.id, follower: { ...listable, followers: { none: { followerId: me.id } } } };
    const where = { buddies: iFollow('some'), following: iFollow('none'), followers: followMe } as const;
    const which = kind === 'followers' || kind === 'buddies' ? kind : 'following';

    const [buddies, following, followers] = await Promise.all([
      this.prisma.follow.count({ where: where.buddies }),
      this.prisma.follow.count({ where: where.following }),
      this.prisma.follow.count({ where: where.followers }),
    ]);

    const page = await pageOf((a) => this.prisma.follow.findMany({ ...a, include: { following: { include: { profile: true } }, follower: { include: { profile: true } } } }), { limit: pageLimit(limitRaw, 100), cursor: cursorRaw, where: where[which] });
    const otherIds = page.items.map((f) => (which === 'followers' ? f.followerId : f.followingId));
    // who of these also follows me / is followed by me (for the "Follow back" button and the Buddy tag)
    const [iFollowThem, theyFollowMe] = await Promise.all([
      this.prisma.follow.findMany({ where: { followerId: me.id, followingId: { in: otherIds } }, select: { followingId: true } }),
      this.prisma.follow.findMany({ where: { followingId: me.id, followerId: { in: otherIds } }, select: { followerId: true } }),
    ]);
    const outIds = new Set(iFollowThem.map((f) => f.followingId));
    const inIds = new Set(theyFollowMe.map((f) => f.followerId));
    const items = page.items.map((f) => {
      const u = which === 'followers' ? f.follower : f.following;
      return {
        userId: u.id,
        displayName: u.profile!.displayName,
        homeCity: u.profile!.homeCity,
        photoUrl: u.profile!.photoUrl,
        verifiedAdult: u.eligibility === 'verified',
        following: outIds.has(u.id),
        followsYou: inIds.has(u.id),
        buddy: outIds.has(u.id) && inIds.has(u.id),
      };
    });
    return { counts: { following, followers, buddies }, items, nextCursor: page.nextCursor };
  }

  private async relation(me: string, other: string) {
    const [a, b] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: other } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: other, followingId: me } } }),
    ]);
    return { following: !!a, followsYou: !!b, buddy: !!a && !!b };
  }
}
