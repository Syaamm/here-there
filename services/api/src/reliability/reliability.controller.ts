import { Body, Controller, Delete, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { beforeKeyset, decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { CurrentUser, Public, Staff } from '../common/auth';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DAY, DISPUTE_DAYS, HORIZON_DAYS, HOST_ABSENT_GRACE_MIN, HOST_ABSENT_WINDOW_H, HOST_MARK_REVIEW, HOUR, LATE_ACTIVITY_H, LATE_HOST_TRIP_DAYS, LATE_TRIP_DAYS, LEVEL_LABEL, MARK_WINDOW_H, PENALTY,
  capPerDay, describe, reliabilityInfo, summarise, weightOf, type Fact, type Level, type Summary,
} from './reliability';

type Kind = 'activity' | 'trip';
const disputeSchema = z.object({ note: z.string().trim().min(3, 'Say briefly what happened').max(500) });
const markSchema = z.object({ userId: z.string().min(1) });
const decisionSchema = z.object({ decision: z.enum(['uphold', 'overturn']), note: z.string().trim().min(3).max(500) });
const MOD = ['moderator', 'trust_lead', 'admin'];
const ALL = ['support', 'moderator', 'trust_lead', 'admin'];

const confirmed = (m: { state: string; markedAt: Date }, now: Date) => m.state === 'upheld' || (m.state === 'marked' && +now > +m.markedAt + DISPUTE_DAYS * DAY);
const CATEGORY_WORDS: Record<string, string> = {
  host_no_show: 'the host did not show up', harassment: 'harassment', fraud: 'fraud', inappropriate_content: 'inappropriate content', underage: 'age concern', physical_safety: 'physical safety', spam: 'spam', financial_solicitation: 'asking for money',
};

const LEVEL_LINE: Record<Level, string> = {
  new: 'You are new here. Join a few plans and your level will grow.',
  reliable: 'People can count on you.',
  very_reliable: 'People can really count on you.',
  needs_care: 'Some recent plans did not go well.',
};

/** A person's level, shown to other verified members: just the level and its words, never the events behind it. */
export type PublicLevel = { level: Level; label: string };

@Injectable()
export class ReliabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly limiter: RateLimiter,
  ) {}

  // ---------------------------------------------------------------- working out the level
  /** Every counted event for these people, from verified, completed plans only. */
  async factsFor(ids: string[], now = new Date()): Promise<Map<string, Fact[]>> {
    const out = new Map<string, Fact[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return out;
    const push = (id: string, f: Fact) => out.get(id)?.push(f);
    const horizon = new Date(+now - HORIZON_DAYS * DAY);
    const final = new Date(+now - MARK_WINDOW_H * HOUR); // plans that ended before this can no longer get a note

    // the host's notes: a confirmed one is a no-show; any note that is not overturned keeps the plan from counting as kept
    const marks = await this.prisma.attendanceMark.findMany({ where: { userId: { in: ids }, planEndsAt: { gt: horizon } } });
    const blocked = new Set(marks.filter((m) => m.state !== 'overturned').map((m) => `${m.kind}:${m.targetId}:${m.userId}`));
    for (const m of marks) if (confirmed(m, now)) push(m.userId, { kind: 'no_show', at: m.planEndsAt, label: m.title });

    // finished plans they were approved for
    const joined = await this.prisma.activityMembership.findMany({
      where: { userId: { in: ids }, role: 'attendee', state: 'approved', activity: { status: { notIn: ['cancelled', 'draft'] }, endsAt: { lt: final, gt: horizon } } },
      select: { userId: true, activityId: true, activity: { select: { title: true, endsAt: true } } },
    });
    for (const m of joined) if (!blocked.has(`activity:${m.activityId}:${m.userId}`)) push(m.userId, { kind: 'kept', at: m.activity.endsAt, label: m.activity.title });

    const hosted = await this.prisma.activity.findMany({
      where: { hostId: { in: ids }, status: { notIn: ['cancelled', 'draft'] }, endsAt: { lt: final, gt: horizon }, memberships: { some: { role: 'attendee', state: 'approved' } } },
      select: { hostId: true, title: true, endsAt: true },
    });
    for (const a of hosted) push(a.hostId, { kind: 'kept', at: a.endsAt, label: a.title });

    const tripsJoined = await this.prisma.tripMembership.findMany({
      where: { userId: { in: ids }, role: 'member', state: 'approved', trip: { status: { notIn: ['cancelled', 'draft'] }, dateEnd: { lt: final, gt: horizon } } },
      select: { userId: true, tripId: true, trip: { select: { title: true, dateEnd: true } } },
    });
    for (const m of tripsJoined) if (!blocked.has(`trip:${m.tripId}:${m.userId}`)) push(m.userId, { kind: 'kept', at: m.trip.dateEnd, label: m.trip.title });

    const tripsHosted = await this.prisma.trip.findMany({
      where: { hostId: { in: ids }, status: { notIn: ['cancelled', 'draft'] }, dateEnd: { lt: final, gt: horizon }, memberships: { some: { role: 'member', state: 'approved' } } },
      select: { hostId: true, title: true, dateEnd: true },
    });
    for (const t of tripsHosted) push(t.hostId, { kind: 'kept', at: t.dateEnd, label: t.title });

    // leaving late, or cancelling late with guests booked
    const left = await this.prisma.activityMembership.findMany({
      where: { userId: { in: ids }, role: 'attendee', state: 'withdrawn', leftAt: { not: null }, activity: { status: { not: 'cancelled' }, startsAt: { gt: horizon } } },
      select: { userId: true, leftAt: true, activity: { select: { title: true, startsAt: true } } },
    });
    for (const m of left) if (+m.leftAt! > +m.activity.startsAt - LATE_ACTIVITY_H * HOUR) push(m.userId, { kind: 'late_cancel', at: m.leftAt!, label: m.activity.title });
    const tripLeft = await this.prisma.tripMembership.findMany({
      where: { userId: { in: ids }, role: 'member', state: 'left', leftAt: { not: null }, trip: { status: { not: 'cancelled' }, dateStart: { gt: horizon } } },
      select: { userId: true, leftAt: true, trip: { select: { title: true, dateStart: true } } },
    });
    for (const m of tripLeft) if (+m.leftAt! > +m.trip.dateStart - LATE_TRIP_DAYS * DAY) push(m.userId, { kind: 'late_cancel', at: m.leftAt!, label: m.trip.title });
    const cancelled = await this.prisma.activity.findMany({
      where: { hostId: { in: ids }, status: 'cancelled', cancelledAt: { not: null }, startsAt: { gt: horizon }, memberships: { some: { role: 'attendee', state: 'approved' } } },
      select: { hostId: true, title: true, startsAt: true, cancelledAt: true },
    });
    for (const a of cancelled) if (+a.cancelledAt! > +a.startsAt - LATE_ACTIVITY_H * HOUR) push(a.hostId, { kind: 'host_late_cancel', at: a.cancelledAt!, label: a.title });
    const tripsCancelled = await this.prisma.trip.findMany({
      where: { hostId: { in: ids }, status: 'cancelled', cancelledAt: { not: null }, dateStart: { gt: horizon }, memberships: { some: { role: 'member', state: 'approved' } } },
      select: { hostId: true, title: true, dateStart: true, cancelledAt: true },
    });
    for (const t of tripsCancelled) if (+t.cancelledAt! > +t.dateStart - LATE_HOST_TRIP_DAYS * DAY) push(t.hostId, { kind: 'host_late_cancel', at: t.cancelledAt!, label: t.title });

    // reports a moderator resolved (a report alone never counts), about the person or about a plan they host
    const myActivities = await this.prisma.activity.findMany({ where: { hostId: { in: ids }, createdAt: { gt: horizon } }, select: { id: true, hostId: true } });
    const myTrips = await this.prisma.trip.findMany({ where: { hostId: { in: ids }, createdAt: { gt: horizon } }, select: { id: true, hostId: true } });
    const owner = new Map<string, string>([...myActivities.map((a) => [`activity:${a.id}`, a.hostId] as const), ...myTrips.map((t) => [`trip:${t.id}`, t.hostId] as const)]);
    const reports = await this.prisma.report.findMany({
      where: {
        status: 'resolved',
        resolvedAt: { gt: horizon },
        OR: [{ targetType: 'user', targetId: { in: ids } }, { targetType: 'activity', targetId: { in: myActivities.map((a) => a.id) } }, { targetType: 'trip', targetId: { in: myTrips.map((t) => t.id) } }],
      },
      select: { targetType: true, targetId: true, category: true, resolvedAt: true },
    });
    for (const r of reports) {
      const who = r.targetType === 'user' ? r.targetId : owner.get(`${r.targetType}:${r.targetId}`);
      if (who) push(who, { kind: 'upheld_report', at: r.resolvedAt!, label: CATEGORY_WORDS[r.category] ?? r.category });
    }
    return out;
  }

  async levelsFor(ids: string[], now = new Date()): Promise<Map<string, Summary>> {
    const facts = await this.factsFor(ids, now);
    return new Map(ids.map((id) => [id, summarise(facts.get(id) ?? [], now)]));
  }

  /** The level to show another person, or nothing if the viewer is not verified (levels are for verified members). */
  async forViewer(viewer: User, ids: string[]): Promise<Map<string, PublicLevel>> {
    const out = new Map<string, PublicLevel>();
    const lapsed = viewer.eligibility === 'verified' && !!viewer.verifiedUntil && viewer.verifiedUntil < new Date();
    if (viewer.eligibility !== 'verified' || lapsed || viewer.role === 'guest') return out;
    for (const [id, s] of await this.levelsFor([...new Set(ids)])) out.set(id, { level: s.level, label: LEVEL_LABEL[s.level] });
    return out;
  }

  /** Writes a line to the person's history when their level has changed since last time, with the event behind it. */
  private async sync(userId: string, s: Summary, facts: Fact[], now: Date) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { reliabilityLevel: true } });
    if (!user) return;
    if (user.reliabilityLevel !== s.level) {
      if (user.reliabilityLevel !== null || s.level !== 'new') {
        const newest = [...facts].sort((a, b) => +b.at - +a.at)[0];
        await this.prisma.reliabilityChange.create({
          data: { userId, fromLevel: user.reliabilityLevel, toLevel: s.level, facts: JSON.stringify({ kept: s.kept, noShows: s.noShows, lateCancels: s.lateCancels, upheld: s.upheld }), because: newest ? describe(newest) : 'Nothing counted yet' },
        });
      }
      await this.prisma.user.update({ where: { id: userId }, data: { reliabilityLevel: s.level, reliabilityChecked: now } });
    } else await this.prisma.user.update({ where: { id: userId }, data: { reliabilityChecked: now } });
  }

  /** What the person sees about their own level: the level, and one short line. The detail is not shown in the app. */
  async mine(me: User) {
    const now = new Date();
    const facts = (await this.factsFor([me.id], now)).get(me.id) ?? [];
    const s = summarise(facts, now);
    await this.sync(me.id, s, facts, now);
    return { level: s.level, label: LEVEL_LABEL[s.level], line: LEVEL_LINE[s.level] };
  }

  /** The full breakdown for the person, for their data download only (access to your own data). Never shown in the app. */
  async detailsFor(userId: string) {
    const now = new Date();
    const facts = (await this.factsFor([userId], now)).get(userId) ?? [];
    const s = summarise(facts, now);
    const changes = await this.prisma.reliabilityChange.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      level: LEVEL_LABEL[s.level],
      counts: { keptPlans: s.kept, confirmedNoShows: s.noShows, leftLate: s.lateCancels, upheldReports: s.upheld },
      events: capPerDay(facts)
        .filter((f) => weightOf(f.at, now) > 0)
        .sort((a, b) => +b.at - +a.at)
        .slice(0, 100)
        .map((f) => ({ at: f.at, what: describe(f) })),
      levelChanges: changes.map((c) => ({ at: c.createdAt, from: c.fromLevel ? LEVEL_LABEL[c.fromLevel as Level] : null, to: LEVEL_LABEL[c.toLevel as Level], because: c.because })),
      noShowNotes: (await this.prisma.attendanceMark.findMany({ where: { userId }, orderBy: { markedAt: 'desc' }, take: 50 })).map((m) => ({ plan: m.title, notedAt: m.markedAt, state: m.state, yourDispute: m.disputeNote, decision: m.decisionNote })),
    };
  }

  /** What staff see behind a level: every counted event and every note, so a mistake can be found and fixed. */
  async forStaff(userId: string) {
    const now = new Date();
    const facts = (await this.factsFor([userId], now)).get(userId) ?? [];
    const s = summarise(facts, now);
    await this.sync(userId, s, facts, now);
    const marks = await this.prisma.attendanceMark.findMany({ where: { userId }, orderBy: { markedAt: 'desc' }, take: 50 });
    const changes = await this.prisma.reliabilityChange.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      level: s.level,
      label: LEVEL_LABEL[s.level],
      summary: { kept: s.kept, noShows: s.noShows, lateCancels: s.lateCancels, upheldReports: s.upheld, upheldLast12Months: s.upheldRecent, rate: Math.round(s.rate * 100) / 100 },
      penalties: PENALTY,
      events: capPerDay(facts).sort((a, b) => +b.at - +a.at).slice(0, 100).map((f) => ({ kind: f.kind, at: f.at, text: describe(f), weight: Math.round(weightOf(f.at, now) * 100) / 100 })),
      marks: marks.map((m) => ({ id: m.id, kind: m.kind, targetId: m.targetId, title: m.title, state: m.state, markedAt: m.markedAt, disputeNote: m.disputeNote, decisionNote: m.decisionNote, counts: confirmed(m, now) })),
      changes: changes.map((c) => ({ at: c.createdAt, from: c.fromLevel, to: c.toLevel, because: c.because })),
    };
  }

  // ---------------------------------------------------------------- the host's notes: who did not come
  private async plan(kind: Kind, id: string) {
    if (kind === 'activity') {
      const a = await this.prisma.activity.findUnique({ where: { id } });
      return a && { hostId: a.hostId, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, cancelled: a.status === 'cancelled' || a.status === 'draft' };
    }
    const t = await this.prisma.trip.findUnique({ where: { id } });
    return t && { hostId: t.hostId, title: t.title, startsAt: t.dateStart, endsAt: t.dateEnd, cancelled: t.status === 'cancelled' || t.status === 'draft' };
  }

  private async attendees(kind: Kind, id: string) {
    if (kind === 'activity') {
      const rows = await this.prisma.activityMembership.findMany({ where: { activityId: id, role: 'attendee', state: 'approved' }, include: { user: { select: { id: true, profile: { select: { displayName: true, photoUrl: true } } } } } });
      return rows.map((r) => r.user);
    }
    const rows = await this.prisma.tripMembership.findMany({ where: { tripId: id, role: 'member', state: 'approved' }, include: { user: { select: { id: true, profile: { select: { displayName: true, photoUrl: true } } } } } });
    return rows.map((r) => r.user);
  }

  private notFound(kind: Kind) {
    return E.notFound(kind === 'activity' ? 'Activity' : 'Trip');
  }

  /** The host's list: who was approved, and any note already made. */
  async list(me: User, kind: Kind, id: string) {
    const p = await this.plan(kind, id);
    if (!p || p.hostId !== me.id) throw this.notFound(kind);
    const now = new Date();
    const marks = await this.prisma.attendanceMark.findMany({ where: { kind, targetId: id } });
    const byUser = new Map(marks.map((m) => [m.userId, m]));
    const closesAt = new Date(+p.endsAt + MARK_WINDOW_H * HOUR);
    return {
      title: p.title,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      canMark: !p.cancelled && now >= p.startsAt && now <= closesAt,
      markableFrom: p.startsAt,
      markableUntil: closesAt,
      items: (await this.attendees(kind, id)).map((u) => {
        const m = byUser.get(u.id);
        return { userId: u.id, displayName: u.profile?.displayName ?? 'Member', photoUrl: u.profile?.photoUrl ?? null, mark: m ? { id: m.id, state: m.state, markedAt: m.markedAt } : null };
      }),
    };
  }

  async mark(me: User, kind: Kind, id: string, body: unknown) {
    const { userId } = parse(markSchema, body);
    const p = await this.plan(kind, id);
    if (!p || p.hostId !== me.id) throw this.notFound(kind);
    if (userId === me.id) throw E.badRequest('INVALID_TARGET', 'You cannot mark yourself');
    if (p.cancelled) throw E.conflict('PLAN_CANCELLED', 'This plan was cancelled');
    const now = new Date();
    if (now < p.startsAt) throw E.conflict('MARK_NOT_OPEN', 'You can say who did not come once the plan has started');
    if (+now > +p.endsAt + MARK_WINDOW_H * HOUR) throw E.conflict('MARK_WINDOW_CLOSED', `The ${MARK_WINDOW_H} hours to say who did not come have passed`);
    if (!(await this.attendees(kind, id)).some((u) => u.id === userId)) throw E.notFound('Attendee');
    this.limiter.hit(`noshow-mark:${me.id}`, 40, DAY);

    const existing = await this.prisma.attendanceMark.findUnique({ where: { kind_targetId_userId: { kind, targetId: id, userId } } });
    if (existing) return { id: existing.id, state: existing.state };
    const m = await this.prisma.attendanceMark.create({ data: { kind, targetId: id, userId, markedById: me.id, title: p.title, planEndsAt: p.endsAt } });
    await this.audit.log(me.id, 'attendance.marked', kind, id, { userId, markId: m.id });
    await this.notifications.notify(userId, 'attendance_marked', 'The host says you did not come', `${p.title}: you can dispute this.`, { markId: m.id, ...(kind === 'activity' ? { activityId: id } : { tripId: id }) });
    await this.reviewHost(me.id).catch(() => undefined); // never lets the check get in the way of the note
    return { id: m.id, state: m.state };
  }

  /** The host takes a note back (a slip of the finger), while it is still just a note. */
  async unmark(me: User, kind: Kind, id: string, userId: string) {
    const p = await this.plan(kind, id);
    if (!p || p.hostId !== me.id) throw this.notFound(kind);
    const m = await this.prisma.attendanceMark.findUnique({ where: { kind_targetId_userId: { kind, targetId: id, userId } } });
    if (!m) return { ok: true };
    if (m.state !== 'marked') throw E.conflict('MARK_LOCKED', 'This note is already being looked at by a moderator');
    await this.prisma.attendanceMark.delete({ where: { id: m.id } });
    await this.audit.log(me.id, 'attendance.unmarked', kind, id, { userId });
    await this.notifications.notify(userId, 'attendance_decided', 'Note taken back', `${p.title}: the host took it back.`, { markId: m.id });
    return { ok: true };
  }

  /** The notes made about me, newest first, so I can see them and dispute one. */
  async mineMarks(me: User, limitRaw?: string, cursorRaw?: string) {
    const now = new Date();
    const limit = pageLimit(limitRaw, 20);
    const found = await this.prisma.attendanceMark.findMany({ where: { userId: me.id, ...beforeKeyset(decodeKeyset(cursorRaw), 'markedAt') }, orderBy: [{ markedAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = sliceKeyset(found, limit, (m) => m.markedAt);
    const rows = page.items;
    return {
      nextCursor: page.nextCursor,
      items: rows.map((m) => ({
        id: m.id,
        kind: m.kind,
        targetId: m.targetId,
        title: m.title,
        state: m.state,
        markedAt: m.markedAt,
        canDispute: m.state === 'marked' && +now <= +m.markedAt + DISPUTE_DAYS * DAY,
        disputeUntil: new Date(+m.markedAt + DISPUTE_DAYS * DAY),
        counts: confirmed(m, now),
        decisionNote: m.state === 'upheld' || m.state === 'overturned' ? m.decisionNote : null,
      })),
    };
  }

  async dispute(me: User, markId: string, body: unknown) {
    const { note } = parse(disputeSchema, body);
    const m = await this.prisma.attendanceMark.findUnique({ where: { id: markId } });
    if (!m || m.userId !== me.id) throw E.notFound('Note');
    if (m.state !== 'marked') throw E.conflict('NOT_DISPUTABLE', m.state === 'disputed' ? 'You have already disputed this' : 'A moderator has already decided this');
    if (+new Date() > +m.markedAt + DISPUTE_DAYS * DAY) throw E.conflict('DISPUTE_CLOSED', `The ${DISPUTE_DAYS} days to dispute this have passed`);
    await this.prisma.attendanceMark.update({ where: { id: m.id }, data: { state: 'disputed', disputeNote: note, disputedAt: new Date() } });
    await this.audit.log(me.id, 'attendance.disputed', m.kind, m.targetId, { markId: m.id });
    return { id: m.id, state: 'disputed' };
  }

  // ---------------------------------------------------------------- moderators
  async adminList(state?: string) {
    const rows = await this.prisma.attendanceMark.findMany({
      where: state && state !== 'all' ? { state } : { state: { in: ['disputed', 'marked'] } },
      orderBy: { markedAt: 'asc' },
      take: 100,
    });
    const people = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.markedById]))] } }, select: { id: true, email: true, profile: { select: { displayName: true } } } });
    const name = new Map(people.map((p) => [p.id, { id: p.id, email: p.email, displayName: p.profile?.displayName ?? p.email }]));
    // hosts whose notes look unusual are marked, so a moderator reads those notes with that in mind
    const hosts = [...new Set(rows.map((r) => r.markedById))].slice(0, 30);
    const flagged = new Map((await Promise.all(hosts.map(async (h) => [h, await this.hostPattern(h)] as const))).map(([h, p]) => [h, p.flag ? p.reasons : null]));
    return { items: rows.map((r) => ({ id: r.id, kind: r.kind, targetId: r.targetId, title: r.title, state: r.state, markedAt: r.markedAt, disputedAt: r.disputedAt, disputeNote: r.disputeNote, decisionNote: r.decisionNote, member: name.get(r.userId), host: name.get(r.markedById), hostUnusual: flagged.get(r.markedById) ?? null })) };
  }

  /** A moderator settles a note: uphold it (it counts) or overturn it (it never counts). Works on any note, to fix mistakes. */
  async decide(actor: User, markId: string, body: unknown) {
    const { decision, note } = parse(decisionSchema, body);
    const m = await this.prisma.attendanceMark.findUnique({ where: { id: markId } });
    if (!m) throw E.notFound('Note');
    const state = decision === 'uphold' ? 'upheld' : 'overturned';
    await this.prisma.attendanceMark.update({ where: { id: m.id }, data: { state, decidedById: actor.id, decidedAt: new Date(), decisionNote: note } });
    await this.audit.log(actor.id, `attendance.${state}`, m.kind, m.targetId, { markId: m.id, userId: m.userId, note });
    const text = decision === 'uphold' ? 'A moderator confirmed it.' : 'A moderator overturned it.';
    await this.notifications.notify(m.userId, 'attendance_decided', decision === 'uphold' ? 'Note confirmed' : 'Note overturned', `${m.title}: ${text}`, { markId: m.id });
    await this.notifications.notify(m.markedById, 'attendance_decided', decision === 'uphold' ? 'Your note was confirmed' : 'Your note was overturned', `${m.title}: a moderator ${decision === 'uphold' ? 'confirmed' : 'overturned'} your note.`, { markId: m.id });
    await this.reviewHost(m.markedById).catch(() => undefined); // a string of overturned notes is a reason to look at the host
    return { id: m.id, state };
  }

  // ---------------------------------------------------------------- members: the host did not show up
  /**
   * A member of a plan says the host never came. It is an ordinary report (category host_no_show) that moderators decide; if
   * one confirms it, it counts against the host like any upheld report, and the notes the host made about members for that
   * plan are cancelled (see onHostAbsenceUpheld). Only approved members can say it, only once the plan has been on for a
   * while, and only for a few days after it ended.
   */
  async reportHostAbsent(me: User, kind: Kind, id: string, note?: string) {
    const p = await this.plan(kind, id);
    const member = !p
      ? null
      : kind === 'activity'
        ? await this.prisma.activityMembership.findFirst({ where: { activityId: id, userId: me.id, role: 'attendee', state: 'approved' }, select: { id: true } })
        : await this.prisma.tripMembership.findFirst({ where: { tripId: id, userId: me.id, role: 'member', state: 'approved' }, select: { id: true } });
    if (!p || !member) throw this.notFound(kind); // not a member: the plan does not exist as far as they can tell
    if (p.cancelled) throw E.conflict('PLAN_CANCELLED', 'This plan was cancelled');
    const now = new Date();
    if (+now < +p.startsAt + HOST_ABSENT_GRACE_MIN * 60_000) throw E.conflict('HOST_ABSENT_TOO_EARLY', `You can say the host did not show up ${HOST_ABSENT_GRACE_MIN} minutes after the plan has started`);
    if (+now > +p.endsAt + HOST_ABSENT_WINDOW_H * HOUR) throw E.conflict('HOST_ABSENT_WINDOW_CLOSED', `The ${HOST_ABSENT_WINDOW_H} hours to say the host did not show up have passed`);
    const existing = await this.prisma.report.findFirst({ where: { reporterId: me.id, targetType: kind, targetId: id, category: 'host_no_show' } });
    if (existing) return { id: existing.id, status: existing.status, priority: existing.priority };
    this.limiter.hit(`host-absent:${me.id}`, 10, DAY);
    const r = await this.prisma.report.create({ data: { reporterId: me.id, targetType: kind, targetId: id, category: 'host_no_show', details: note || undefined, priority: 'normal' } });
    await this.audit.log(me.id, 'attendance.host_absent_reported', kind, id, { reportId: r.id });
    // the host is told, in neutral words: it is a report, not a decision
    await this.notifications.notify(p.hostId, 'host_absence_reported', 'A member says you did not show up', `${p.title}: a moderator will look at it. If you were there, you do not need to do anything unless we contact you.`, { reportId: r.id, ...(kind === 'activity' ? { activityId: id } : { tripId: id }) });
    return { id: r.id, status: r.status, priority: r.priority };
  }

  /** What a moderator needs to decide a "host did not show up" report: who says what, and what the plan's own records show. */
  async hostAbsenceEvidence(reports: { id: string; targetType: string; targetId: string; reporterId: string }[]) {
    const out = new Map<string, Record<string, unknown>>();
    for (const r of reports) {
      const kind: Kind = r.targetType === 'trip' ? 'trip' : 'activity';
      const p = await this.plan(kind, r.targetId);
      if (!p) continue;
      const conv = await this.prisma.conversation.findUnique({ where: kind === 'activity' ? { activityId: r.targetId } : { tripId: r.targetId }, select: { id: true } });
      const [reporters, attendees, attended, hostMessages, hostMarkedReporter, hostActs, hostTrips] = await Promise.all([
        this.prisma.report.findMany({ where: { targetType: kind, targetId: r.targetId, category: 'host_no_show' }, select: { reporterId: true } }),
        this.attendees(kind, r.targetId),
        kind === 'activity' ? this.prisma.activityMembership.count({ where: { activityId: r.targetId, role: 'attendee', state: 'approved', attendance: 'attended' } }) : Promise.resolve(null),
        conv ? this.prisma.message.count({ where: { conversationId: conv.id, senderId: p.hostId, kind: { not: 'system' }, createdAt: { gte: new Date(+p.startsAt - HOUR), lte: new Date(+p.endsAt + HOUR) } } }) : Promise.resolve(0),
        this.prisma.attendanceMark.findFirst({ where: { kind, targetId: r.targetId, userId: r.reporterId }, select: { id: true } }),
        this.prisma.activity.findMany({ where: { hostId: p.hostId, id: { not: r.targetId } }, select: { id: true } }),
        this.prisma.trip.findMany({ where: { hostId: p.hostId, id: { not: r.targetId } }, select: { id: true } }),
      ]);
      const earlier = await this.prisma.report.count({ where: { category: 'host_no_show', status: 'resolved', targetId: { in: [...hostActs, ...hostTrips].map((x) => x.id) } } });
      out.set(r.id, {
        plan: { title: p.title, startsAt: p.startsAt, endsAt: p.endsAt, hostId: p.hostId },
        attendees: attendees.length,
        reporters: new Set(reporters.map((x) => x.reporterId)).size,
        membersSaidTheyAttended: attended,
        hostMessagesDuringPlan: hostMessages,
        hostMarkedThisReporter: !!hostMarkedReporter,
        earlierConfirmedAbsences: earlier,
      });
    }
    return out;
  }

  /** A moderator confirmed the host did not show up: the host's notes about members for that plan are cancelled, and the host is told. */
  async onHostAbsenceUpheld(actor: User, report: { id: string; targetType: string; targetId: string }) {
    const kind: Kind = report.targetType === 'trip' ? 'trip' : 'activity';
    const p = await this.plan(kind, report.targetId);
    if (!p) return;
    const notes = await this.prisma.attendanceMark.findMany({ where: { kind, targetId: report.targetId, state: { in: ['marked', 'disputed'] } } });
    for (const m of notes) {
      await this.prisma.attendanceMark.update({ where: { id: m.id }, data: { state: 'overturned', decidedById: actor.id, decidedAt: new Date(), decisionNote: 'Cancelled: a moderator confirmed the host did not show up to this plan.' } });
      await this.audit.log(actor.id, 'attendance.overturned', kind, report.targetId, { markId: m.id, userId: m.userId, because: 'host_absent', reportId: report.id });
      await this.notifications.notify(m.userId, 'attendance_decided', 'Note cancelled', `${m.title}: the host's note about you was cancelled.`, { markId: m.id });
    }
    await this.notifications.notify(p.hostId, 'host_absence_decided', 'A moderator confirmed a report about you', `${p.title}: a moderator confirmed you did not show up. You can ask for a review under Settings, Reviews of decisions.`, { reportId: report.id });
  }

  // ---------------------------------------------------------------- hosts who say many people did not come
  /** How often a host marks people as not coming, and whether that looks unusual (see HOST_MARK_REVIEW). Never acts by itself. */
  async hostPattern(hostId: string, now = new Date()) {
    const since = new Date(+now - HOST_MARK_REVIEW.windowDays * DAY);
    const [marks, actSlots, tripSlots] = await Promise.all([
      this.prisma.attendanceMark.findMany({ where: { markedById: hostId, markedAt: { gte: since } }, select: { state: true } }),
      this.prisma.activityMembership.count({ where: { role: 'attendee', state: 'approved', activity: { hostId, startsAt: { gte: since, lt: now }, status: { notIn: ['cancelled', 'draft'] } } } }),
      this.prisma.tripMembership.count({ where: { role: 'member', state: 'approved', trip: { hostId, dateStart: { gte: since, lt: now }, status: { notIn: ['cancelled', 'draft'] } } } }),
    ]);
    const made = marks.length;
    const attendees = actSlots + tripSlots;
    const overturned = marks.filter((m) => m.state === 'overturned').length;
    const decided = overturned + marks.filter((m) => m.state === 'upheld').length;
    const share = attendees ? made / attendees : made > 0 ? 1 : 0;
    const reasons: string[] = [];
    if (made >= HOST_MARK_REVIEW.minMarks && share >= HOST_MARK_REVIEW.shareOfAttendees) reasons.push(`said ${made} of ${attendees || made} people did not come in ${HOST_MARK_REVIEW.windowDays} days (${Math.round(share * 100)}%)`);
    if (made >= HOST_MARK_REVIEW.minMarks && decided >= HOST_MARK_REVIEW.minDecided && overturned / decided >= HOST_MARK_REVIEW.overturnedShare) reasons.push(`${overturned} of ${decided} decided notes were overturned`);
    return { flag: reasons.length > 0, reasons, marks: made, attendees, decided, overturned };
  }

  /** After a host's note or its decision: if the pattern looks unusual, the moderators are told once a month per host. */
  private async reviewHost(hostId: string) {
    const pat = await this.hostPattern(hostId);
    if (!pat.flag) return pat;
    const recent = await this.prisma.auditEvent.findFirst({ where: { action: 'attendance.host_flagged', objectType: 'user', objectId: hostId, createdAt: { gte: new Date(Date.now() - 30 * DAY) } }, select: { id: true } });
    if (recent) return pat;
    await this.audit.log(null, 'attendance.host_flagged', 'user', hostId, { reasons: pat.reasons });
    const staff = await this.prisma.user.findMany({ where: { role: { in: MOD }, state: 'active' }, select: { id: true } });
    await this.notifications.notifyMany(staff.map((s) => s.id), 'host_marks_review', 'A host marks many people as not coming', `${pat.reasons.join('; ')}. Please look at their notes before they count.`, { userId: hostId });
    return pat;
  }

  /** Hosts who made notes lately, most first; only the unusual ones unless `all`. */
  async adminHosts(all = false) {
    const since = new Date(Date.now() - HOST_MARK_REVIEW.windowDays * DAY);
    const grouped = await this.prisma.attendanceMark.groupBy({ by: ['markedById'], where: { markedAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { markedById: 'desc' } }, take: 50 });
    const patterns = await Promise.all(grouped.map(async (g) => ({ hostId: g.markedById, ...(await this.hostPattern(g.markedById)) })));
    const people = await this.prisma.user.findMany({ where: { id: { in: patterns.map((p) => p.hostId) } }, select: { id: true, email: true, profile: { select: { displayName: true } } } });
    const name = new Map(people.map((p) => [p.id, p.profile?.displayName ?? p.email]));
    return { rule: HOST_MARK_REVIEW, items: patterns.filter((p) => all || p.flag).map((p) => ({ ...p, name: name.get(p.hostId) ?? 'Host' })) };
  }
}

@Controller('v1')
export class ReliabilityController {
  constructor(private readonly reliability: ReliabilityService) {}

  /** How levels work, in plain words (what / how / why cards). Public, like the retention page. */
  @Public()
  @Get('reliability/info')
  info() {
    return { items: reliabilityInfo() };
  }

  /** My level, and one short line. */
  @Get('me/reliability')
  mine(@CurrentUser() me: User) {
    return this.reliability.mine(me);
  }

  /** Notes the hosts have made about me. */
  @Get('me/no-shows')
  mineMarks(@CurrentUser() me: User, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.reliability.mineMarks(me, limit, cursor);
  }

  @Post('no-shows/:markId/dispute')
  dispute(@CurrentUser() me: User, @Param('markId') markId: string, @Body() body: unknown) {
    return this.reliability.dispute(me, markId, body);
  }

  // ---- the host's side, for a HERE activity ...
  @Get('activities/:id/no-shows')
  listActivity(@CurrentUser() me: User, @Param('id') id: string) {
    return this.reliability.list(me, 'activity', id);
  }

  @Post('activities/:id/no-shows')
  markActivity(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.reliability.mark(me, 'activity', id, body);
  }

  @Delete('activities/:id/no-shows/:userId')
  unmarkActivity(@CurrentUser() me: User, @Param('id') id: string, @Param('userId') userId: string) {
    return this.reliability.unmark(me, 'activity', id, userId);
  }

  // ---- ... and for a THERE trip
  @Get('trips/:id/no-shows')
  listTrip(@CurrentUser() me: User, @Param('id') id: string) {
    return this.reliability.list(me, 'trip', id);
  }

  @Post('trips/:id/no-shows')
  markTrip(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.reliability.mark(me, 'trip', id, body);
  }

  @Delete('trips/:id/no-shows/:userId')
  unmarkTrip(@CurrentUser() me: User, @Param('id') id: string, @Param('userId') userId: string) {
    return this.reliability.unmark(me, 'trip', id, userId);
  }

  // ---- moderators
  @Staff(...ALL)
  @Get('admin/no-shows')
  adminList(@Query('state') state?: string) {
    return this.reliability.adminList(state);
  }

  /** Hosts who say many people did not come (or whose notes keep being overturned): the check from the reliability hardening list. */
  @Staff(...ALL)
  @Get('admin/no-shows/hosts')
  adminHosts(@Query('all') all?: string) {
    return this.reliability.adminHosts(all === 'true');
  }

  @Staff(...MOD)
  @Post('admin/no-shows/:markId/decision')
  decide(@CurrentUser() actor: User, @Param('markId') markId: string, @Body() body: unknown) {
    return this.reliability.decide(actor, markId, body);
  }

  @Staff(...ALL)
  @Get('admin/users/:id/reliability')
  forStaff(@Param('id') id: string) {
    return this.reliability.forStaff(id);
  }
}

