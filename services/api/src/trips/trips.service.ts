import { Injectable } from '@nestjs/common';
import { Prisma, Trip, User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { requireVerified } from '../common/auth';
import { decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { circleOf, crowd, tierCounts } from '../common/social';
import { ReliabilityService } from '../reliability/reliability.controller';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { LiveService } from '../common/live.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SafetyService } from '../safety/safety.service';

const DAY = 24 * 3600 * 1000;

export const BUDGET_DISCLAIMER =
  'Budgets are estimates, not quotes or booking offers. Trips are proposals - book travel suppliers independently and never send money to strangers.';

const FLEX = ['exact', 'plus_minus_1', 'plus_minus_3', 'plus_minus_7', 'same_month'] as const;
type Flex = (typeof FLEX)[number];

/** Spec 6.5: organizer counts as one member; default 4-6, optional 2-3 and 7-10. */
const GROUP_RANGES: Record<string, [number, number]> = { '2-3': [2, 3], '4-6': [4, 6], '7-10': [7, 10], '10+': [10, 20] };

export const createSchema = z
  .object({
    title: z.string().trim().min(2).max(80).optional(),
    destination: z.string().trim().min(2).max(100),
    destinationPlaceId: z.string().max(200).optional(),
    originCity: z.string().trim().min(2).max(60),
    dateStart: z.coerce.date(),
    dateEnd: z.coerce.date(),
    dateFlexibility: z.enum(FLEX).default('exact'),
    budgetCurrency: z.string().length(3).toUpperCase().default('EUR'),
    budgetMin: z.number().int().min(0).max(1_000_000),
    budgetMax: z.number().int().min(0).max(1_000_000),
    budgetIncludesTransport: z.boolean(),
    tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
    description: z.string().trim().max(2000).optional(),
    groupSize: z.enum(['2-3', '4-6', '7-10', '10+']).default('4-6'),
    visibility: z.enum(['public', 'invite_only']).default('public'),
  })
  .refine((d) => d.budgetMax > d.budgetMin, { message: 'The maximum budget must be higher than the minimum', path: ['budgetMax'] });

export const updateSchema = z.object({
  description: z.string().trim().max(2000).optional(),
  dateStart: z.coerce.date().optional(),
  dateEnd: z.coerce.date().optional(),
  dateFlexibility: z.enum(FLEX).optional(),
  destination: z.string().trim().min(2).max(100).optional(),
});

export const searchSchema = z.object({
  destination: z.string().trim().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  flexibility: z.enum(FLEX).default('exact'),
  originCity: z.string().trim().optional(),
  budgetMax: z.coerce.number().int().min(0).optional(),
  includesTransport: z.enum(['true', 'false']).optional(),
  tags: z.string().optional(), // comma separated
  groupSize: z.enum(['2-3', '4-6', '7-10', '10+']).optional(),
  openOnly: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const applySchema = z.object({
  intro: z.string().trim().min(10).max(1000),
  experience: z.enum(['beginner', 'intermediate', 'experienced']).optional(),
  confirmBudget: z.literal(true, { error: 'Confirm your budget is compatible' }),
  confirmDates: z.literal(true, { error: 'Confirm you can travel within the date window' }),
  confirmGuidelines: z.literal(true, { error: 'Agree to the group guidelines' }),
});
export const decisionSchema = z.object({ decision: z.enum(['approve', 'decline']) });

/** Trips are planned at most six months ahead: up to the last day of the month that far from now. */
function planningHorizon(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() + 7, 0, 23, 59, 59);
}

function flexDays(f: Flex) {
  return f === 'plus_minus_1' ? 1 : f === 'plus_minus_3' ? 3 : f === 'plus_minus_7' ? 7 : 0;
}

/** [start,end] a trip could plausibly cover once flexibility is applied. */
function expandedRange(start: Date, end: Date, f: Flex): [number, number] {
  if (f === 'same_month') {
    const s = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
    const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0, 23, 59, 59);
    return [s, e];
  }
  return [+start - flexDays(f) * DAY, +end + flexDays(f) * DAY];
}

const overlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1];

@Injectable()
export class TripsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly live: LiveService,
      private readonly reliability: ReliabilityService,
  ) {}

  private readonly hostInclude = {
    host: { select: { id: true, eligibility: true, profile: { select: { displayName: true, photoUrl: true } } } },
  } as const;

  private dto(t: Trip & { host: { id: string; eligibility: string; profile: { displayName: string; photoUrl: string | null } | null } }, members: number, extra: Record<string, unknown> = {}) {
    return {
      id: t.id,
      title: t.title,
      destination: t.destination,
      originCity: t.originCity,
      dateStart: t.dateStart,
      dateEnd: t.dateEnd,
      dateFlexibility: t.dateFlexibility,
      // tentative until the organizer puts final dates to the group; "proposed" means every member must still confirm
      datesState: t.datesState,
      // budget semantics (spec 6.3): always an estimate, always with its scope
      budget: {
        label: 'Estimated personal budget',
        currency: t.budgetCurrency,
        min: t.budgetMin,
        max: t.budgetMax,
        includesTransport: t.budgetIncludesTransport,
        scope: t.budgetIncludesTransport ? 'Total including travel to the destination' : 'Destination spend, excluding travel to the destination',
      },
      tags: t.tags ? t.tags.split(',') : [],
      description: t.description,
      minCapacity: t.minCapacity,
      maxCapacity: t.maxCapacity,
      members,
      spotsLeft: Math.max(0, t.maxCapacity - members),
      status: t.status,
      kind: 'trip_proposal', // proposal, not a booking or confirmed itinerary
      disclaimer: BUDGET_DISCLAIMER,
      host: { id: t.host.id, displayName: t.host.profile?.displayName ?? 'Organizer', photoUrl: t.host.profile?.photoUrl ?? null, verifiedAdult: t.host.eligibility === 'verified' },
      ...extra,
    };
  }

  private memberCount(tripId: string) {
    return this.prisma.tripMembership.count({ where: { tripId, state: 'approved' } });
  }

  // ---------------------------------------------------------------- discovery
  async search(me: User, query: unknown) {
    const q = parse(searchSchema, query);
    const blocked = await this.safety.blockedWith(me.id);
    const now = new Date();

    const where: Prisma.TripWhereInput = {
      status: { in: q.openOnly === 'true' ? ['published'] : ['published', 'full', 'planning'] },
      dateEnd: { gte: now },
      hostId: { notIn: blocked },
      OR: [{ visibility: 'public' }, { hostId: me.id }, { memberships: { some: { userId: me.id, state: 'approved' } } }],
      ...(q.destination && { destinationKey: { contains: q.destination.toLowerCase() } }),
    };
    const rows = await this.prisma.trip.findMany({
      where,
      orderBy: { dateStart: 'asc' },
      take: 500,
      include: { ...this.hostInclude, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });

    // the viewer's circle: where their buddies (most) and the people they follow (less) are going ranks higher
    const circle = await circleOf(this.prisma, me.id);
    const everyone = [...circle.buddies, ...circle.following];
    const peopleByTrip = new Map<string, string[]>();
    if (everyone.length > 0) {
      const there = await this.prisma.tripMembership.findMany({
        where: { tripId: { in: rows.map((t) => t.id) }, state: 'approved', userId: { in: everyone } },
        select: { tripId: true, userId: true },
      });
      for (const m of there) peopleByTrip.set(m.tripId, [...(peopleByTrip.get(m.tripId) ?? []), m.userId]);
      for (const t of rows) if (circle.buddies.has(t.hostId) || circle.following.has(t.hostId)) peopleByTrip.set(t.id, [...(peopleByTrip.get(t.id) ?? []), t.hostId]);
    }

    const wantTags = q.tags ? q.tags.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const window: [number, number] | null = q.from ? [+q.from, +(q.to ?? q.from)] : null;
    const userWindow = window ? expandedRange(new Date(window[0]), new Date(window[1]), q.flexibility) : null;

    const scored = rows
      .map((t) => {
        // date overlap: "exact" = nominal ranges overlap; "approximate" = only overlap after flexibility
        let dateMatch: 'exact' | 'approximate' | 'none' | 'unspecified' = 'unspecified';
        if (window) {
          const nominal: [number, number] = [+t.dateStart, +t.dateEnd];
          const tripFlex = expandedRange(t.dateStart, t.dateEnd, t.dateFlexibility as Flex);
          if (overlaps(nominal, window)) dateMatch = 'exact';
          else if (overlaps(tripFlex, userWindow!) || overlaps(nominal, userWindow!)) dateMatch = 'approximate';
          else dateMatch = 'none';
        }
        if (dateMatch === 'none') return null;

        if (q.budgetMax !== undefined && t.budgetMin > q.budgetMax) return null;
        if (q.groupSize) {
          const [lo, hi] = GROUP_RANGES[q.groupSize];
          if (t.maxCapacity < lo || t.minCapacity > hi) return null;
        }
        const tags = t.tags ? t.tags.split(',') : [];
        if (wantTags.length && !wantTags.some((w) => tags.includes(w))) return null;

        const budgetScopeMismatch =
          q.includesTransport !== undefined && (q.includesTransport === 'true') !== t.budgetIncludesTransport;
        const members = t._count.memberships;

        // illustrative ranking weights from spec 7.4 (hypothesis, not a validated model)
        let score = 0;
        score += q.destination ? 35 : 20;
        score += dateMatch === 'exact' ? 25 : dateMatch === 'approximate' ? 12 : 12;
        score += wantTags.length ? (15 * wantTags.filter((w) => tags.includes(w)).length) / wantTags.length : 8;
        score += q.budgetMax === undefined ? 8 : budgetScopeMismatch ? 7 : 15;
        score += t.maxCapacity - members > 0 ? 10 : 0;
        if (q.originCity && t.originCity.toLowerCase() === q.originCity.toLowerCase()) score += 3; // preference, never exclusion
        // the circle: buddies going is the biggest boost (up to +30), people you follow a smaller one (up to +10); everyone
        // else, including people who only follow you, adds nothing
        const tiers = tierCounts(peopleByTrip.get(t.id) ?? [], circle);
        score += 30 * crowd(tiers.buddies) + 10 * crowd(tiers.following);

        return {
          score,
          item: this.dto(t, members, {
            match: { dates: dateMatch, budgetScopeMismatch, score: Math.round(score) },
            groupOpen: t.status !== 'full' && t.maxCapacity - members > 0,
            buddiesGoing: tiers.buddies,
            followingGoing: tiers.following,
          }),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.score - a.score);

    const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw E.badRequest('INVALID_CURSOR', 'Invalid cursor');
    const page = scored.slice(offset, offset + q.limit);
    return {
      total: scored.length,
      items: page.map((x) => x.item),
      nextCursor: offset + q.limit < scored.length ? Buffer.from(String(offset + q.limit)).toString('base64url') : null,
    };
  }

  async detail(me: User, id: string) {
    const t = await this.prisma.trip.findUnique({ where: { id }, include: this.hostInclude });
    if (!t || (await this.safety.isBlocked(me.id, t.hostId))) throw E.notFound('Trip');
    const m = await this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId: id, userId: me.id } } });
    const isMember = m?.state === 'approved';
    if (t.visibility === 'invite_only' && !isMember && t.hostId !== me.id) throw E.notFound('Trip');

    const [members, app, conv] = await Promise.all([
      this.prisma.tripMembership.findMany({
        where: { tripId: id, state: 'approved' },
        include: { user: { select: { id: true, eligibility: true, profile: { select: { displayName: true, photoUrl: true } } } } },
      }),
      this.prisma.tripApplication.findUnique({ where: { tripId_applicantId: { tripId: id, applicantId: me.id } } }),
      isMember ? this.prisma.conversation.findUnique({ where: { tripId: id } }) : null,
    ]);
    return this.dto(t, members.length, {
      isHost: t.hostId === me.id,
      isMember,
      myApplication: app && {
        id: app.id,
        state: app.state,
        // explicit copy per state (T-US03)
        message: {
          pending: 'Pending organizer review',
          approved: 'Approved - welcome to the group',
          declined: 'Not approved this time',
          waitlisted: 'You are on the waitlist',
          withdrawn: 'You withdrew your application',
          expired: 'This application expired',
        }[app.state],
      },
      conversationId: conv?.id ?? null,
      datesConfirmedCount: t.datesState === 'proposed' ? members.filter((x) => x.datesConfirmed).length : undefined,
      myDatesConfirmed: isMember ? !!members.find((x) => x.userId === me.id)?.datesConfirmed : undefined,
      participants: members.map((x) => ({
        id: x.user.id,
        displayName: x.user.profile?.displayName ?? 'Member',
        photoUrl: x.user.profile?.photoUrl ?? null,
        verifiedAdult: x.user.eligibility === 'verified',
        role: x.role,
      })),
    });
  }

  // ---------------------------------------------------------------- creation
  async create(me: User, body: unknown) {
    requireVerified(me);
    const dto = parse(createSchema, body);
    const now = new Date();
    if (dto.dateStart <= now) throw E.badRequest('INVALID_DATES', 'Trip must start in the future');
    if (dto.dateEnd < dto.dateStart) throw E.badRequest('INVALID_DATES', 'End date must not be before start date');
    if ((+dto.dateEnd - +dto.dateStart) / DAY > 90) throw E.badRequest('INVALID_DATES', 'Trips can span at most 90 days');
    if (dto.dateStart > planningHorizon() || dto.dateEnd > planningHorizon()) throw E.badRequest('INVALID_DATES', 'Trips can only be planned up to six months ahead');
    for (const t of [dto.title, dto.description, dto.destination]) {
      const bad = contentProblem(t);
      if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    }
    this.limiter.hit(`trip-create:${me.id}`, 5, 24 * 3600 * 1000);

    const [minCapacity, maxCapacity] = GROUP_RANGES[dto.groupSize];
    const trip = await this.prisma.$transaction(async (tx) => {
      const t = await tx.trip.create({
        data: {
          hostId: me.id,
          title: dto.title ?? `Trip to ${dto.destination}`,
          destination: dto.destination,
          destinationKey: dto.destination.toLowerCase(),
          destinationPlaceId: dto.destinationPlaceId,
          originCity: dto.originCity,
          dateStart: dto.dateStart,
          dateEnd: dto.dateEnd,
          dateFlexibility: dto.dateFlexibility,
          budgetCurrency: dto.budgetCurrency,
          budgetMin: dto.budgetMin,
          budgetMax: dto.budgetMax,
          budgetIncludesTransport: dto.budgetIncludesTransport,
          tags: dto.tags.join(','),
          description: dto.description,
          minCapacity,
          maxCapacity,
          visibility: dto.visibility,
          status: 'published',
        },
      });
      await tx.tripMembership.create({ data: { tripId: t.id, userId: me.id, role: 'organizer' } });
      await tx.conversation.create({ data: { scopeType: 'trip', tripId: t.id } });
      return t;
    });
    await this.audit.log(me.id, 'trip.create', 'trip', trip.id);
    this.live.feedChanged();
    return this.detail(me, trip.id);
  }

  private async hostOwned(me: User, id: string) {
    const t = await this.prisma.trip.findUnique({ where: { id } });
    if (!t) throw E.notFound('Trip');
    if (t.hostId !== me.id) throw E.forbidden('NOT_ORGANIZER', 'Only the organizer can do this');
    return t;
  }

  private async memberIds(tripId: string, except?: string) {
    const m = await this.prisma.tripMembership.findMany({
      where: { tripId, state: 'approved', ...(except && { userId: { not: except } }) },
    });
    return m.map((x) => x.userId);
  }

  async update(me: User, id: string, body: unknown) {
    const t = await this.hostOwned(me, id);
    if (['cancelled', 'completed'].includes(t.status)) throw E.conflict('TRIP_CLOSED', 'This trip can no longer be edited');
    const dto = parse(updateSchema, body);
    const bad = contentProblem(dto.description);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    const dateStart = dto.dateStart ?? t.dateStart;
    const dateEnd = dto.dateEnd ?? t.dateEnd;
    if (dateStart <= new Date() || dateEnd < dateStart) throw E.badRequest('INVALID_DATES', 'Invalid dates');
    if ((dto.dateStart || dto.dateEnd) && (dateStart > planningHorizon() || dateEnd > planningHorizon())) throw E.badRequest('INVALID_DATES', 'Trips can only be planned up to six months ahead');

    await this.prisma.trip.update({
      where: { id },
      data: {
        dateStart,
        dateEnd,
        ...(dto.dateFlexibility && { dateFlexibility: dto.dateFlexibility }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.destination && { destination: dto.destination, destinationKey: dto.destination.toLowerCase() }),
      },
    });

    // dates/destination are material changes: all approved members hear about it (spec 7.3)
    const material = +dateStart !== +t.dateStart || +dateEnd !== +t.dateEnd || (dto.destination && dto.destination !== t.destination);
    if (material) {
      await this.notifications.notifyMany(
        await this.memberIds(id, me.id),
        'trip_changed',
        `Trip updated: ${t.title}`,
        'The organizer changed the dates or destination. Please review and re-confirm.',
        { tripId: id },
      );
      await this.audit.log(me.id, 'trip.material_change', 'trip', id);
      this.live.feedChanged();
      // dates the group had already been asked to confirm have changed under them: ask everyone again
      if (t.datesState === 'proposed' && (+dateStart !== +t.dateStart || +dateEnd !== +t.dateEnd)) {
        await this.prisma.tripMembership.updateMany({ where: { tripId: id, state: 'approved', userId: { not: me.id } }, data: { datesConfirmed: false } });
      }
    }
    return this.detail(me, id);
  }

  async cancel(me: User, id: string, byStaff = false) {
    const t = byStaff ? await this.prisma.trip.findUnique({ where: { id } }) : await this.hostOwned(me, id);
    if (!t) throw E.notFound('Trip');
    if (t.status === 'cancelled') return { ok: true };
    await this.prisma.trip.update({ where: { id }, data: { status: 'cancelled', ...(byStaff ? {} : { cancelledAt: new Date() }) } });
    const pendingApps = await this.prisma.tripApplication.findMany({ where: { tripId: id, state: 'pending' }, select: { applicantId: true } });
    await this.prisma.tripApplication.updateMany({ where: { tripId: id, state: 'pending' }, data: { state: 'declined', decidedAt: new Date() } });
    for (const x of pendingApps) await this.notifications.settleRequest(t.hostId, 'trip_application', { tripId: id }, x.applicantId);
    await this.notifications.notifyMany(await this.memberIds(id, byStaff ? undefined : me.id), 'trip_cancelled', `Cancelled: ${t.title}`, 'This trip proposal was cancelled.', { tripId: id });
    await this.audit.log(me.id, byStaff ? 'trip.removed_by_staff' : 'trip.cancel', 'trip', id);
    this.live.feedChanged();
    return { ok: true };
  }

  // ---------------------------------------------------------------- applications
  async apply(me: User, id: string, body: unknown) {
    requireVerified(me);
    const dto = parse(applySchema, body);
    const bad = contentProblem(dto.intro);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);

    const t = await this.prisma.trip.findUnique({ where: { id } });
    if (!t || (await this.safety.isBlocked(me.id, t.hostId))) throw E.notFound('Trip');
    if (t.hostId === me.id) throw E.conflict('IS_ORGANIZER', 'You are the organizer of this trip');
    if (t.visibility === 'invite_only') throw E.forbidden('INVITE_ONLY', 'This trip is invitation-only');
    if (['cancelled', 'completed'].includes(t.status)) throw E.conflict('TRIP_CLOSED', 'This trip is closed');
    if (t.status === 'full' || (await this.memberCount(id)) >= t.maxCapacity) throw E.conflict('TRIP_FULL', 'This group is full');

    this.limiter.hit(`trip-apply:${me.id}`, 20, 24 * 3600 * 1000);

    const existing = await this.prisma.tripApplication.findUnique({
      where: { tripId_applicantId: { tripId: id, applicantId: me.id } },
    });
    let app;
    if (existing) {
      if (existing.state !== 'withdrawn' && existing.state !== 'expired')
        throw E.conflict('ALREADY_APPLIED', `You already have an application (${existing.state})`, { state: existing.state });
      app = await this.prisma.tripApplication.update({
        where: { id: existing.id },
        data: { state: 'pending', intro: dto.intro, experience: dto.experience, decidedAt: null, reviewedBy: null },
      });
    } else {
      app = await this.prisma.tripApplication.create({
        data: { tripId: id, applicantId: me.id, intro: dto.intro, experience: dto.experience },
      });
    }
    const p = await this.prisma.profile.findUnique({ where: { userId: me.id } });
    await this.notifications.notify(t.hostId, 'trip_application', 'New trip application', `${p?.displayName ?? 'Someone'} applied to ${t.title}`, { tripId: id, applicantId: me.id });
    return { id: app.id, state: app.state };
  }

  async withdraw(me: User, id: string) {
    const a = await this.prisma.tripApplication.findUnique({ where: { tripId_applicantId: { tripId: id, applicantId: me.id } } });
    if (!a || a.state !== 'pending') throw E.notFound('Pending application');
    await this.prisma.tripApplication.update({ where: { id: a.id }, data: { state: 'withdrawn' } });
    const trip = await this.prisma.trip.findUnique({ where: { id } });
    if (trip) await this.notifications.settleRequest(trip.hostId, 'trip_application', { tripId: id }, me.id);
    return { ok: true };
  }

  async listApplications(me: User, id: string) {
    await this.hostOwned(me, id);
    const rows = await this.prisma.tripApplication.findMany({
      where: { tripId: id },
      orderBy: { createdAt: 'asc' },
      include: { applicant: { select: { id: true, eligibility: true, profile: true } } },
    });
    const levels = await this.reliability.forViewer(me, rows.map((a) => a.applicantId));
    return {
      items: rows.map((a) => ({
        id: a.id,
        state: a.state,
        intro: a.intro,
        experience: a.experience,
        createdAt: a.createdAt,
        applicant: {
          id: a.applicant.id,
          displayName: a.applicant.profile?.displayName,
          photoUrl: a.applicant.profile?.photoUrl ?? null,
          verifiedAdult: a.applicant.eligibility === 'verified', // organizer sees the badge, never documents
          reliability: levels.get(a.applicantId) ?? null,
          languages: a.applicant.profile?.languages ? a.applicant.profile.languages.split(',') : [],
          interests: a.applicant.profile?.interests ? a.applicant.profile.interests.split(',') : [],
        },
      })),
    };
  }

  async decide(me: User, tripId: string, applicationId: string, body: unknown) {
    const { decision } = parse(decisionSchema, body);
    const t = await this.hostOwned(me, tripId);
    const a = await this.prisma.tripApplication.findFirst({ where: { id: applicationId, tripId } });
    if (!a) throw E.notFound('Application');
    if (a.state === 'withdrawn') throw E.conflict('APPLICATION_WITHDRAWN', 'The applicant withdrew');
    if (await this.safety.isBlocked(me.id, a.applicantId)) throw E.forbidden('BLOCKED', 'Blocked user');
    const applicant = await this.prisma.user.findUnique({ where: { id: a.applicantId } });
    if (!applicant || applicant.state !== 'active') throw E.conflict('APPLICANT_UNAVAILABLE', 'Applicant account is unavailable');

    if (decision === 'approve') {
      if (['cancelled', 'completed'].includes(t.status)) throw E.conflict('TRIP_CLOSED', 'This trip is closed');
      await this.prisma.$transaction(async (tx) => {
        const already = await tx.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: a.applicantId } } });
        const count = await tx.tripMembership.count({ where: { tripId, state: 'approved' } });
        const isNew = !already || already.state !== 'approved';
        if (isNew && count >= t.maxCapacity) throw E.conflict('TRIP_FULL', 'This group is full');
        await tx.tripMembership.upsert({
          where: { tripId_userId: { tripId, userId: a.applicantId } },
          create: { tripId, userId: a.applicantId, role: 'member', state: 'approved' },
          update: { state: 'approved' },
        });
        await tx.tripApplication.update({ where: { id: a.id }, data: { state: 'approved', reviewedBy: me.id, decidedAt: new Date() } });
        const total = isNew ? count + 1 : count;
        if (total >= t.maxCapacity) await tx.trip.update({ where: { id: tripId }, data: { status: 'full' } });
        else if (total >= t.minCapacity && t.status === 'published') await tx.trip.update({ where: { id: tripId }, data: { status: 'planning' } });
      });
      await this.notifications.notify(a.applicantId, 'application_approved', 'You are in!', `You can now plan ${t.title} with the group`, { tripId });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await tx.tripApplication.update({ where: { id: a.id }, data: { state: 'declined', reviewedBy: me.id, decidedAt: new Date() } });
        const m = await tx.tripMembership.findUnique({ where: { tripId_userId: { tripId, userId: a.applicantId } } });
        if (m && m.state === 'approved' && m.role !== 'organizer') {
          await tx.tripMembership.update({ where: { id: m.id }, data: { state: 'removed' } });
          if (t.status === 'full') await tx.trip.update({ where: { id: tripId }, data: { status: 'published' } });
        }
      });
      await this.notifications.notify(a.applicantId, 'application_declined', 'Application not approved', `Your application for ${t.title} was not approved.`, { tripId });
    }
    await this.notifications.settleRequest(t.hostId, 'trip_application', { tripId }, a.applicantId); // the organizer's "applied" alert is answered
    await this.audit.log(me.id, `trip.application.${decision}`, 'trip_application', a.id, { tripId, applicantId: a.applicantId });
    this.live.feedChanged();
    return { id: a.id, state: decision === 'approve' ? 'approved' : 'declined' };
  }

  // ---------------------------------------------------------------- exits
  /** Members can leave without organizer permission (spec 7.3). */
  async leave(me: User, id: string) {
    const t = await this.prisma.trip.findUnique({ where: { id } });
    if (!t) throw E.notFound('Trip');
    if (t.hostId === me.id) throw E.conflict('ORGANIZER_CANNOT_LEAVE', 'Organizers must cancel the trip or hand it over');
    const m = await this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId: id, userId: me.id } } });
    if (!m || m.state !== 'approved') throw E.notFound('Membership');
    await this.prisma.tripMembership.update({ where: { id: m.id }, data: { state: 'left', leftAt: new Date() } });
    await this.prisma.tripApplication.updateMany({ where: { tripId: id, applicantId: me.id }, data: { state: 'withdrawn' } });
    if (t.status === 'full') await this.prisma.trip.update({ where: { id }, data: { status: 'published' } });
    await this.audit.log(me.id, 'trip.member_left', 'trip', id);
    this.live.feedChanged();
    return { ok: true };
  }

  async removeMember(me: User, id: string, userId: string, byStaff = false) {
    const t = byStaff ? await this.prisma.trip.findUnique({ where: { id } }) : await this.hostOwned(me, id);
    if (!t) throw E.notFound('Trip');
    if (userId === t.hostId) throw E.conflict('CANNOT_REMOVE_ORGANIZER', 'The organizer cannot be removed');
    const m = await this.prisma.tripMembership.findUnique({ where: { tripId_userId: { tripId: id, userId } } });
    if (!m || m.state !== 'approved') throw E.notFound('Membership');
    await this.prisma.tripMembership.update({ where: { id: m.id }, data: { state: 'removed' } });
    if (t.status === 'full') await this.prisma.trip.update({ where: { id }, data: { status: 'published' } });
    await this.audit.log(me.id, 'trip.member_removed', 'trip', id, { userId, byStaff });
    this.live.feedChanged();
    await this.notifications.notify(userId, 'removed', 'Removed from trip', `You were removed from ${t.title}.`, { tripId: id });
    return { ok: true };
  }

  async mine(me: User) {
    const [memberships, apps] = await Promise.all([
      this.prisma.tripMembership.findMany({
        where: { userId: me.id, state: 'approved' },
        include: { trip: { include: this.hostInclude } },
        orderBy: { trip: { dateStart: 'asc' } },
      }),
      this.prisma.tripApplication.findMany({
        where: { applicantId: me.id, state: { in: ['pending', 'declined', 'waitlisted'] } },
        include: { trip: { include: this.hostInclude } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      joined: await Promise.all(memberships.map(async (m) => this.dto(m.trip, await this.memberCount(m.tripId), { role: m.role }))),
      applications: await Promise.all(
        apps.map(async (a) => ({ applicationId: a.id, state: a.state, trip: this.dto(a.trip, await this.memberCount(a.tripId)) })),
      ),
    };
  }

  /**
   * Your trips a page at a time, soonest departure first: the ones you organise or are in (`row: joined`) and the ones you
   * applied to that are pending, waitlisted or declined (`row: application`). `upcoming=1` keeps only what is still ahead
   * (not cancelled or over, and no declined applications): what the THERE home shows as your next trip.
   * `counts` is the number of each kind, for the profile figures.
   */
  async minePage(me: User, limitRaw?: string, cursorRaw?: string, upcoming?: string) {
    const limit = pageLimit(limitRaw, 20);
    const cur = decodeKeyset(cursorRaw);
    const ahead = upcoming === '1' || upcoming === 'true';
    const tripWhere = ahead ? { status: { notIn: ['cancelled', 'completed'] }, dateEnd: { gt: new Date() } } : {};
    const after = cur ? { OR: [{ trip: { dateStart: { gt: cur.at } } }, { trip: { dateStart: cur.at }, id: { gt: cur.id } }] } : {};
    const order = [{ trip: { dateStart: 'asc' as const } }, { id: 'asc' as const }];
    const memberBase = { userId: me.id, state: 'approved' };
    const appStates = ahead ? ['pending', 'waitlisted'] : ['pending', 'declined', 'waitlisted'];

    const [m, a, joined, applications] = await Promise.all([
      this.prisma.tripMembership.findMany({ where: { ...memberBase, trip: tripWhere, ...after }, include: { trip: { include: this.hostInclude } }, orderBy: order, take: limit + 1 }),
      this.prisma.tripApplication.findMany({ where: { applicantId: me.id, state: { in: appStates }, trip: tripWhere, ...after }, include: { trip: { include: this.hostInclude } }, orderBy: order, take: limit + 1 }),
      this.prisma.tripMembership.count({ where: memberBase }),
      this.prisma.tripApplication.count({ where: { applicantId: me.id, state: { in: ['pending', 'declined', 'waitlisted'] } } }),
    ]);
    const merged = [
      ...m.map((row) => ({ id: row.id, at: row.trip.dateStart, member: row, app: null })),
      ...a.map((row) => ({ id: row.id, at: row.trip.dateStart, member: null, app: row })),
    ].sort((x, y) => +x.at - +y.at || (x.id < y.id ? -1 : 1));
    const page = sliceKeyset(merged, limit, (x) => x.at);
    return {
      items: await Promise.all(
        page.items.map(async (x) =>
          x.member
            ? { ...this.dto(x.member.trip, await this.memberCount(x.member.tripId), { role: x.member.role }), row: 'joined' as const }
            : { row: 'application' as const, applicationId: x.app!.id, state: x.app!.state, trip: this.dto(x.app!.trip, await this.memberCount(x.app!.tripId)) },
        ),
      ),
      nextCursor: page.nextCursor,
      counts: { joined, applications },
    };
  }
}
