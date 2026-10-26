import { Body, Controller, Delete, Get, Injectable, Param, Post, Put } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { topK } from '../activities/feed-ranking';
import { AuditService } from '../common/audit.service';
import { CurrentUser, requireVerified } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { ReliabilityService } from '../reliability/reliability.controller';
import { SafetyService } from '../safety/safety.service';
import { planningHorizon } from '../trips/trips.service';

const DAY = 24 * 3600 * 1000;
/** Most people shown at once. */
export const MAX_SUGGESTIONS = 20;

export const prefSchema = z.object({
  destination: z.string().trim().min(2).max(100),
  dateStart: z.coerce.date(),
  dateEnd: z.coerce.date(),
});
export const choiceSchema = z.object({ choice: z.enum(['yes', 'pass']) });

const keyOf = (destination: string) => destination.toLowerCase().replace(/\s+/g, ' ').trim();
/** "lisbon" matches "lisbon, portugal" and the other way round. */
const sameplace = (a: string, b: string) => a === b || a.includes(b) || b.includes(a);
const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Travel buddy matching (T-03). It is opt-in and works in both directions at once: a person says where and when they want
 * to travel, and sees other opted-in verified travelers going to the same place on overlapping dates. Saying yes to
 * someone reveals nothing to them. Only when BOTH have said yes does a private two-person chat open; until then neither
 * can contact the other, and nobody can see who said yes to them. Either person can end the chat, and blocking ends it too.
 * (This is separate from following people and buddies.)
 */
@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly notifications: NotificationsService,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly reliability: ReliabilityService,
  ) {}

  async overview(me: User) {
    requireVerified(me);
    const pref = await this.prisma.travelMatchPref.findUnique({ where: { userId: me.id } });
    const live = pref && pref.dateEnd.getTime() >= Date.now() - DAY ? pref : null;
    return {
      pref: live && { destination: live.destination, dateStart: live.dateStart, dateEnd: live.dateEnd },
      suggestions: live ? await this.suggestions(me, live) : [],
    };
  }

  async setPref(me: User, body: unknown) {
    requireVerified(me);
    const dto = parse(prefSchema, body);
    const bad = contentProblem(dto.destination);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dto.dateStart < today) throw E.badRequest('INVALID_DATES', 'The trip must start today or later');
    if (dto.dateEnd < dto.dateStart) throw E.badRequest('INVALID_DATES', 'End date must not be before start date');
    if ((+dto.dateEnd - +dto.dateStart) / DAY > 90) throw E.badRequest('INVALID_DATES', 'Trips can span at most 90 days');
    if (dto.dateEnd > planningHorizon()) throw E.badRequest('INVALID_DATES', 'Trips can only be planned up to six months ahead');
    this.limiter.hit(`match-pref:${me.id}`, 20, DAY);
    const data = { destination: dto.destination, destinationKey: keyOf(dto.destination), dateStart: dto.dateStart, dateEnd: dto.dateEnd };
    await this.prisma.travelMatchPref.upsert({ where: { userId: me.id }, create: { userId: me.id, ...data }, update: data });
    // a new place or dates starts a fresh round: earlier answers about other people no longer apply
    await this.prisma.travelMatchChoice.deleteMany({ where: { fromId: me.id } });
    await this.audit.log(me.id, 'match.opt_in', 'user', me.id);
    return this.overview(me);
  }

  /** Switch matching off: the person is no longer suggested to anyone. Chats that already opened stay until someone ends them. */
  async clearPref(me: User) {
    await this.prisma.travelMatchPref.deleteMany({ where: { userId: me.id } });
    await this.prisma.travelMatchChoice.deleteMany({ where: { fromId: me.id } });
    await this.audit.log(me.id, 'match.opt_out', 'user', me.id);
    return { ok: true };
  }

  /** Who is both a possible match and allowed to be shown. Used for suggestions and to check an answer. */
  private async candidates(me: User, pref: { destinationKey: string; dateStart: Date; dateEnd: Date }) {
    const blocked = await this.safety.blockedWith(me.id);
    const rows = await this.prisma.travelMatchPref.findMany({
      where: { userId: { notIn: [me.id, ...blocked] }, dateStart: { lte: pref.dateEnd }, dateEnd: { gte: pref.dateStart } },
      take: 300,
      include: { user: { select: { id: true, state: true, eligibility: true, verifiedUntil: true, profile: { select: { displayName: true, photoUrl: true, homeCity: true, bio: true, interests: true } } } } },
    });
    const now = new Date();
    return rows.filter(
      (r) => sameplace(pref.destinationKey, r.destinationKey) && r.dateEnd >= now && r.user.state === 'active' && r.user.eligibility === 'verified' && (!r.user.verifiedUntil || r.user.verifiedUntil > now),
    );
  }

  private async suggestions(me: User, pref: { destinationKey: string; dateStart: Date; dateEnd: Date }) {
    const [all, mine, existing, profile] = await Promise.all([
      this.candidates(me, pref),
      this.prisma.travelMatchChoice.findMany({ where: { fromId: me.id }, select: { toId: true } }),
      this.prisma.conversation.findMany({ where: { scopeType: 'match', OR: [{ userAId: me.id }, { userBId: me.id }] }, select: { userAId: true, userBId: true } }),
      this.prisma.profile.findUnique({ where: { userId: me.id }, select: { interests: true } }),
    ]);
    const answered = new Set([...mine.map((c) => c.toId), ...existing.flatMap((c) => [c.userAId, c.userBId])]);
    const myInterests = new Set((profile?.interests ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
    const scored = all
      .filter((r) => !answered.has(r.userId))
      .map((r) => {
        const overlapDays = Math.max(1, Math.round((Math.min(+pref.dateEnd, +r.dateEnd) - Math.max(+pref.dateStart, +r.dateStart)) / DAY) + 1);
        const shared = (r.user.profile?.interests ?? '').split(',').map((s) => s.trim()).filter((s) => s && myInterests.has(s.toLowerCase()));
        const exact = r.destinationKey === pref.destinationKey ? 1 : 0;
        return { id: r.userId, score: exact * 5 + Math.min(overlapDays, 14) / 14 * 3 + Math.min(shared.length, 4) * 0.5, r, overlapDays, shared };
      });
    const best = topK(scored, MAX_SUGGESTIONS);
    const levels = await this.reliability.forViewer(me, best.map((b) => b.id));
    return best.map((b) => ({
      userId: b.id,
      displayName: b.r.user.profile?.displayName ?? 'Traveler',
      photoUrl: b.r.user.profile?.photoUrl ?? null,
      homeCity: b.r.user.profile?.homeCity ?? null,
      bio: b.r.user.profile?.bio ? b.r.user.profile.bio.slice(0, 140) : null,
      verifiedAdult: true,
      reliability: levels.get(b.id) ?? null,
      destination: b.r.destination,
      dateStart: b.r.dateStart,
      dateEnd: b.r.dateEnd,
      overlapDays: b.overlapDays,
      sharedInterests: b.shared.slice(0, 4),
    }));
  }

  /** My answer about one suggested person. A "yes" tells them nothing; two yeses open the chat. */
  async choose(me: User, otherId: string, body: unknown) {
    requireVerified(me);
    const { choice } = parse(choiceSchema, body);
    const pref = await this.prisma.travelMatchPref.findUnique({ where: { userId: me.id } });
    if (!pref) throw E.conflict('NOT_OPTED_IN', 'Turn on travel matching first');
    this.limiter.hit(`match-choice:${me.id}`, 60, DAY);
    const ok = (await this.candidates(me, pref)).some((c) => c.userId === otherId);
    if (!ok) throw E.notFound('Traveler');
    await this.prisma.travelMatchChoice.upsert({ where: { fromId_toId: { fromId: me.id, toId: otherId } }, create: { fromId: me.id, toId: otherId, choice }, update: { choice } });
    if (choice === 'pass') return { matched: false };

    const theirs = await this.prisma.travelMatchChoice.findUnique({ where: { fromId_toId: { fromId: otherId, toId: me.id } } });
    if (theirs?.choice !== 'yes') return { matched: false }; // exactly the same answer whether or not they said yes
    const key = pairKey(me.id, otherId);
    let conv = await this.prisma.conversation.findUnique({ where: { pairKey: key } });
    const created = !conv;
    if (!conv) {
      const other = await this.prisma.travelMatchPref.findUnique({ where: { userId: otherId } });
      conv = await this.prisma.conversation.create({
        data: { scopeType: 'match', pairKey: key, userAId: key.split(':')[0], userBId: key.split(':')[1], topic: other?.destination ?? pref.destination },
      });
    }
    if (conv.endedAt) return { matched: false }; // an ended chat is not reopened
    if (created) {
      const names = new Map((await this.prisma.profile.findMany({ where: { userId: { in: [me.id, otherId] } }, select: { userId: true, displayName: true } })).map((p) => [p.userId, p.displayName]));
      await this.notifications.notify(me.id, 'travel_match', 'It is a match', `You and ${names.get(otherId) ?? 'a traveler'} both want to travel to ${conv.topic}. You can chat now.`, { conversationId: conv.id });
      await this.notifications.notify(otherId, 'travel_match', 'It is a match', `You and ${names.get(me.id) ?? 'a traveler'} both want to travel to ${conv.topic}. You can chat now.`, { conversationId: conv.id });
      await this.audit.log(me.id, 'match.connected', 'conversation', conv.id);
    }
    return { matched: true, conversationId: conv.id };
  }

  /** Either person can end the chat. It closes for both and is not reopened. */
  async end(me: User, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.scopeType !== 'match' || (conv.userAId !== me.id && conv.userBId !== me.id)) throw E.notFound('Chat');
    if (!conv.endedAt) {
      await this.prisma.conversation.update({ where: { id: conv.id }, data: { endedAt: new Date() } });
      await this.audit.log(me.id, 'match.ended', 'conversation', conv.id);
    }
    return { ok: true };
  }
}

@Controller('v1/me/travel-match')
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get()
  overview(@CurrentUser() me: User) {
    return this.matching.overview(me);
  }

  @Put()
  setPref(@CurrentUser() me: User, @Body() body: unknown) {
    return this.matching.setPref(me, body);
  }

  @Delete()
  clear(@CurrentUser() me: User) {
    return this.matching.clearPref(me);
  }

  @Post('people/:userId')
  choose(@CurrentUser() me: User, @Param('userId') userId: string, @Body() body: unknown) {
    return this.matching.choose(me, userId, body);
  }

  @Post('chats/:conversationId/end')
  end(@CurrentUser() me: User, @Param('conversationId') id: string) {
    return this.matching.end(me, id);
  }
}
