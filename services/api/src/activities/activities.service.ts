import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Activity, Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { requireVerified } from '../common/auth';
import { CATEGORIES } from '../common/constants';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { LiveService } from '../common/live.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SafetyService } from '../safety/safety.service';

const HOUR = 3600 * 1000;
const MIN_LEAD = 9 * 60 * 1000; // "at least 10 minutes" in the app, minus a minute of grace for the submit

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  category: z.enum(CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(24)).max(5).default([]),
  description: z.string().trim().max(1000).optional(),
  city: z.string().trim().min(2).max(60),
  venueName: z.string().trim().min(2).max(120),
  venuePlaceId: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  capacity: z.number().int().min(2).max(20),
  visibility: z.enum(['public', 'invite_only']).default('public'),
  language: z.string().max(20).optional(),
});

const updateSchema = createSchema
  .pick({ title: true, description: true, venueName: true, venuePlaceId: true, lat: true, lng: true, startsAt: true, endsAt: true, capacity: true })
  .partial();

const listSchema = z.object({
  city: z.string().trim().optional(),
  category: z.enum(CATEGORIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(100).optional(),
  hasSpots: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const requestSchema = z.object({ intro: z.string().trim().max(500).optional() });
const decisionSchema = z.object({ decision: z.enum(['approve', 'decline']) });

type ActivityFull = Activity & {
  host: { id: string; eligibility: string; profile: { displayName: string; photoUrl: string | null } | null };
  _count?: { memberships: number };
};

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** Derived from stored status + clock so stale activities never stay "open" (screenbook 02). */
export function effectiveStatus(a: Pick<Activity, 'status' | 'startsAt' | 'endsAt'>, now = new Date()) {
  if (a.status === 'cancelled' || a.status === 'archived' || a.status === 'draft') return a.status;
  if (now >= a.endsAt) return 'completed';
  if (now >= a.startsAt) return 'in_progress';
  return a.status;
}

@Injectable()
export class ActivitiesService implements OnModuleInit, OnModuleDestroy {
  private sweeper?: NodeJS.Timeout;

  /** Pending requests are closed the moment an activity starts; this sweep makes that happen on time even if nobody opens the app. */
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.sweeper = setInterval(() => void this.expirePendingRequests().catch(() => undefined), 15_000);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /**
   * Once an activity has started nobody can join it, so every request the host never answered is declined, and the
   * person is told. Run by the sweep above and also whenever requests or activities are read, so it is never late.
   */
  async expirePendingRequests(activityId?: string) {
    const now = new Date();
    const stale = await this.prisma.activityRequest.findMany({
      where: { state: { in: ['requested', 'waitlisted'] }, activity: { startsAt: { lte: now }, ...(activityId ? { id: activityId } : {}) } },
      include: { activity: { select: { title: true, hostId: true } } },
    });
    if (stale.length === 0) return 0;
    await this.prisma.activityRequest.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { state: 'declined', decidedAt: now } });
    for (const r of stale) await this.notifications.settleRequest(r.activity.hostId, 'join_request', { activityId: r.activityId }, r.applicantId);
    for (const r of stale)
      await this.notifications.notify(r.applicantId, 'request_declined', 'Request not approved', `The host did not answer before ${r.activity.title} started, so your request was closed.`, { activityId: r.activityId });
    return stale.length;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly live: LiveService,
  ) {}

  private dto(a: ActivityFull, going: number, extra: Record<string, unknown> = {}) {
    const status = effectiveStatus(a);
    return {
      id: a.id,
      title: a.title,
      category: a.category,
      tags: a.tags ? a.tags.split(',') : [],
      description: a.description,
      city: a.city,
      venueName: a.venueName,
      lat: a.lat,
      lng: a.lng,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      capacity: a.capacity,
      going,
      spotsLeft: Math.max(0, a.capacity - going),
      status,
      visibility: a.visibility,
      language: a.language,
      host: { id: a.host.id, displayName: a.host.profile?.displayName ?? 'Host', photoUrl: a.host.profile?.photoUrl ?? null, verifiedAdult: a.host.eligibility === 'verified' },
      ...extra,
    };
  }

  private readonly hostInclude = {
    host: { select: { id: true, eligibility: true, profile: { select: { displayName: true, photoUrl: true } } } },
  } as const;

  private async goingCount(activityId: string) {
    return this.prisma.activityMembership.count({ where: { activityId, state: 'approved' } });
  }

  // ---------------------------------------------------------------- discovery
  async list(me: User, query: unknown) {
    const q = parse(listSchema, query);
    const now = new Date();
    const from = q.from && q.from > now ? q.from : now;
    const to = q.to ?? new Date(from.getTime() + 24 * HOUR);
    if (to <= from) throw E.badRequest('VALIDATION_FAILED', '"to" must be after "from"');

    const blocked = await this.safety.blockedWith(me.id);
    const and: Prisma.ActivityWhereInput[] = [
      { status: { in: ['published', 'full', 'confirmed'] } },
      // coming up in the window, or already started and not over yet (shown as "Happening now")
      { OR: [{ startsAt: { gte: from, lte: to } }, { startsAt: { lt: now }, endsAt: { gt: now } }] },
      { hostId: { notIn: blocked } },
      {
        OR: [
          { visibility: 'public' },
          { hostId: me.id },
          { memberships: { some: { userId: me.id, state: 'approved' } } },
        ],
      },
    ];
    if (q.city) and.push({ cityKey: q.city.toLowerCase() });
    if (q.category) and.push({ category: q.category });

    const geo = q.lat !== undefined && q.lng !== undefined && q.radiusKm !== undefined;
    if (geo) {
      const dLat = q.radiusKm! / 111;
      const dLng = q.radiusKm! / (111 * Math.max(0.1, Math.cos((q.lat! * Math.PI) / 180)));
      and.push({
        lat: { gte: q.lat! - dLat, lte: q.lat! + dLat },
        lng: { gte: q.lng! - dLng, lte: q.lng! + dLng },
      });
    }

    let cursorWhere: Prisma.ActivityWhereInput | undefined;
    if (q.cursor) {
      const [iso, id] = Buffer.from(q.cursor, 'base64url').toString().split('|');
      const d = new Date(iso);
      if (!id || isNaN(+d)) throw E.badRequest('INVALID_CURSOR', 'Invalid cursor');
      cursorWhere = { OR: [{ startsAt: { gt: d } }, { startsAt: d, id: { gt: id } }] };
    }

    const rows = await this.prisma.activity.findMany({
      where: { AND: [...and, ...(cursorWhere ? [cursorWhere] : [])] },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      include: { ...this.hostInclude, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });

    const page = rows.slice(0, q.limit);
    const favs = new Set(
      (await this.prisma.favorite.findMany({ where: { userId: me.id, activityId: { in: page.map((a) => a.id) } } })).map(
        (f) => f.activityId,
      ),
    );

    let items = page.map((a) => {
      const going = a._count.memberships;
      const dist = geo && a.lat != null && a.lng != null ? distanceKm(q.lat!, q.lng!, a.lat, a.lng) : undefined;
      return { dist, item: this.dto(a, going, { distanceKm: dist !== undefined ? Math.round(dist * 10) / 10 : undefined, favorited: favs.has(a.id) }) };
    });
    if (geo) items = items.filter((x) => x.dist !== undefined && x.dist <= q.radiusKm!);
    if (q.hasSpots === 'true') items = items.filter((x) => x.item.spotsLeft > 0);

    const last = page[page.length - 1];
    return {
      items: items.map((x) => x.item),
      nextCursor:
        rows.length > q.limit && last ? Buffer.from(`${last.startsAt.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  async detail(me: User, id: string) {
    await this.expirePendingRequests(id);
    const a = await this.prisma.activity.findUnique({ where: { id }, include: this.hostInclude });
    if (!a) throw E.notFound('Activity');
    if (await this.safety.isBlocked(me.id, a.hostId)) throw E.notFound('Activity');

    const membership = await this.prisma.activityMembership.findUnique({
      where: { activityId_userId: { activityId: id, userId: me.id } },
    });
    const isMember = membership?.state === 'approved';
    if (a.visibility === 'invite_only' && !isMember && a.hostId !== me.id) throw E.notFound('Activity');

    const [going, request, conv, fav] = await Promise.all([
      this.goingCount(id),
      this.prisma.activityRequest.findUnique({ where: { activityId_applicantId: { activityId: id, applicantId: me.id } } }),
      isMember ? this.prisma.conversation.findUnique({ where: { activityId: id } }) : null,
      this.prisma.favorite.findUnique({ where: { userId_activityId: { userId: me.id, activityId: id } } }),
    ]);

    // Participants: only approved members' display names; never locations.
    const members = await this.prisma.activityMembership.findMany({
      where: { activityId: id, state: 'approved' },
      include: { user: { select: { id: true, eligibility: true, profile: { select: { displayName: true, photoUrl: true } } } } },
    });

    // a plain count of this host's real activities (not cancelled), shown as "N activities hosted"
    const activitiesHosted = await this.prisma.activity.count({ where: { hostId: a.hostId, status: { in: ['published', 'in_progress', 'completed'] } } });

    const nominee = a.pendingHostId
      ? await this.prisma.profile.findUnique({ where: { userId: a.pendingHostId }, select: { displayName: true } })
      : null;
    return this.dto(a, going, {
      isHost: a.hostId === me.id,
      isMember,
      // plan changed by the host: this member is asked to confirm or leave
      needsReconfirm: isMember && membership?.reconfirm === 'needed',
      // a pending hand-over of hosting: the host sees who it was offered to, that person sees an offer to accept
      handover: a.pendingHostId ? { toMe: a.pendingHostId === me.id, toName: a.hostId === me.id ? (nominee?.displayName ?? 'a member') : undefined } : null,
      // only ever set by the member, after it ended (voluntary)
      myAttendance: isMember ? (membership?.attendance ?? 'unknown') : undefined,
      activitiesHosted,
      myRequest: request ? { id: request.id, state: request.state, position: request.state === 'waitlisted' ? await this.waitlistPosition(id, request.createdAt) : undefined } : null,
      favorited: !!fav,
      // chat id is withheld until the server has approved this user
      conversationId: conv?.id ?? null,
      participants: members.map((m) => ({
        id: m.user.id,
        displayName: m.user.profile?.displayName ?? 'Member',
        photoUrl: m.user.profile?.photoUrl ?? null,
        verifiedAdult: m.user.eligibility === 'verified',
        role: m.role,
      })),
    });
  }

  // ---------------------------------------------------------------- creation
  async create(me: User, body: unknown) {
    requireVerified(me);
    const dto = parse(createSchema, body);
    const now = new Date();

    // HERE is for plans within a day: starting at least 10 minutes from now (1 minute of grace for a slow submit),
    // and no later than the end of tomorrow. 48 hours is the widest that can be, whatever the person's time zone.
    if (dto.startsAt.getTime() < now.getTime() + MIN_LEAD)
      throw E.badRequest('INVALID_SCHEDULE', 'Start time must be at least 10 minutes from now');
    if (dto.startsAt.getTime() - now.getTime() > 48 * HOUR)
      throw E.badRequest('INVALID_SCHEDULE', 'HERE activities are for today or tomorrow');
    if (dto.endsAt <= dto.startsAt) throw E.badRequest('INVALID_SCHEDULE', 'End time must be after start time');
    if (dto.endsAt.getTime() - dto.startsAt.getTime() > 12 * HOUR)
      throw E.badRequest('INVALID_SCHEDULE', 'Activities can last at most 12 hours');
    for (const t of [dto.title, dto.description, dto.venueName]) {
      const bad = contentProblem(t);
      if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    }

    // anti-spam: bounded creates per day and bounded concurrent open activities
    this.limiter.hit(`activity-create:${me.id}`, 5, 24 * HOUR);
    const open = await this.prisma.activity.count({
      where: { hostId: me.id, status: { in: ['published', 'full', 'confirmed'] }, endsAt: { gt: now } },
    });
    if (open >= 5) throw E.conflict('TOO_MANY_OPEN_ACTIVITIES', 'You already host 5 upcoming activities');

    // the same plan twice is spam: same host and same title overlapping in time, or the same place at about the same start
    const near = await this.prisma.activity.findMany({
      where: { hostId: me.id, status: { in: ['published', 'full', 'confirmed'] }, endsAt: { gt: now } },
      select: { title: true, venueName: true, startsAt: true, endsAt: true },
    });
    const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
    const dup = near.find(
      (o) =>
        (norm(o.title) === norm(dto.title) && o.startsAt < dto.endsAt && dto.startsAt < o.endsAt) ||
        (norm(o.venueName) === norm(dto.venueName) && Math.abs(+o.startsAt - +dto.startsAt) < HOUR),
    );
    if (dup) throw E.conflict('DUPLICATE_ACTIVITY', 'You already have an activity like this at that time. Change it instead of posting it again.');

    const created = await this.prisma.$transaction(async (tx) => {
      const a = await tx.activity.create({
        data: {
          hostId: me.id,
          title: dto.title,
          category: dto.category,
          tags: dto.tags.join(','),
          description: dto.description,
          city: dto.city,
          cityKey: dto.city.toLowerCase(),
          venueName: dto.venueName,
          venuePlaceId: dto.venuePlaceId,
          lat: dto.lat,
          lng: dto.lng,
          startsAt: dto.startsAt,
          endsAt: dto.endsAt,
          capacity: dto.capacity,
          visibility: dto.visibility,
          language: dto.language,
          status: 'published',
        },
      });
      await tx.activityMembership.create({ data: { activityId: a.id, userId: me.id, role: 'host' } });
      // conversation exists from publish, but nobody can read it until individually approved
      await tx.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
      return a;
    });
    await this.audit.log(me.id, 'activity.create', 'activity', created.id);
    this.live.feedChanged();
    return this.detail(me, created.id);
  }

  private async hostOwned(me: User, id: string) {
    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a) throw E.notFound('Activity');
    if (a.hostId !== me.id) throw E.forbidden('NOT_HOST', 'Only the host can do this');
    return a;
  }

  private async attendeeIds(activityId: string, exceptUserId?: string) {
    const m = await this.prisma.activityMembership.findMany({
      where: { activityId, state: 'approved', ...(exceptUserId && { userId: { not: exceptUserId } }) },
    });
    return m.map((x) => x.userId);
  }

  async update(me: User, id: string, body: unknown) {
    const a = await this.hostOwned(me, id);
    if (['cancelled', 'archived'].includes(a.status) || effectiveStatus(a) === 'completed')
      throw E.conflict('ACTIVITY_CLOSED', 'This activity can no longer be edited');
    const dto = parse(updateSchema, body);
    for (const t of [dto.title, dto.description, dto.venueName]) {
      const bad = contentProblem(t);
      if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    }
    const startsAt = dto.startsAt ?? a.startsAt;
    const endsAt = dto.endsAt ?? a.endsAt;
    if (startsAt <= new Date()) throw E.badRequest('INVALID_SCHEDULE', 'Start time must be in the future');
    if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 12 * HOUR)
      throw E.badRequest('INVALID_SCHEDULE', 'Invalid duration');
    const going = await this.goingCount(id);
    if (dto.capacity !== undefined && dto.capacity < going)
      throw E.conflict('CAPACITY_BELOW_MEMBERS', `Capacity cannot be lower than the ${going} approved members`);

    const venueChanged = dto.venueName !== undefined && dto.venueName !== a.venueName;
    const timeChanged = +startsAt !== +a.startsAt || +endsAt !== +a.endsAt;

    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.venueName !== undefined && { venueName: dto.venueName }),
        ...(dto.venuePlaceId !== undefined && { venuePlaceId: dto.venuePlaceId }),
        ...(dto.lat !== undefined && { lat: dto.lat }),
        ...(dto.lng !== undefined && { lng: dto.lng }),
        startsAt,
        endsAt,
        ...(dto.capacity !== undefined && {
          capacity: dto.capacity,
          status: going >= dto.capacity ? 'full' : a.status === 'full' ? 'published' : a.status,
        }),
      },
    });

    if (venueChanged || timeChanged) {
      // material change: tell accepted attendees what the previous and new values are (H-US03)
      const recipients = await this.attendeeIds(id, me.id);
      // and ask each of them to reconfirm: they can say yes, or leave if the new plan does not suit them
      await this.prisma.activityMembership.updateMany({ where: { activityId: id, state: 'approved', role: { not: 'host' } }, data: { reconfirm: 'needed' } });
      await this.notifications.notifyMany(
        recipients,
        'activity_changed',
        `Plan changed: ${updated.title}`,
        `Time: ${a.startsAt.toISOString()} → ${startsAt.toISOString()}. Venue: ${a.venueName} → ${updated.venueName}. Please confirm you can still come, or leave the activity.`,
        { activityId: id, previous: { startsAt: a.startsAt, venueName: a.venueName }, next: { startsAt, venueName: updated.venueName } },
      );
      await this.audit.log(me.id, 'activity.material_change', 'activity', id, { venueChanged, timeChanged });
    }
    if (dto.capacity !== undefined) await this.fillFromWaitlist(id); // a higher limit lets people in off the waiting list
    this.live.feedChanged();
    return this.detail(me, id);
  }

  async cancel(me: User, id: string, byStaff = false) {
    const a = byStaff ? await this.prisma.activity.findUnique({ where: { id } }) : await this.hostOwned(me, id);
    if (!a) throw E.notFound('Activity');
    if (a.status === 'cancelled') return { ok: true };
    // a finished activity is history: it stays "Completed", it cannot be cancelled afterwards (staff removal still can)
    if (!byStaff && effectiveStatus(a) === 'completed') throw E.conflict('ACTIVITY_FINISHED', 'This activity has already finished');
    await this.prisma.activity.update({ where: { id }, data: { status: 'cancelled' } });
    // close registration: pending requests are declined, accepted attendees notified
    await this.prisma.activityRequest.updateMany({
      where: { activityId: id, state: 'requested' },
      data: { state: 'declined', decidedAt: new Date() },
    });
    for (const r of await this.prisma.activityRequest.findMany({ where: { activityId: id, state: 'declined' }, select: { applicantId: true } }))
      await this.notifications.settleRequest(a.hostId, 'join_request', { activityId: id }, r.applicantId);
    const recipients = await this.attendeeIds(id, byStaff ? undefined : me.id);
    await this.notifications.notifyMany(recipients, 'activity_cancelled', `Cancelled: ${a.title}`, 'This activity was cancelled.', {
      activityId: id,
    });
    await this.audit.log(me.id, byStaff ? 'activity.removed_by_staff' : 'activity.cancel', 'activity', id);
    this.live.feedChanged();
    return { ok: true };
  }

  // ---------------------------------------------------------------- join requests
  async request(me: User, id: string, body: unknown) {
    requireVerified(me);
    const dto = parse(requestSchema, body);
    const bad = contentProblem(dto.intro);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);

    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a || (await this.safety.isBlocked(me.id, a.hostId))) throw E.notFound('Activity');
    if (a.hostId === me.id) throw E.conflict('IS_HOST', 'You are the host of this activity');
    if (a.visibility === 'invite_only') throw E.forbidden('INVITE_ONLY', 'This activity is invitation-only');

    const status = effectiveStatus(a);
    if (status === 'cancelled') throw E.conflict('ACTIVITY_CANCELLED', 'This activity was cancelled');
    if (['in_progress', 'completed', 'archived'].includes(status)) throw E.conflict('ACTIVITY_CLOSED', 'This activity has already started');
    // full: the person joins the waiting list (in order of asking) instead of being turned away
    const full = status === 'full' || (await this.goingCount(id)) >= a.capacity;
    const target = full ? 'waitlisted' : 'requested';

    this.limiter.hit(`activity-request:${me.id}`, 20, 24 * HOUR);

    const existing = await this.prisma.activityRequest.findUnique({
      where: { activityId_applicantId: { activityId: id, applicantId: me.id } },
    });
    if (existing) {
      if (existing.state === 'withdrawn') {
        this.limiter.hit(`activity-rerequest:${me.id}:${id}`, 3, 24 * HOUR); // asking again and again is spam
        const r = await this.prisma.activityRequest.update({
          where: { id: existing.id },
          data: { state: target, intro: dto.intro, decidedAt: null, reviewedBy: null, createdAt: new Date() },
        });
        if (!full) await this.notifyHost(a, me);
        return { id: r.id, state: r.state, position: full ? await this.waitlistPosition(id, r.createdAt) : undefined };
      }
      throw E.conflict('ALREADY_REQUESTED', `You already have a request (${existing.state}) for this activity`, {
        state: existing.state,
      });
    }

    const r = await this.prisma.activityRequest.create({
      data: { activityId: id, applicantId: me.id, intro: dto.intro, state: target },
    });
    if (!full) await this.notifyHost(a, me);
    return { id: r.id, state: r.state, position: full ? await this.waitlistPosition(id, r.createdAt) : undefined };
  }

  private async notifyHost(a: Activity, applicant: User) {
    const p = await this.prisma.profile.findUnique({ where: { userId: applicant.id } });
    await this.notifications.notify(a.hostId, 'join_request', 'A new join request', `${p?.displayName ?? 'Someone'} wants to join ${a.title}`, {
      activityId: a.id,
      applicantId: applicant.id,
    });
  }

  /** 1 = first in line. */
  private async waitlistPosition(activityId: string, createdAt: Date) {
    return this.prisma.activityRequest.count({ where: { activityId, state: 'waitlisted', createdAt: { lte: createdAt } } });
  }

  /**
   * A place opened up (someone left or was removed, or the host raised the limit): the first person on the waiting list
   * (the oldest request) is let in and told. Repeats while places remain. Skips anyone whose account is no longer active
   * or who the host has blocked.
   */
  async fillFromWaitlist(activityId: string) {
    for (let i = 0; i < 20; i++) {
      const a = await this.prisma.activity.findUnique({ where: { id: activityId } });
      if (!a || ['cancelled', 'archived'].includes(a.status) || ['in_progress', 'completed'].includes(effectiveStatus(a))) return;
      if ((await this.goingCount(activityId)) >= a.capacity) return;
      const waiting = await this.prisma.activityRequest.findMany({
        where: { activityId, state: 'waitlisted' },
        orderBy: { createdAt: 'asc' },
        take: 10,
        include: { applicant: { select: { state: true } } },
      });
      let next: (typeof waiting)[number] | undefined;
      for (const r of waiting) {
        if (r.applicant.state !== 'active') continue;
        if (await this.safety.isBlocked(a.hostId, r.applicantId)) continue;
        next = r;
        break;
      }
      if (!next) return;
      const who = next;
      await this.prisma.$transaction(async (tx) => {
        await tx.activityMembership.upsert({
          where: { activityId_userId: { activityId, userId: who.applicantId } },
          create: { activityId, userId: who.applicantId, role: 'attendee', state: 'approved' },
          update: { state: 'approved' },
        });
        await tx.activityRequest.update({ where: { id: who.id }, data: { state: 'approved', decidedAt: new Date() } });
        const total = await tx.activityMembership.count({ where: { activityId, state: 'approved' } });
        if (total >= a.capacity) await tx.activity.update({ where: { id: activityId }, data: { status: 'full' } });
      });
      await this.notifications.notify(who.applicantId, 'waitlist_promoted', "A place opened up. You're in!", `You moved off the waiting list and into ${a.title}. You can chat with the group now.`, { activityId });
      await this.audit.log(a.hostId, 'activity.waitlist_promoted', 'activity_request', who.id, { activityId, applicantId: who.applicantId });
    }
  }

  async withdraw(me: User, id: string) {
    const r = await this.prisma.activityRequest.findUnique({
      where: { activityId_applicantId: { activityId: id, applicantId: me.id } },
    });
    if (!r || !['requested', 'waitlisted'].includes(r.state)) throw E.notFound('Pending request');
    await this.prisma.activityRequest.update({ where: { id: r.id }, data: { state: 'withdrawn' } });
    const act = await this.prisma.activity.findUnique({ where: { id } });
    if (act) await this.notifications.settleRequest(act.hostId, 'join_request', { activityId: id }, me.id);
    return { ok: true };
  }

  async listRequests(me: User, id: string) {
    await this.expirePendingRequests(id);
    await this.hostOwned(me, id);
    const rows = await this.prisma.activityRequest.findMany({
      where: { activityId: id },
      orderBy: { createdAt: 'asc' },
      include: { applicant: { select: { id: true, eligibility: true, profile: true } } },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        state: r.state,
        intro: r.intro,
        createdAt: r.createdAt,
        applicant: {
          id: r.applicant.id,
          displayName: r.applicant.profile?.displayName,
          photoUrl: r.applicant.profile?.photoUrl ?? null,
          verifiedAdult: r.applicant.eligibility === 'verified',
          languages: r.applicant.profile?.languages ? r.applicant.profile.languages.split(',') : [],
          interests: r.applicant.profile?.interests ? r.applicant.profile.interests.split(',') : [],
        },
      })),
    };
  }

  async decide(me: User, activityId: string, requestId: string, body: unknown) {
    const { decision } = parse(decisionSchema, body);
    await this.expirePendingRequests(activityId);
    const a = await this.hostOwned(me, activityId);
    const r = await this.prisma.activityRequest.findFirst({ where: { id: requestId, activityId } });
    if (!r) throw E.notFound('Request');
    if (r.state === 'withdrawn') throw E.conflict('REQUEST_WITHDRAWN', 'The applicant withdrew this request');
    if (await this.safety.isBlocked(me.id, r.applicantId)) throw E.forbidden('BLOCKED', 'Blocked user');
    const applicant = await this.prisma.user.findUnique({ where: { id: r.applicantId } });
    if (!applicant || applicant.state !== 'active') throw E.conflict('APPLICANT_UNAVAILABLE', 'Applicant account is unavailable');

    if (decision === 'approve') {
      if (['cancelled', 'archived'].includes(a.status) || ['in_progress', 'completed'].includes(effectiveStatus(a)))
        throw E.conflict('ACTIVITY_CLOSED', 'This activity has already started, so nobody new can be approved');
      // capacity check + membership creation are atomic so two approvals cannot overfill
      await this.prisma.$transaction(async (tx) => {
        const already = await tx.activityMembership.findUnique({
          where: { activityId_userId: { activityId, userId: r.applicantId } },
        });
        const count = await tx.activityMembership.count({ where: { activityId, state: 'approved' } });
        if ((!already || already.state !== 'approved') && count >= a.capacity)
          throw E.conflict('ACTIVITY_FULL', 'This activity is full');
        await tx.activityMembership.upsert({
          where: { activityId_userId: { activityId, userId: r.applicantId } },
          create: { activityId, userId: r.applicantId, role: 'attendee', state: 'approved' },
          update: { state: 'approved' },
        });
        await tx.activityRequest.update({
          where: { id: r.id },
          data: { state: 'approved', reviewedBy: me.id, decidedAt: new Date() },
        });
        const total = (!already || already.state !== 'approved') ? count + 1 : count;
        if (total >= a.capacity) await tx.activity.update({ where: { id: activityId }, data: { status: 'full' } });
      });
      await this.notifications.notify(r.applicantId, 'request_approved', 'You are approved!', `You can now chat with the group for ${a.title}`, {
        activityId,
      });
    } else {
      // decline, including reversing an earlier approval (access is revoked immediately)
      await this.prisma.$transaction(async (tx) => {
        await tx.activityRequest.update({
          where: { id: r.id },
          data: { state: 'declined', reviewedBy: me.id, decidedAt: new Date() },
        });
        const m = await tx.activityMembership.findUnique({ where: { activityId_userId: { activityId, userId: r.applicantId } } });
        if (m && m.state === 'approved' && m.role !== 'host') {
          await tx.activityMembership.update({ where: { id: m.id }, data: { state: 'removed' } });
          if (a.status === 'full') await tx.activity.update({ where: { id: activityId }, data: { status: 'published' } });
        }
      });
      await this.notifications.notify(r.applicantId, 'request_declined', 'Request declined', `Your request for ${a.title} was not approved.`, {
        activityId,
      });
      await this.fillFromWaitlist(activityId); // a reversed approval frees a place too
    }
    await this.notifications.settleRequest(a.hostId, 'join_request', { activityId }, r.applicantId); // the host's "wants to join" alert is answered
    await this.audit.log(me.id, `activity.request.${decision}`, 'activity_request', r.id, { activityId, applicantId: r.applicantId });
    this.live.feedChanged(); // places left changed
    return { id: r.id, state: decision === 'approve' ? 'approved' : 'declined' };
  }

  // ---------------------------------------------------------------- membership exits
  async leave(me: User, id: string) {
    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a) throw E.notFound('Activity');
    if (a.hostId === me.id) throw E.conflict('HOST_CANNOT_LEAVE', 'Hosts must cancel the activity or transfer hosting');
    const m = await this.prisma.activityMembership.findUnique({ where: { activityId_userId: { activityId: id, userId: me.id } } });
    if (!m || m.state !== 'approved') throw E.notFound('Membership');
    await this.setMemberGone(a, m.id, 'withdrawn');
    await this.prisma.activityRequest.updateMany({
      where: { activityId: id, applicantId: me.id },
      data: { state: 'withdrawn' },
    });
    return { ok: true };
  }

  async removeMember(me: User, id: string, userId: string, byStaff = false) {
    const a = byStaff ? await this.prisma.activity.findUnique({ where: { id } }) : await this.hostOwned(me, id);
    if (!a) throw E.notFound('Activity');
    if (userId === a.hostId) throw E.conflict('CANNOT_REMOVE_HOST', 'The host cannot be removed');
    const m = await this.prisma.activityMembership.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
    if (!m || m.state !== 'approved') throw E.notFound('Membership');
    await this.setMemberGone(a, m.id, 'removed');
    await this.audit.log(me.id, 'activity.member_removed', 'activity', id, { userId, byStaff });
    await this.notifications.notify(userId, 'removed', 'Removed from activity', `You were removed from ${a.title}.`, { activityId: id });
    return { ok: true };
  }

  private async setMemberGone(a: Activity, membershipId: string, state: 'withdrawn' | 'removed') {
    await this.prisma.activityMembership.update({ where: { id: membershipId }, data: { state } });
    if (a.status === 'full') await this.prisma.activity.update({ where: { id: a.id }, data: { status: 'published' } });
    await this.fillFromWaitlist(a.id); // the first person waiting takes the place
    this.live.feedChanged();
  }

  // ---------------------------------------------------------------- changed plans, hand-over, attendance
  /** A member says they can still come after the host changed the time or place. (Not coming = leave.) */
  async reconfirm(me: User, id: string) {
    const m = await this.prisma.activityMembership.findUnique({ where: { activityId_userId: { activityId: id, userId: me.id } } });
    if (!m || m.state !== 'approved') throw E.notFound('Membership');
    if (m.reconfirm !== 'needed') return { ok: true };
    await this.prisma.activityMembership.update({ where: { id: m.id }, data: { reconfirm: 'confirmed' } });
    return { ok: true };
  }

  /** The host offers hosting to an approved member. Nothing changes until that member accepts. */
  async offerHandover(me: User, id: string, body: unknown) {
    const { userId } = parse(z.object({ userId: z.string().min(1) }), body);
    const a = await this.hostOwned(me, id);
    if (['cancelled', 'archived'].includes(a.status) || effectiveStatus(a) === 'completed')
      throw E.conflict('ACTIVITY_CLOSED', 'This activity can no longer change hands');
    if (userId === me.id) throw E.badRequest('VALIDATION_FAILED', 'Choose another member');
    const target = await this.prisma.activityMembership.findUnique({ where: { activityId_userId: { activityId: id, userId } }, include: { user: true } });
    if (!target || target.state !== 'approved') throw E.notFound('Member');
    if (target.user.eligibility !== 'verified') throw E.conflict('NOT_VERIFIED', 'Only a verified adult can take over hosting');
    if (await this.safety.isBlocked(me.id, userId)) throw E.notFound('Member');
    await this.prisma.activity.update({ where: { id }, data: { pendingHostId: userId } });
    await this.notifications.notify(userId, 'host_handover_offer', 'Take over hosting?', `The host of ${a.title} asked you to host it. Open the activity to accept or decline.`, { activityId: id });
    await this.audit.log(me.id, 'activity.handover_offered', 'activity', id, { userId });
    return { ok: true };
  }

  /** The host takes the offer back. */
  async withdrawHandover(me: User, id: string) {
    await this.hostOwned(me, id);
    await this.prisma.activity.update({ where: { id }, data: { pendingHostId: null } });
    return { ok: true };
  }

  /** The member who was offered hosting says yes (explicit acceptance) or no. */
  async answerHandover(me: User, id: string, body: unknown) {
    const { accept } = parse(z.object({ accept: z.boolean() }), body);
    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a) throw E.notFound('Activity');
    if (a.pendingHostId !== me.id) throw E.notFound('Offer');
    if (!accept) {
      await this.prisma.activity.update({ where: { id }, data: { pendingHostId: null } });
      await this.notifications.notify(a.hostId, 'host_handover_declined', 'Hosting not taken over', `They declined to host ${a.title}. You are still the host.`, { activityId: id });
      return { ok: true };
    }
    requireVerified(me);
    if (['cancelled', 'archived'].includes(a.status) || effectiveStatus(a) === 'completed') throw E.conflict('ACTIVITY_CLOSED', 'This activity can no longer change hands');
    const former = a.hostId;
    await this.prisma.$transaction(async (tx) => {
      await tx.activity.update({ where: { id }, data: { hostId: me.id, pendingHostId: null } });
      await tx.activityMembership.update({ where: { activityId_userId: { activityId: id, userId: me.id } }, data: { role: 'host', reconfirm: 'none' } });
      await tx.activityMembership.update({ where: { activityId_userId: { activityId: id, userId: former } }, data: { role: 'attendee' } });
    });
    await this.notifications.notify(former, 'host_handover_accepted', 'Hosting handed over', `Someone else now hosts ${a.title}. You are an attendee, and you can leave if you wish.`, { activityId: id });
    await this.audit.log(me.id, 'activity.handover_accepted', 'activity', id, { from: former });
    return { ok: true };
  }

  /**
   * Voluntary and private to the member: after the activity ends, each person may say whether they were there. There
   * is no location tracking and nobody can set it for someone else. Allowed for a week after it ends.
   */
  async confirmAttendance(me: User, id: string, body: unknown) {
    const { attended } = parse(z.object({ attended: z.boolean() }), body);
    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a) throw E.notFound('Activity');
    if (a.status === 'cancelled') throw E.conflict('ACTIVITY_CANCELLED', 'This activity was cancelled');
    const now = Date.now();
    if (now < +a.endsAt) throw E.conflict('NOT_FINISHED', 'You can say whether you were there once it has ended');
    if (now > +a.endsAt + 7 * 24 * HOUR) throw E.conflict('ATTENDANCE_CLOSED', 'This is too long ago to confirm');
    const m = await this.prisma.activityMembership.findUnique({ where: { activityId_userId: { activityId: id, userId: me.id } } });
    if (!m || m.state !== 'approved') throw E.notFound('Membership');
    await this.prisma.activityMembership.update({ where: { id: m.id }, data: { attendance: attended ? 'attended' : 'no_show' } });
    return { ok: true, attendance: attended ? 'attended' : 'no_show' };
  }

  // ---------------------------------------------------------------- favorites & "mine"
  async favorite(me: User, id: string, on: boolean) {
    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a) throw E.notFound('Activity');
    if (on) {
      await this.prisma.favorite.upsert({
        where: { userId_activityId: { userId: me.id, activityId: id } },
        create: { userId: me.id, activityId: id },
        update: {},
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId: me.id, activityId: id } });
    }
    return { favorited: on };
  }

  async myFavorites(me: User) {
    const favs = await this.prisma.favorite.findMany({
      where: { userId: me.id, activity: { status: { not: 'cancelled' } } },
      include: { activity: { include: this.hostInclude } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: await Promise.all(favs.map(async (f) => this.dto(f.activity, await this.goingCount(f.activityId), { favorited: true }))),
    };
  }

  async mine(me: User) {
    await this.expirePendingRequests();
    const [memberships, requests] = await Promise.all([
      this.prisma.activityMembership.findMany({
        where: { userId: me.id, state: 'approved' },
        include: { activity: { include: this.hostInclude } },
        orderBy: { activity: { startsAt: 'desc' } },
      }),
      this.prisma.activityRequest.findMany({
        where: { applicantId: me.id, state: { in: ['requested', 'waitlisted', 'declined'] } },
        include: { activity: { include: this.hostInclude } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      joined: await Promise.all(
        memberships.map(async (m) => this.dto(m.activity, await this.goingCount(m.activityId), { role: m.role })),
      ),
      requests: await Promise.all(
        requests.map(async (r) => ({
          requestId: r.id,
          state: r.state,
          activity: this.dto(r.activity, await this.goingCount(r.activityId)),
        })),
      ),
    };
  }
}
