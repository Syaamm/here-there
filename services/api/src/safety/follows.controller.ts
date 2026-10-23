import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';

const followSchema = z.object({ userId: z.string().min(1) });

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

  /** kind: following (people I follow), followers (people who follow me) or buddies (both ways). */
  @Get('me/connections')
  async connections(@CurrentUser() me: User, @Query('kind') kind?: string) {
    const [out, inn] = await Promise.all([
      this.prisma.follow.findMany({ where: { followerId: me.id }, select: { followingId: true, createdAt: true } }),
      this.prisma.follow.findMany({ where: { followingId: me.id }, select: { followerId: true, createdAt: true } }),
    ]);
    const outIds = new Set(out.map((f) => f.followingId));
    const inIds = new Set(inn.map((f) => f.followerId));
    const buddyIds = [...outIds].filter((id) => inIds.has(id));
    // buddies are listed only under Buddies; Following and Followers hold everyone else
    const buddySet = new Set(buddyIds);
    const onlyFollowing = [...outIds].filter((id) => !buddySet.has(id));
    const onlyFollowers = [...inIds].filter((id) => !buddySet.has(id));
    const counts = { following: onlyFollowing.length, followers: onlyFollowers.length, buddies: buddyIds.length };
    const wanted = kind === 'followers' ? onlyFollowers : kind === 'buddies' ? buddyIds : onlyFollowing;
    const users = await this.prisma.user.findMany({
      where: { id: { in: wanted }, state: 'active' },
      include: { profile: true, blocksMade: { where: { blockedId: me.id } }, blocksReceived: { where: { blockerId: me.id } } },
    });
    const items = users
      .filter((u) => u.profile && u.blocksMade.length === 0 && u.blocksReceived.length === 0)
      .map((u) => ({
        userId: u.id,
        displayName: u.profile!.displayName,
        homeCity: u.profile!.homeCity,
        photoUrl: u.profile!.photoUrl,
        verifiedAdult: u.eligibility === 'verified',
        following: outIds.has(u.id),
        followsYou: inIds.has(u.id),
        buddy: outIds.has(u.id) && inIds.has(u.id),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { counts, items };
  }

  private async relation(me: string, other: string) {
    const [a, b] = await Promise.all([
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: other } } }),
      this.prisma.follow.findUnique({ where: { followerId_followingId: { followerId: other, followingId: me } } }),
    ]);
    return { following: !!a, followsYou: !!b, buddy: !!a && !!b };
  }
}
