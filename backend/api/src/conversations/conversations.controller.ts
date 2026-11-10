import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { Conversation, User } from '@prisma/client';
import { metrics } from '../common/observability';
import { z } from 'zod';
import { effectiveStatus } from '../activities/activities.service';
import { AuditService } from '../common/audit.service';
import { CurrentUser, requireVerified } from '../common/auth';
import { MAX_DATE_CHANGES } from '../common/constants';
import { E } from '../common/errors';
import { EventBus } from '../common/events';
import { LiveService } from '../common/live.service';
import { beforeKeyset, decodeKeyset, encodeKeyset, pageLimit, pageOf } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { PushService } from '../common/push.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { RegionsService } from '../regions/regions.service';
import { ClashService, tripWindow } from '../schedule/clash.service';
import { tripCities } from '../common/live.service';
import { SafetyService } from '../safety/safety.service';
import { limitCityOf } from '../trips/trips.service';

export const sendSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const pollSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    dateStart: z.coerce.date().optional(),
    dateEnd: z.coerce.date().optional(),
  })
  .refine((v) => !v.dateEnd || !!v.dateStart, { message: 'Add a start date too' });
export const voteSchema = z.object({ vote: z.enum(['accept', 'reject']) });

const DAY = 24 * 3600e3;
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtRange = (a: Date, b: Date) => (a.toDateString() === b.toDateString() ? fmtDay(a) : `${fmtDay(a)} to ${fmtDay(b)}`);

/** A trip's dates can only change before it starts, and only MAX_DATE_CHANGES times through date polls. */
function assertDatesCanChange(trip: { dateStart: Date; dateChanges: number }) {
  if (trip.dateStart <= new Date()) throw E.conflict('TRIP_STARTED', 'This trip has already started, so its dates can no longer be changed');
  if (trip.dateChanges >= MAX_DATE_CHANGES) throw E.conflict('DATE_CHANGES_USED', `The dates of a trip can only be changed ${MAX_DATE_CHANGES} times, and this trip has used them all`);
}

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationsService,
    private readonly live: LiveService,
    private readonly events: EventBus,
    private readonly push: PushService,
    private readonly audit: AuditService,
    private readonly clash: ClashService,
    private readonly regions: RegionsService,
  ) {}

  /** Older chats were made before `lastMessageAt` existed: fill it in once (a chat that is already right is left as it is). */
  async onModuleInit() {
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "Conversation" c SET "lastMessageAt" = COALESCE((SELECT max(m."createdAt") FROM "Message" m WHERE m."conversationId" = c.id), c."createdAt") WHERE c."lastMessageAt" IS DISTINCT FROM COALESCE((SELECT max(m."createdAt") FROM "Message" m WHERE m."conversationId" = c.id), c."createdAt")`,
      );
    } catch (e) {
      console.warn('could not fill in when chats last had a message:', (e as Error).message);
    }
  }

  /** A message was written: its chat moves to the top of everyone's list. */
  private touch(conversationId: string, at: Date) {
    return this.prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at } }).catch(() => undefined);
  }

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
      // open for a day after the planned end (time to say thanks), then read-only
      const finishedLongAgo = Date.now() >= +a.endsAt + 24 * 3600e3;
      return { conv, writable: !['cancelled', 'archived'].includes(a.status) && !finishedLongAgo, ended: a.status === 'cancelled' };
    }
    if (conv.scopeType === 'match') {
      // two travelers who both said yes: only those two, and never across a block or an ended chat
      if (conv.userAId !== me.id && conv.userBId !== me.id) throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to the two travelers');
      const otherId = conv.userAId === me.id ? conv.userBId! : conv.userAId!;
      if (await this.safety.isBlocked(me.id, otherId)) throw E.forbidden('NOT_A_MEMBER', 'Chat is only available to the two travelers');
      const other = await this.prisma.user.findUnique({ where: { id: otherId }, select: { state: true } });
      const over = !!conv.endedAt || !other || other.state !== 'active';
      return { conv, writable: !over, ended: over };
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

  async messages(me: User, id: string, cursor?: string, limit = 50, markRead = false) {
    // the access check and the block list do not depend on each other: ask for both at once
    const [{ writable, ended }, blocked] = await Promise.all([this.assertAccess(me, id), this.safety.blockedWith(me.id)]);
    // The host cancelled: the chat is terminated. Members get nothing back (the rows stay server-side for moderation).
    if (ended) return { writable: false, ended: true, items: [], nextCursor: null };
    // Only when the app says the chat is open in front of the person (?read=1): its unread alert is cleared and the badge
    // can go. A background reload, or a screen kept loaded behind another one, must NOT read it.
    if (markRead && !cursor) await this.clearUnread(me.id, id);
    const take = Math.min(Math.max(limit, 1), 100);
    // newest first, a page at a time: the cursor is the time and id of the oldest message sent so far, so earlier messages
    // follow exactly after it (two messages sent in the same moment are never skipped)
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        moderationState: { not: 'removed' },
        senderId: { notIn: blocked },
        ...beforeKeyset(decodeKeyset(cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      include: { sender: { select: { id: true, profile: { select: { displayName: true, photoUrl: true } } } } },
    });
    const page = rows.slice(0, take);
    // poll messages carry the live poll: the dates, how many accepted or rejected, and this person's own answer
    const pollIds = page.filter((m) => m.kind === 'poll' && m.refId).map((m) => m.refId!);
    const polls = pollIds.length ? await this.prisma.tripPoll.findMany({ where: { id: { in: pollIds } }, include: { votes: true } }) : [];
    const pollDto = new Map(
      polls.map((p) => [
        p.id,
        {
          id: p.id,
          title: p.title,
          dateStart: p.dateStart,
          dateEnd: p.dateEnd,
          state: p.state,
          accept: p.votes.filter((v) => v.vote === 'accept').length,
          reject: p.votes.filter((v) => v.vote === 'reject').length,
          myVote: p.votes.find((v) => v.userId === me.id)?.vote ?? null,
        },
      ]),
    );
    const link = (meta: string | null) => {
      try {
        return meta ? (JSON.parse(meta) as { url: string }) : null;
      } catch {
        return null;
      }
    };
    return {
      writable,
      ended: false,
      items: page
        .map((m) => ({
          id: m.id,
          body: m.body,
          kind: m.kind,
          poll: m.kind === 'poll' && m.refId ? (pollDto.get(m.refId) ?? null) : null,
          link: m.kind === 'link' ? link(m.meta) : null,
          createdAt: m.createdAt,
          sender: { id: m.sender.id, displayName: m.sender.profile?.displayName ?? 'Member', photoUrl: m.sender.profile?.photoUrl ?? null },
        }))
        .reverse(),
      nextCursor: rows.length > take ? encodeKeyset(page[page.length - 1].createdAt, page[page.length - 1].id) : null,
    };
  }

  private clearUnread(userId: string, conversationId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, type: 'chat_message', readAt: null, data: { contains: `"conversationId":"${conversationId}"` } },
      data: { readAt: new Date() },
    });
  }

  /**
   * The chat is open in front of the person and a message arrived live: clear its unread alert without reading any messages
   * again (the app already has the new message from the live connection). Same access rule as reading the chat.
   */
  async markRead(me: User, id: string) {
    await this.assertAccess(me, id);
    await this.clearUnread(me.id, id);
    return { ok: true };
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

    if (conv.scopeType === 'match') {
      const users = await this.prisma.user.findMany({ where: { id: { in: [conv.userAId!, conv.userBId!] } }, select: userSel.select });
      const members = order(users.map((u) => person(u, false)));
      const other = members.find((m) => !m.isMe);
      return {
        id: conv.id,
        scope: 'match' as const,
        scopeId: conv.id,
        title: other?.displayName ?? 'Travel match',
        category: null,
        status: conv.endedAt ? 'ended' : 'open',
        startsAt: conv.createdAt,
        endsAt: conv.createdAt,
        place: conv.topic ?? '',
        capacity: 2,
        members,
      };
    }
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
        status: effectiveStatus(a),
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
    await this.touch(id, m.createdAt);
    metrics.count('messages');
    await this.notifyOthers(me, conv, dto.body, m);
    return { id: m.id, body: m.body, createdAt: m.createdAt };
  }

  // ------------------------------------------------------------------ THERE: planning in the group chat
  /** The trip behind a trip chat, and whether this person is its organizer. Same live-membership check as chatting. */
  private async tripChat(me: User, conversationId: string, organizerOnly: boolean) {
    const { conv, writable } = await this.assertAccess(me, conversationId);
    if (conv.scopeType !== 'trip' || !conv.tripId) throw E.badRequest('NOT_A_TRIP_CHAT', 'This is only for trip groups');
    if (!writable) throw E.conflict('CONVERSATION_CLOSED', 'This conversation is closed');
    const trip = await this.prisma.trip.findUniqueOrThrow({ where: { id: conv.tripId } });
    if (organizerOnly && trip.hostId !== me.id) throw E.forbidden('NOT_ORGANIZER', 'Only the organizer can do this');
    return { conv, trip };
  }

  private async postMessage(conv: Conversation, sender: User, body: string, extra: { kind: string; refId?: string; meta?: string }) {
    const m = await this.prisma.message.create({ data: { conversationId: conv.id, senderId: sender.id, body, ...extra } });
    await this.touch(conv.id, m.createdAt);
    await this.notifyOthers(sender, conv, body, m);
    return m;
  }

  /** The organizer asks the group about dates. Members answer accept or reject right in the chat. */
  async createPoll(me: User, id: string, body: unknown) {
    const dto = parse(pollSchema, body);
    const { conv, trip } = await this.tripChat(me, id, true);
    if (+new Date() >= +trip.dateEnd + DAY) throw E.conflict('TRIP_CLOSED', 'This trip is over, so it cannot take a new date poll');
    const bad = contentProblem(dto.title);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    if (dto.dateStart) {
      assertDatesCanChange(trip); // a poll about dates would change nothing once the trip has started or its date changes are used up
      const end = dto.dateEnd ?? dto.dateStart;
      if (dto.dateStart.getTime() < Date.now()) throw E.badRequest('INVALID_SCHEDULE', 'The dates must be in the future');
      if (end < dto.dateStart) throw E.badRequest('INVALID_SCHEDULE', 'The end date is before the start date');
      if ((+end - +dto.dateStart) / DAY > 90) throw E.badRequest('INVALID_SCHEDULE', 'Trips can span at most 90 days');
    }
    const open = await this.prisma.tripPoll.count({ where: { tripId: trip.id, state: 'open' } });
    if (open >= 3) throw E.conflict('TOO_MANY_OPEN_POLLS', 'Close one of the open polls first');
    this.limiter.hit(`trip-poll:${me.id}`, 10, DAY);
    const poll = await this.prisma.tripPoll.create({
      data: { tripId: trip.id, createdById: me.id, title: dto.title, dateStart: dto.dateStart, dateEnd: dto.dateStart ? (dto.dateEnd ?? dto.dateStart) : undefined },
    });
    await this.postMessage(conv, me, dto.title, { kind: 'poll', refId: poll.id });
    await this.audit.log(me.id, 'trip.poll_created', 'trip', trip.id, { pollId: poll.id });
    return { id: poll.id };
  }

  /** A member answers accept or reject (they can change it while the poll is open). */
  async vote(me: User, pollId: string, body: unknown) {
    const { vote } = parse(voteSchema, body);
    const poll = await this.prisma.tripPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw E.notFound('Poll');
    const conv = await this.prisma.conversation.findUnique({ where: { tripId: poll.tripId } });
    if (!conv) throw E.notFound('Poll');
    await this.assertAccess(me, conv.id); // live membership, verified adult
    if (poll.state !== 'open') throw E.conflict('POLL_CLOSED', 'This poll is closed');
    await this.prisma.tripPollVote.upsert({
      where: { pollId_userId: { pollId, userId: me.id } },
      create: { pollId, userId: me.id, vote },
      update: { vote },
    });
    this.events.emit({ type: 'trip.poll_changed', id: poll.tripId });
    const votes = await this.prisma.tripPollVote.findMany({ where: { pollId } });
    return { accept: votes.filter((v) => v.vote === 'accept').length, reject: votes.filter((v) => v.vote === 'reject').length, myVote: vote };
  }

  /**
   * The organizer closes a poll. With `adopt` the poll's dates become the trip's dates AT ONCE, everywhere (feed, trip page, chat,
   * My trips), every member is told by an alert and a push, and the change is written into the chat and the audit log. The
   * organizer's choice is final: there is no second round of confirmation. The same checks as editing a trip's dates apply.
   */
  async closePoll(me: User, pollId: string, body: unknown) {
    const { adopt } = parse(z.object({ adopt: z.boolean().default(false) }), body);
    const poll = await this.prisma.tripPoll.findUnique({ where: { id: pollId } });
    if (!poll) throw E.notFound('Poll');
    const conv = await this.prisma.conversation.findUnique({ where: { tripId: poll.tripId } });
    if (!conv) throw E.notFound('Poll');
    const { trip } = await this.tripChat(me, conv.id, true);
    if (poll.state !== 'open') throw E.conflict('POLL_CLOSED', 'This poll is already closed');
    if (adopt && (!poll.dateStart || !poll.dateEnd)) throw E.badRequest('NO_DATES', 'This poll has no dates to adopt');

    if (adopt) {
      if (['cancelled', 'completed'].includes(trip.status)) throw E.conflict('TRIP_CLOSED', 'This trip can no longer change its dates');
      assertDatesCanChange(trip);
      if (poll.dateStart! <= new Date()) throw E.badRequest('INVALID_DATES', 'These dates are no longer in the future');
      // the same checks as the organizer editing the dates: how far ahead a trip may be planned, and one plan at a time
      await this.regions.assertWithinLimit('there', limitCityOf(trip), poll.dateEnd! > poll.dateStart! ? poll.dateEnd! : poll.dateStart!, 'INVALID_DATES');
      await this.clash.assertFree(me.id, ...tripWindow({ dateStart: poll.dateStart!, dateEnd: poll.dateEnd! }), { kind: 'trip', id: trip.id });
      await this.prisma.$transaction(async (tx) => {
        // checked and counted in the same step, so two polls adopted at once can never go past the limit or past the start
        const moved = await tx.trip.updateMany({
          where: { id: trip.id, dateChanges: { lt: MAX_DATE_CHANGES }, dateStart: { gt: new Date() } },
          data: { dateStart: poll.dateStart!, dateEnd: poll.dateEnd!, dateFlexibility: 'exact', datesState: 'tentative', dateChanges: { increment: 1 } },
        });
        if (moved.count === 0) throw E.conflict('DATE_CHANGES_USED', 'The dates of this trip can no longer be changed');
        await tx.tripPoll.update({ where: { id: pollId }, data: { state: 'adopted' } });
      });
      const range = fmtRange(poll.dateStart!, poll.dateEnd!);
      await this.postMessage(conv, me, `New dates: ${range}. The trip's dates have been updated for everyone.`, { kind: 'system' });
      const members = (await this.prisma.tripMembership.findMany({ where: { tripId: trip.id, state: 'approved' } })).map((m) => m.userId).filter((u) => u !== me.id);
      await this.notifications.notifyMany(members, 'trip_changed', `New dates: ${trip.title}`, range, { tripId: trip.id });
      await this.audit.log(me.id, 'trip.dates_set_by_poll', 'trip', trip.id, { pollId, from: trip.dateStart, to: trip.dateEnd, now: [poll.dateStart, poll.dateEnd], change: trip.dateChanges + 1, of: MAX_DATE_CHANGES });
      // the trip's dates changed: every list that shows it (feed, My trips, the trip page) updates at once
      this.events.emit({ type: 'trip.changed', id: trip.id, cities: tripCities(trip) });
    } else {
      await this.prisma.tripPoll.update({ where: { id: pollId }, data: { state: 'closed' } });
      await this.postMessage(conv, me, `Poll closed: ${poll.title}`, { kind: 'system' });
    }
    this.events.emit({ type: 'trip.poll_changed', id: trip.id });
    return { ok: true };
  }

  /** Every approved member must say yes to the final dates themselves. When the last one does, the group is told. */
  async confirmDates(me: User, tripId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { tripId } });
    if (!conv) throw E.notFound('Trip');
    const { trip } = await this.tripChat(me, conv.id, false);
    if (+new Date() >= +trip.dateEnd + DAY) throw E.conflict('TRIP_CLOSED', 'This trip is over, so its dates can no longer be confirmed');
    if (trip.datesState !== 'proposed') throw E.conflict('NO_DATES_TO_CONFIRM', 'There are no final dates waiting for confirmation');
    await this.prisma.tripMembership.update({ where: { tripId_userId: { tripId, userId: me.id } }, data: { datesConfirmed: true } });
    await this.notifications.markDone(me.id, 'trip_dates_proposed', `"tripId":"${tripId}"`); // its "Confirm the dates" alert is answered
    const members = await this.prisma.tripMembership.findMany({ where: { tripId, state: 'approved' } });
    const confirmed = members.filter((m) => m.datesConfirmed).length;
    if (confirmed === members.length) {
      // everyone said yes to the final dates and the group is big enough: the trip is confirmed
      if (members.length >= trip.minCapacity && ['planning', 'full'].includes(trip.status)) await this.prisma.trip.update({ where: { id: tripId }, data: { status: 'confirmed' } });
      await this.postMessage(conv, me, `Everyone has confirmed the dates: ${fmtRange(trip.dateStart, trip.dateEnd)}. Remember to book your own travel directly with suppliers.`, { kind: 'system' });
      await this.notifications.notify(trip.hostId, 'trip_dates_confirmed', `Dates confirmed: ${trip.title}`, 'Every member has confirmed the final dates.', { tripId });
    }
    this.events.emit({ type: 'trip.poll_changed', id: tripId });
    return { confirmed, total: members.length };
  }

  /**
   * Tell the other approved members there is something new, without flooding them:
   * one unread "chat_message" alert per person per conversation until they read it.
   * People who blocked the sender (or were blocked by them) are skipped.
   */
  private async notifyOthers(sender: User, conv: Conversation, body: string, m: { id: string; createdAt: Date; kind?: string }) {
    let userIds: string[] = [];
    let title = 'your group';
    if (conv.scopeType === 'match') {
      userIds = [conv.userAId!, conv.userBId!];
      title = 'your travel match';
    } else if (conv.scopeType === 'activity' && conv.activityId) {
      const [rows, a] = await Promise.all([
        this.prisma.activityMembership.findMany({ where: { activityId: conv.activityId, state: 'approved' }, select: { userId: true } }),
        this.prisma.activity.findUnique({ where: { id: conv.activityId }, select: { title: true } }),
      ]);
      userIds = rows.map((r) => r.userId);
      title = a?.title ?? title;
    } else if (conv.scopeType === 'trip' && conv.tripId) {
      const [rows, t] = await Promise.all([
        this.prisma.tripMembership.findMany({ where: { tripId: conv.tripId, state: 'approved' }, select: { userId: true } }),
        this.prisma.trip.findUnique({ where: { id: conv.tripId }, select: { title: true } }),
      ]);
      userIds = rows.map((r) => r.userId);
      title = t?.title ?? title;
    }
    const [blockedIds, profile] = await Promise.all([this.safety.blockedWith(sender.id), this.prisma.profile.findUnique({ where: { userId: sender.id }, select: { displayName: true, photoUrl: true } })]);
    const blocked = new Set(blockedIds);
    const name = profile?.displayName ?? 'Someone';
    const marker = `"conversationId":"${conv.id}"`;
    // live: the message reaches every open app of every member at once (the sender's other devices too)
    // `kind` lets the app put a plain text message straight on screen and ask again only for a poll or a notice
    const event = { type: 'message' as const, conversationId: conv.id, message: { id: m.id, body, kind: m.kind ?? 'text', createdAt: m.createdAt, sender: { id: sender.id, displayName: name, photoUrl: profile?.photoUrl ?? null } } };
    this.live.sendMany(userIds.filter((u) => u === sender.id || !blocked.has(u)), event);
    // Someone with this chat open in front of them has just seen the message arrive live: no alert to write (and none to clear
    // afterwards), no push. For a busy group this is most of the writes a message used to cause.
    const recipients = userIds.filter((u) => u !== sender.id && !blocked.has(u) && !this.live.isViewingChat(u, conv.id));
    // who already has an unread alert for this chat: one query for the whole group, not one per member
    const unread = new Map(
      (await this.prisma.notification.findMany({ where: { userId: { in: recipients }, type: 'chat_message', readAt: null, data: { contains: marker } }, select: { id: true, userId: true, data: true } })).map((n) => [n.userId, n] as const),
    );
    const tell = async (userId: string) => {
      // push: every message, to everyone not looking at this chat (in the app or not), if their settings and quiet hours allow it;
      // sent straight away, without the job queue (see PushService.sendNow)
      this.push.sendNow(userId, { title: title, body: `${name}: ${body.slice(0, 120)}`, url: `/chat/${conv.id}`, alert: { type: 'chat_message' }, thread: `chat-${conv.id}` });
      const prev = unread.get(userId);
      if (prev) {
        // grouped: still one alert for this chat, now with a count and the newest message, moved back to the top of the list
        const was = (prev.data ? (JSON.parse(prev.data) as { count?: number }) : {}) ?? {};
        const count = (was.count ?? 1) + 1;
        await this.prisma.notification.update({
          where: { id: prev.id },
          data: { title: `${count} new messages in ${title}`, body: `${name}: ${body.slice(0, 80)}`, data: JSON.stringify({ ...was, conversationId: conv.id, product: conv.scopeType === 'activity' ? 'here' : 'there', count }), createdAt: new Date() },
        });
        return;
      }
      await this.notifications.notify(userId, 'chat_message', `New message in ${title}`, `${name}: ${body.slice(0, 80)}`, { conversationId: conv.id, product: conv.scopeType === 'activity' ? 'here' : 'there' });
    };
    // a group's alerts are written a few at a time instead of one after another: a big group does not make the sender wait
    // for every member in turn, and the database is never hit with the whole group at once
    for (let i = 0; i < recipients.length; i += 8) await Promise.all(recipients.slice(i, i + 8).map(tell));
  }

  /**
   * Your chats a page at a time (`limit`, `cursor`), the chat with the newest message first (a chat nobody has written in yet
   * counts from when it was made). The database orders and pages them (the order is stored in `lastMessageAt`), so a person in
   * thousands of chats costs the same as one in three; only the chats on the page get their preview text and sender looked up.
   */
  async mine(me: User, limitRaw?: string, cursorRaw?: string, product?: 'here' | 'there') {
    const limit = pageLimit(limitRaw, 100);
    const blocked = await this.safety.blockedWith(me.id);
    const member = { some: { userId: me.id, state: 'approved' } };
    // `product` keeps one product's chats: activity groups are HERE, trip groups and travel matches are THERE
    const where = {
      OR: [
        ...(product === 'there' ? [] : [{ activity: { status: { not: 'cancelled' }, memberships: member } }]),
        ...(product === 'here'
          ? []
          : [
              { trip: { status: { not: 'cancelled' }, memberships: member } },
              { scopeType: 'match', endedAt: null, OR: [{ userAId: me.id, userBId: { notIn: blocked } }, { userBId: me.id, userAId: { notIn: blocked } }] },
            ]),
      ],
    };
    const page = await pageOf(
      (args) =>
        this.prisma.conversation.findMany({
          ...args,
          include: { activity: { select: { title: true, category: true, startsAt: true, endsAt: true } }, trip: { select: { title: true, dateStart: true, dateEnd: true } } },
        }),
      { limit, cursor: cursorRaw, where, sortBy: 'lastMessageAt' },
    );

    // the other traveller's name, for the match chats on this page
    const otherOf = (c: { userAId: string | null; userBId: string | null }) => (c.userAId === me.id ? c.userBId : c.userAId);
    const names = new Map(
      (await this.prisma.profile.findMany({ where: { userId: { in: page.items.filter((c) => c.scopeType === 'match').map((c) => otherOf(c)!).filter(Boolean) } }, select: { userId: true, displayName: true } })).map((p) => [p.userId, p.displayName]),
    );
    // the newest visible message of each chat on the page: one small indexed read per chat
    const newest = await Promise.all(
      page.items.map((c) =>
        this.prisma.message.findFirst({
          where: { conversationId: c.id, moderationState: { not: 'removed' } },
          orderBy: { createdAt: 'desc' },
          include: { sender: { select: { id: true, profile: { select: { displayName: true } } } } },
        }),
      ),
    );
    const items = page.items.map((c, i) => {
      const m = newest[i];
      const base =
        c.scopeType === 'activity' && c.activity
          ? { scope: 'activity' as const, scopeId: c.activityId!, title: c.activity.title, category: c.activity.category as string | null, startsAt: c.activity.startsAt, endsAt: c.activity.endsAt }
          : c.scopeType === 'trip' && c.trip
            ? { scope: 'trip' as const, scopeId: c.tripId!, title: c.trip.title, category: null as string | null, startsAt: c.trip.dateStart, endsAt: c.trip.dateEnd }
            : { scope: 'match' as const, scopeId: c.id, title: names.get(otherOf(c) ?? '') ?? 'Travel match', category: null as string | null, startsAt: c.createdAt, endsAt: c.createdAt };
      return {
        conversationId: c.id,
        ...base,
        lastMessage: m ? { body: m.body.slice(0, 140), at: m.createdAt, from: m.senderId === me.id ? 'You' : (m.sender.profile?.displayName ?? null) } : null,
      };
    });
    return { items, nextCursor: page.nextCursor };
  }
}

@Controller('v1')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get('me/conversations')
  mine(@CurrentUser() me: User, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('product') product?: string) {
    return this.conversations.mine(me, limit, cursor, product === 'here' || product === 'there' ? product : undefined);
  }

  @Get('conversations/:id/messages')
  messages(
    @CurrentUser() me: User,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('read') read?: string,
  ) {
    return this.conversations.messages(me, id, cursor, limit ? Number(limit) || 50 : 50, read === '1');
  }

  @Post('conversations/:id/read')
  markRead(@CurrentUser() me: User, @Param('id') id: string) {
    return this.conversations.markRead(me, id);
  }

  @Get('conversations/:id/info')
  info(@CurrentUser() me: User, @Param('id') id: string) {
    return this.conversations.info(me, id);
  }

  @Post('conversations/:id/polls')
  createPoll(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.conversations.createPoll(me, id, body);
  }

  @Post('polls/:pollId/vote')
  vote(@CurrentUser() me: User, @Param('pollId') pollId: string, @Body() body: unknown) {
    return this.conversations.vote(me, pollId, body);
  }

  @Post('polls/:pollId/close')
  closePoll(@CurrentUser() me: User, @Param('pollId') pollId: string, @Body() body: unknown) {
    return this.conversations.closePoll(me, pollId, body);
  }

  @Post('trips/:id/confirm-dates')
  confirmDates(@CurrentUser() me: User, @Param('id') id: string) {
    return this.conversations.confirmDates(me, id);
  }

  @Post('conversations/:id/messages')
  send(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.conversations.send(me, id, body);
  }
}
