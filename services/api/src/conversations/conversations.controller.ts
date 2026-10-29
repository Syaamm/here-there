import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { Conversation, User } from '@prisma/client';
import { z } from 'zod';
import { effectiveStatus } from '../activities/activities.service';
import { AuditService } from '../common/audit.service';
import { CurrentUser, requireVerified } from '../common/auth';
import { E } from '../common/errors';
import { LiveService } from '../common/live.service';
import { beforeKeyset, decodeKeyset, encodeKeyset, pageLimit } from '../common/paging';
import { PrismaService } from '../common/prisma.service';
import { PushService } from '../common/push.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { SafetyService } from '../safety/safety.service';

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

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationsService,
    private readonly live: LiveService,
    private readonly push: PushService,
    private readonly audit: AuditService,
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
    const { writable, ended } = await this.assertAccess(me, id);
    // The host cancelled: the chat is terminated. Members get nothing back (the rows stay server-side for moderation).
    if (ended) return { writable: false, ended: true, items: [], nextCursor: null };
    // Only when the app says the chat is open in front of the person (?read=1): its unread alert is cleared and the badge
    // can go. A background reload, or a screen kept loaded behind another one, must NOT read it.
    if (markRead && !cursor)
      await this.prisma.notification.updateMany({
        where: { userId: me.id, type: 'chat_message', readAt: null, data: { contains: `"conversationId":"${id}"` } },
        data: { readAt: new Date() },
      });
    const blocked = await this.safety.blockedWith(me.id);
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
    const votes = await this.prisma.tripPollVote.findMany({ where: { pollId } });
    return { accept: votes.filter((v) => v.vote === 'accept').length, reject: votes.filter((v) => v.vote === 'reject').length, myVote: vote };
  }

  /**
   * The organizer closes a poll. With `adopt` the poll's dates become the trip's final dates and every member is asked
   * to confirm them (nobody is committed until they do). The change is written into the chat and the audit log.
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
      await this.prisma.$transaction(async (tx) => {
        await tx.trip.update({ where: { id: trip.id }, data: { dateStart: poll.dateStart!, dateEnd: poll.dateEnd!, dateFlexibility: 'exact', datesState: 'proposed' } });
        await tx.tripPoll.update({ where: { id: pollId }, data: { state: 'adopted' } });
        // everyone starts unconfirmed except the organizer, who is the one proposing them
        await tx.tripMembership.updateMany({ where: { tripId: trip.id, state: 'approved' }, data: { datesConfirmed: false } });
        await tx.tripMembership.updateMany({ where: { tripId: trip.id, userId: me.id }, data: { datesConfirmed: true } });
      });
      const range = fmtRange(poll.dateStart!, poll.dateEnd!);
      await this.postMessage(conv, me, `Final dates proposed: ${range}. Everyone in the group: please confirm you can travel on these dates.`, { kind: 'system' });
      const members = (await this.prisma.tripMembership.findMany({ where: { tripId: trip.id, state: 'approved' } })).map((m) => m.userId).filter((u) => u !== me.id);
      await this.notifications.notifyMany(members, 'trip_dates_proposed', `Confirm the dates: ${trip.title}`, `The organizer proposed ${range}. Open the trip to confirm you can go.`, { tripId: trip.id });
      await this.audit.log(me.id, 'trip.dates_proposed', 'trip', trip.id, { pollId, from: trip.dateStart, to: trip.dateEnd });
    } else {
      await this.prisma.tripPoll.update({ where: { id: pollId }, data: { state: 'closed' } });
      await this.postMessage(conv, me, `Poll closed: ${poll.title}`, { kind: 'system' });
    }
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
    const members = await this.prisma.tripMembership.findMany({ where: { tripId, state: 'approved' } });
    const confirmed = members.filter((m) => m.datesConfirmed).length;
    if (confirmed === members.length) {
      // everyone said yes to the final dates and the group is big enough: the trip is confirmed
      if (members.length >= trip.minCapacity && ['planning', 'full'].includes(trip.status)) await this.prisma.trip.update({ where: { id: tripId }, data: { status: 'confirmed' } });
      await this.postMessage(conv, me, `Everyone has confirmed the dates: ${fmtRange(trip.dateStart, trip.dateEnd)}. Remember to book your own travel directly with suppliers.`, { kind: 'system' });
      await this.notifications.notify(trip.hostId, 'trip_dates_confirmed', `Dates confirmed: ${trip.title}`, 'Every member has confirmed the final dates.', { tripId });
    }
    return { confirmed, total: members.length };
  }

  /**
   * Tell the other approved members there is something new, without flooding them:
   * one unread "chat_message" alert per person per conversation until they read it.
   * People who blocked the sender (or were blocked by them) are skipped.
   */
  private async notifyOthers(sender: User, conv: Conversation, body: string, m: { id: string; createdAt: Date }) {
    let userIds: string[] = [];
    let title = 'your group';
    if (conv.scopeType === 'match') {
      userIds = [conv.userAId!, conv.userBId!];
      title = 'your travel match';
    } else if (conv.scopeType === 'activity' && conv.activityId) {
      userIds = (await this.prisma.activityMembership.findMany({ where: { activityId: conv.activityId, state: 'approved' } })).map((m) => m.userId);
      title = (await this.prisma.activity.findUnique({ where: { id: conv.activityId } }))?.title ?? title;
    } else if (conv.scopeType === 'trip' && conv.tripId) {
      userIds = (await this.prisma.tripMembership.findMany({ where: { tripId: conv.tripId, state: 'approved' } })).map((m) => m.userId);
      title = (await this.prisma.trip.findUnique({ where: { id: conv.tripId } }))?.title ?? title;
    }
    const blocked = new Set(await this.safety.blockedWith(sender.id));
    const profile = await this.prisma.profile.findUnique({ where: { userId: sender.id } });
    const name = profile?.displayName ?? 'Someone';
    const marker = `"conversationId":"${conv.id}"`;
    // live: the message reaches every open app of every member at once (the sender's other devices too)
    const event = { type: 'message' as const, conversationId: conv.id, message: { id: m.id, body, createdAt: m.createdAt, sender: { id: sender.id, displayName: name, photoUrl: profile?.photoUrl ?? null } } };
    for (const userId of userIds) if (userId === sender.id || !blocked.has(userId)) this.live.send(userId, event);
    const recipients = userIds.filter((u) => u !== sender.id && !blocked.has(u));
    // who already has an unread alert for this chat: one query for the whole group, not one per member
    const unread = new Set(
      (await this.prisma.notification.findMany({ where: { userId: { in: recipients }, type: 'chat_message', readAt: null, data: { contains: marker } }, select: { userId: true } })).map((n) => n.userId),
    );
    for (const userId of recipients) {
      // push: every message, to people who are not in the app right now
      void this.push.send(userId, { title: title, body: `${name}: ${body.slice(0, 120)}`, url: `/chat/${conv.id}` });
      if (unread.has(userId)) continue;
      await this.notifications.notify(userId, 'chat_message', `New message in ${title}`, `${name}: ${body.slice(0, 80)}`, { conversationId: conv.id, product: conv.scopeType === 'activity' ? 'here' : 'there' });
    }
  }

  /**
   * Your chats a page at a time (`limit`, `cursor`). Chats with messages come first, newest message first; the ones nobody
   * has written in yet follow, soonest event first. Every chat is ordered by a cheap key (one grouped query for the newest
   * message time), but only the chats on the page get their preview text and sender looked up.
   */
  async mine(me: User, limitRaw?: string, cursorRaw?: string, product?: 'here' | 'there') {
    const limit = pageLimit(limitRaw, 100);
    // `product` keeps one product's chats: activity groups are HERE, trip groups and travel matches are THERE
    const [acts, trips] = await Promise.all([
      product === 'there' ? [] : this.prisma.activityMembership.findMany({
        where: { userId: me.id, state: 'approved', activity: { status: { not: 'cancelled' }, conversation: { isNot: null } } },
        select: { activityId: true, activity: { select: { title: true, category: true, startsAt: true, endsAt: true, conversation: { select: { id: true } } } } },
      }),
      product === 'here' ? [] : this.prisma.tripMembership.findMany({
        where: { userId: me.id, state: 'approved', trip: { status: { not: 'cancelled' }, conversation: { isNot: null } } },
        select: { tripId: true, trip: { select: { title: true, dateStart: true, dateEnd: true, conversation: { select: { id: true } } } } },
      }),
    ]);
    const matchRows = product === 'here' ? [] : await this.prisma.conversation.findMany({ where: { scopeType: 'match', endedAt: null, OR: [{ userAId: me.id }, { userBId: me.id }] }, select: { id: true, userAId: true, userBId: true, createdAt: true, topic: true } });
    const matchBlocked = new Set(await this.safety.blockedWith(me.id));
    const matchOthers = matchRows.map((c) => ({ c, otherId: c.userAId === me.id ? c.userBId! : c.userAId! })).filter((x) => !matchBlocked.has(x.otherId));
    const matchNames = new Map((await this.prisma.profile.findMany({ where: { userId: { in: matchOthers.map((x) => x.otherId) } }, select: { userId: true, displayName: true } })).map((p) => [p.userId, p.displayName]));
    const items = [
      ...matchOthers.map((x) => ({
        conversationId: x.c.id,
        scope: 'match' as const,
        scopeId: x.c.id,
        title: matchNames.get(x.otherId) ?? 'Travel match',
        category: null as string | null,
        startsAt: x.c.createdAt,
        endsAt: x.c.createdAt,
      })),
      ...acts.map((m) => ({
        conversationId: m.activity.conversation!.id,
        scope: 'activity' as const,
        scopeId: m.activityId,
        title: m.activity.title,
        category: m.activity.category as string | null,
        startsAt: m.activity.startsAt,
        endsAt: m.activity.endsAt,
      })),
      ...trips.map((m) => ({
        conversationId: m.trip.conversation!.id,
        scope: 'trip' as const,
        scopeId: m.tripId,
        title: m.trip.title,
        category: null as string | null,
        startsAt: m.trip.dateStart,
        endsAt: m.trip.dateEnd,
      })),
    ];

    // when each chat last had a (visible) message: one grouped query, answered from the index
    const ids = items.map((i) => i.conversationId);
    const latest = ids.length
      ? await this.prisma.message.groupBy({ by: ['conversationId'], where: { conversationId: { in: ids }, moderationState: { not: 'removed' } }, _max: { createdAt: true } })
      : [];
    const lastAt = new Map(latest.map((g) => [g.conversationId, g._max.createdAt!]));

    // The sort key, smallest first: [0, -time of newest message] for chats with messages, then [1, how soon the event is]
    // for the rest, and the id to break ties. The clock is the one the first page used, so the pages join up.
    const [asOfIso, ...rest] = cursorRaw ? Buffer.from(cursorRaw, 'base64url').toString().split('|') : [new Date().toISOString()];
    const asOf = new Date(asOfIso);
    if (isNaN(+asOf)) throw E.badRequest('INVALID_CURSOR', 'Invalid cursor');
    const FAR = Number.MAX_SAFE_INTEGER / 2;
    const keyOf = (i: (typeof items)[number]): [number, number, string] => {
      const at = lastAt.get(i.conversationId);
      if (at) return [0, -+at, i.conversationId];
      return [1, +i.startsAt >= +asOf ? +i.startsAt - +asOf : FAR + (+asOf - +i.startsAt), i.conversationId];
    };
    const cmp = (x: [number, number, string], y: [number, number, string]) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
    let after: [number, number, string] | null = null;
    if (cursorRaw) {
      const [g, k, ...idParts] = rest;
      after = [Number(g), Number(k), idParts.join('|')];
      if (!Number.isFinite(after[0]) || !Number.isFinite(after[1]) || !after[2]) throw E.badRequest('INVALID_CURSOR', 'Invalid cursor');
    }
    const ordered = items.map((i) => ({ i, k: keyOf(i) })).sort((x, y) => cmp(x.k, y.k));
    const later = after ? ordered.filter((x) => cmp(x.k, after!) > 0) : ordered;
    const pageRows = later.slice(0, limit);
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor = later.length > limit && lastRow ? Buffer.from(`${asOf.toISOString()}|${lastRow.k[0]}|${lastRow.k[1]}|${lastRow.k[2]}`).toString('base64url') : null;

    // the preview and sender, for the chats on this page only
    const pageIds = pageRows.map((x) => x.i.conversationId);
    const newest = pageIds.length
      ? await this.prisma.message.findMany({
          where: { conversationId: { in: pageIds }, moderationState: { not: 'removed' } },
          orderBy: { createdAt: 'desc' },
          distinct: ['conversationId'],
          include: { sender: { select: { id: true, profile: { select: { displayName: true } } } } },
        })
      : [];
    const last = new Map(newest.map((m) => [m.conversationId, { body: m.body.slice(0, 140), at: m.createdAt, from: m.senderId === me.id ? 'You' : (m.sender.profile?.displayName ?? null) }]));
    return { items: pageRows.map((x) => ({ ...x.i, lastMessage: last.get(x.i.conversationId) ?? null })), nextCursor };
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
