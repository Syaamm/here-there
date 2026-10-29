import { decryptField, maskPhone } from '../common/vault';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Staff } from '../common/auth';
import { STAFF_ROLES } from '../common/constants';
import { E } from '../common/errors';
import { afterKeyset, beforeKeyset, decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { banIdentities, liftBans } from '../common/identity';
import { ModerationService } from '../moderation/moderation.controller';
import { MfaService } from '../auth/mfa.controller';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { TripsService } from '../trips/trips.service';
import { VerificationService } from '../verification/verification.service';

const ALL = [...STAFF_ROLES];const MOD = ['moderator', 'trust_lead', 'admin'];
const TRUST = ['trust_lead', 'admin'];

export const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
// days: how long the suspension lasts; leave it out for "until staff restore the account"
export const suspendSchema = reasonSchema.extend({ days: z.number().int().min(1).max(365).optional() });
export const verificationDecisionSchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  reason: z.enum(['document', 'liveness', 'underage', 'other']).optional(), // when rejecting
});
export const noteSchema = z.object({ note: z.string().trim().min(3).max(500) });
// Why a verified person must verify again. Expiry is automatic; these are the staff-triggered cases.
export const reverifySchema = z.object({
  reason: z.enum(['security', 'fraud_suspected', 'other']),
  note: z.string().trim().min(3).max(500),
});
export const resolveSchema = z.object({
  status: z.enum(['resolved', 'dismissed', 'in_review']),
  resolution: z.string().trim().max(1000).optional(),
});
export const roleSchema = z.object({ role: z.enum(['user', ...STAFF_ROLES]) });

/** Internal operations console API (spec 12). Every mutating action writes an audit event. */
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly verification: VerificationService,
    private readonly activities: ActivitiesService,
    private readonly trips: TripsService,
    private readonly mfa: MfaService,
    private readonly moderation: ModerationService,
  ) {}

  // ------------------------------------------------------------ overview
  @Staff(...ALL)
  @Get('overview')
  async overview() {
    // the last 30 days (today included) and the 30 before them, as whole UTC days
    const DAY = 24 * 3600 * 1000;
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const from = new Date(+today - 29 * DAY);
    const before = new Date(+from - 30 * DAY);
    const members = { role: { not: 'guest' }, state: { not: 'deleted' } } as const; // real accounts: no demo guests, no erased accounts
    const [users, pendingVerifications, openReports, activeActivities, activeTrips] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.verificationCheck.count({ where: { eligibility: 'pending' } }),
      this.prisma.report.count({ where: { status: { in: ['open', 'in_review'] } } }),
      this.prisma.activity.count({ where: { status: { in: ['published', 'full', 'confirmed'] }, endsAt: { gt: new Date() } } }),
      this.prisma.trip.count({ where: { status: { in: ['published', 'full', 'planning', 'confirmed'] } } }),
    ]);
    const created = { createdAt: true } as const;
    const [memberRows, activityRows, tripRows, reportRows, prevMembers, prevActivities, prevTrips, memberCount, verifiedMembers, decided, reportStatus, categories] = await Promise.all([
      this.prisma.user.findMany({ where: { ...members, createdAt: { gte: from } }, select: created }),
      this.prisma.activity.findMany({ where: { createdAt: { gte: from } }, select: created }),
      this.prisma.trip.findMany({ where: { createdAt: { gte: from } }, select: created }),
      this.prisma.report.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true, category: true } }),
      this.prisma.user.count({ where: { ...members, createdAt: { gte: before, lt: from } } }),
      this.prisma.activity.count({ where: { createdAt: { gte: before, lt: from } } }),
      this.prisma.trip.count({ where: { createdAt: { gte: before, lt: from } } }),
      this.prisma.user.count({ where: members }),
      this.prisma.user.count({ where: { ...members, eligibility: 'verified' } }),
      this.prisma.verificationCheck.groupBy({ by: ['eligibility'], where: { eligibility: { in: ['verified', 'rejected'] } }, _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['category'], where: { createdAt: { gte: from } }, _count: { _all: true } }),
    ]);
    const days = Array.from({ length: 30 }, (_, i) => new Date(+from + i * DAY).toISOString().slice(0, 10));
    const perDay = (rows: { createdAt: Date }[]) => {
      const n = new Map(days.map((d) => [d, 0]));
      for (const r of rows) {
        const k = r.createdAt.toISOString().slice(0, 10);
        n.set(k, (n.get(k) ?? 0) + 1);
      }
      return days.map((d) => n.get(d) ?? 0);
    };
    const approved = decided.find((r) => r.eligibility === 'verified')?._count._all ?? 0;
    const rejected = decided.find((r) => r.eligibility === 'rejected')?._count._all ?? 0;
    const status = (s: string) => reportStatus.find((r) => r.status === s)?._count._all ?? 0;
    return {
      users,
      pendingVerifications,
      openReports,
      activeActivities,
      activeTrips,
      // the dashboard: real members only (guests and erased accounts left out)
      members: memberCount,
      verifiedMembers,
      /** share of finished identity checks that passed; null until a check has been decided */
      approvalRate: approved + rejected > 0 ? approved / (approved + rejected) : null,
      reports: { open: status('open'), in_review: status('in_review'), resolved: status('resolved'), dismissed: status('dismissed') },
      period: { from: days[0], to: days[29], days },
      series: { members: perDay(memberRows), activities: perDay(activityRows), trips: perDay(tripRows), reports: perDay(reportRows) },
      previous: { members: prevMembers, activities: prevActivities, trips: prevTrips },
      reportsByCategory: categories.map((c) => ({ category: c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  // ------------------------------------------------------------ users
  @Staff(...ALL)
  @Get('users')
  async users(@Query('q') q?: string, @Query('state') state?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    // timed suspensions that have run out end now, so the list never shows someone as suspended who is not
    await this.prisma.user.updateMany({ where: { state: 'suspended', suspendedUntil: { lte: new Date() } }, data: { state: 'active', suspendedUntil: null } });
    const where: Prisma.UserWhereInput = {
      ...(state && { state }),
      ...(q && { OR: [{ email: { contains: q } }, { profile: { displayName: { contains: q } } }, { id: q }] }),
    };
    const size = pageLimit(limit, 100, 200);
    const all = await this.prisma.user.findMany({
      where: { AND: [where, beforeKeyset(decodeKeyset(cursor))] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      include: {
        profile: { select: { displayName: true, homeCity: true } },
        verifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { rejectionReason: true } },
      },
    });
    const { items: rows, nextCursor } = sliceKeyset(all, size, (u) => u.createdAt);
    return {
      nextCursor,
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        state: u.state,
        suspendedUntil: u.suspendedUntil,
        eligibility: u.eligibility,
        emailVerified: !!u.emailVerifiedAt,
        adultVerified: !!u.adultVerifiedAt,
        phoneVerified: !!u.phoneVerifiedAt,
        verifiedUntil: u.verifiedUntil,
        reverifyReason: u.reverifyReason,
        lastRejectionReason: u.eligibility === 'rejected' ? (u.verifications[0]?.rejectionReason ?? null) : null,
        displayName: u.profile?.displayName,
        homeCity: u.profile?.homeCity,
        createdAt: u.createdAt,
      })),
    };
  }

  @Staff(...ALL)
  @Get('users/:id')
  async user(@Param('id') id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true, verifications: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
    if (!u) throw E.notFound('User');
    const [reportsAgainst, hosted, joined, history] = await Promise.all([
      this.prisma.report.count({ where: { targetType: 'user', targetId: id } }),
      this.prisma.activity.count({ where: { hostId: id } }),
      this.prisma.activityMembership.count({ where: { userId: id, role: 'attendee' } }),
      this.prisma.auditEvent.findMany({ where: { objectType: 'user', objectId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    // every report about this person: about them directly, or about an activity or trip they host
    const [acts, trips] = await Promise.all([
      this.prisma.activity.findMany({ where: { hostId: id }, select: { id: true, title: true } }),
      this.prisma.trip.findMany({ where: { hostId: id }, select: { id: true, title: true } }),
    ]);
    const titles = new Map([...acts, ...trips].map((x) => [x.id, x.title]));
    const reports = await this.prisma.report.findMany({
      where: { OR: [{ targetType: 'user', targetId: id }, { targetType: 'activity', targetId: { in: acts.map((a) => a.id) } }, { targetType: 'trip', targetId: { in: trips.map((t) => t.id) } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { reporter: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
    const reportList = reports.map((r) => ({
      id: r.id,
      category: r.category,
      status: r.status,
      details: r.details,
      resolution: r.resolution,
      createdAt: r.createdAt,
      targetType: r.targetType,
      targetTitle: r.targetType === 'user' ? null : (titles.get(r.targetId) ?? null),
      reporterName: r.reporter.profile?.displayName ?? null,
    }));
    // never the password hash, and the mobile number is masked even for staff
    const { passwordHash: _omit, phoneNumber, phoneHash: _hash, mfaSecret: _mfa, ...safe } = u;
    return { ...safe, phone: phoneNumber ? maskPhone(decryptField(phoneNumber)) : null, stats: { reportsAgainst: Math.max(reportsAgainst, reportList.length), hosted, joined }, history, reports: reportList };
  }

  @Staff(...MOD)
  @Post('users/:id/suspend')
  async suspend(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason, days } = parse(suspendSchema, body);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw E.notFound('User');
    if (target.id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot suspend yourself');
    if (target.role !== 'user' && actor.role !== 'admin') throw E.forbidden('FORBIDDEN', 'Only admins can suspend staff');
    const until = days ? new Date(Date.now() + days * 864e5) : null;
    await this.prisma.user.update({ where: { id }, data: { state: 'suspended', suspendedUntil: until } });
    await this.settleReports(actor, 'user', id, days ? `suspended for ${days} ${days === 1 ? 'day' : 'days'}` : 'suspended until staff restore the account');
    // suspended until staff restore it = a ban: remember the email, number and device so a new account cannot start from them
    const remembered = days ? 0 : await banIdentities(this.prisma, target, reason);
    await this.audit.log(actor.id, 'user.suspend', 'user', id, { reason, ...(days ? { days, until } : { until: 'restored by staff', identitiesRemembered: remembered }) });
    return { state: 'suspended', suspendedUntil: until };
  }

  @Staff(...MOD)
  @Post('users/:id/restore')
  async restore(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw E.notFound('User');
    await this.prisma.user.update({ where: { id }, data: { state: 'active', suspendedUntil: null } });
    await liftBans(this.prisma, id);
    await this.audit.log(actor.id, 'user.restore', 'user', id, { reason });
    return { state: 'active' };
  }

  /** A staff member lost their authenticator and recovery codes: switch it off so they can set it up again. */
  @Staff('admin')
  @Post('users/:id/mfa/reset')
  async resetMfa(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    if (id === actor.id) throw E.badRequest('INVALID_TARGET', 'Ask another administrator to reset your own two-step sign-in.');
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw E.notFound('User');
    await this.mfa.clear(id);
    await this.audit.log(actor.id, 'mfa.reset_by_admin', 'user', id, { reason });
    return { ok: true };
  }

  @Staff('admin')
  @Post('users/:id/role')
  async setRole(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { role } = parse(roleSchema, body);
    if (id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot change your own role');
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw E.notFound('User');
    await this.prisma.user.update({ where: { id }, data: { role } });
    await this.audit.log(actor.id, 'user.role_change', 'user', id, { role });
    return { role };
  }

  // ------------------------------------------------------------ verification
  @Staff(...ALL)
  @Get('verifications')
  async verifications(@Query('status') status = 'pending', @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const size = pageLimit(limit, 100, 200);
    const all = await this.prisma.verificationCheck.findMany({
      where: { AND: [{ eligibility: status }, afterKeyset(decodeKeyset(cursor))] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: size + 1,
      include: { user: { select: { id: true, email: true, profile: { select: { displayName: true, homeCity: true } } } } },
    });
    const { items: rows, nextCursor } = sliceKeyset(all, size, (c) => c.createdAt);
    return {
      nextCursor,
      items: rows.map((c) => ({
        id: c.id,
        provider: c.provider,
        method: c.method,
        providerRef: c.providerRef,
        eligibility: c.eligibility,
        createdAt: c.createdAt,
        user: { id: c.user.id, email: c.user.email, displayName: c.user.profile?.displayName, homeCity: c.user.profile?.homeCity },
      })),
    };
  }

  @Staff(...TRUST)
  @Post('verifications/:id/decision')
  async decideVerification(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { decision, reason } = parse(verificationDecisionSchema, body);
    // A staff approval is the human confirmation that the person is an adult with a genuine ID.
    return this.verification.decide(id, decision, actor.id, { adult: decision === 'verified' ? true : undefined, reason });
  }

  /** Reopen verification for someone (rejected, stuck, or a reviewed under-18 flag). They start again from the beginning. */
  @Staff(...TRUST)
  @Post('users/:id/reset-verification')
  async resetVerification(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { note } = parse(noteSchema, body);
    return this.verification.resetVerification(actor.id, id, note);
  }

  /** Appeal outcome: a human reviewer decides a rejection was wrong and approves the person. */
  @Staff(...TRUST)
  @Post('users/:id/overturn-rejection')
  async overturnRejection(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { note } = parse(noteSchema, body);
    return this.verification.overturnRejection(actor, id, note);
  }

  /**
   * Force a new identity check: a security concern or suspected fraud. Takes effect immediately: the user can
   * still browse but cannot create, join or chat until they verify again.
   */
  @Staff(...TRUST)
  @Post('users/:id/require-reverification')
  async requireReverification(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason, note } = parse(reverifySchema, body);
    if (id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot require re-verification of yourself');
    const r = await this.verification.requireReverification(actor.id, id, reason, note);
    await this.settleReports(actor, 'user', id, 'asked to verify their identity again');
    return r;
  }

  /**
   * Acting on a person or a listing settles the reports still open about it: they are marked resolved with what was
   * done, so nobody has to resolve the same thing twice. Each one gets its own audit entry.
   */
  private async settleReports(actor: User, targetType: string, targetId: string, action: string) {
    const open = await this.prisma.report.findMany({ where: { targetType, targetId, status: { in: ['open', 'in_review'] } }, select: { id: true } });
    if (open.length === 0) return;
    const resolution = `Action taken: ${action}`;
    await this.prisma.report.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { status: 'resolved', resolution, assignedTo: actor.id, resolvedAt: new Date() } });
    for (const r of open) await this.audit.log(actor.id, 'report.resolved', 'report', r.id, { resolution, automatic: true });
  }

  // ------------------------------------------------------------ moderation: reports
  @Staff(...ALL)
  @Get('reports')
  async reports(@Query('status') status?: string, @Query('category') category?: string) {
    return this.moderation.queue(status, category);
  }

  @Staff(...MOD)
  @Post('reports/:id/assign')
  async assign(@CurrentUser() actor: User, @Param('id') id: string) {
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw E.notFound('Report');
    await this.prisma.report.update({ where: { id }, data: { assignedTo: actor.id, status: r.status === 'open' ? 'in_review' : r.status, firstReviewedAt: r.firstReviewedAt ?? new Date() } });
    await this.audit.log(actor.id, 'report.assign', 'report', id);
    return { ok: true };
  }

  @Staff(...MOD)
  @Post('reports/:id/resolve')
  async resolve(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const dto = parse(resolveSchema, body);
    if (!(await this.prisma.report.findUnique({ where: { id } }))) throw E.notFound('Report');
    await this.prisma.report.update({
      where: { id },
      data: {
        status: dto.status,
        resolution: dto.resolution,
        assignedTo: actor.id,
        resolvedAt: dto.status === 'in_review' ? null : new Date(),
      },
    });
    await this.audit.log(actor.id, `report.${dto.status}`, 'report', id, { resolution: dto.resolution });
    return { ok: true };
  }

  // ------------------------------------------------------------ moderation: content
  @Staff(...ALL)
  @Get('activities')
  async activitiesList(@Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const size = pageLimit(limit, 100, 200);
    const all = await this.prisma.activity.findMany({
      where: { AND: [status ? { status } : {}, beforeKeyset(decodeKeyset(cursor))] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      include: { host: { select: { id: true, profile: { select: { displayName: true } } } }, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });
    const { items: rows, nextCursor } = sliceKeyset(all, size, (a) => a.createdAt);
    return {
      nextCursor,
      items: rows.map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        city: a.city,
        venueName: a.venueName,
        startsAt: a.startsAt,
        capacity: a.capacity,
        going: a._count.memberships,
        host: { id: a.host.id, displayName: a.host.profile?.displayName },
      })),
    };
  }

  @Staff(...MOD)
  @Post('activities/:id/remove')
  async removeActivity(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    await this.audit.log(actor.id, 'activity.remove_reason', 'activity', id, { reason });
    await this.settleReports(actor, 'activity', id, 'listing removed');
    return this.activities.cancel(actor, id, true);
  }

  @Staff(...ALL)
  @Get('trips')
  async tripsList(@Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const size = pageLimit(limit, 100, 200);
    const all = await this.prisma.trip.findMany({
      where: { AND: [status ? { status } : {}, beforeKeyset(decodeKeyset(cursor))] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      include: { host: { select: { id: true, profile: { select: { displayName: true } } } }, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });
    const { items: rows, nextCursor } = sliceKeyset(all, size, (t) => t.createdAt);
    return {
      nextCursor,
      items: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        destination: t.destination,
        dateStart: t.dateStart,
        members: t._count.memberships,
        host: { id: t.host.id, displayName: t.host.profile?.displayName },
      })),
    };
  }

  @Staff(...MOD)
  @Post('trips/:id/remove')
  async removeTrip(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    await this.audit.log(actor.id, 'trip.remove_reason', 'trip', id, { reason });
    await this.settleReports(actor, 'trip', id, 'trip removed');
    return this.trips.cancel(actor, id, true);
  }

  @Staff(...MOD)
  @Post('activities/:id/members/:userId/remove')
  async removeMember(@CurrentUser() actor: User, @Param('id') id: string, @Param('userId') userId: string) {
    return this.activities.removeMember(actor, id, userId, true);
  }

  // ------------------------------------------------------------ audit
  @Staff(...TRUST)
  @Get('audit')
  async auditLog(@Query('objectType') objectType?: string, @Query('objectId') objectId?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    const size = pageLimit(limit, 200, 200);
    const { items, nextCursor } = sliceKeyset(
      await this.prisma.auditEvent.findMany({
        where: { AND: [{ ...(objectType && { objectType }), ...(objectId && { objectId }) }, beforeKeyset(decodeKeyset(cursor))] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: size + 1,
      }),
      size,
      (e) => e.createdAt,
    );
    // the log stores ids; add the names of the people involved so it can be read at a glance
    const ids = [...new Set(items.flatMap((e) => [e.actorId, e.objectType === 'user' ? e.objectId : null]).filter((x): x is string => !!x))];
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true } });
    const name = new Map(profiles.map((p) => [p.userId, p.displayName]));
    const roles = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } })).map((u) => [u.id, u.role]));
    return {
      nextCursor,
      items: items.map((e) => ({
        ...e,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        actorRole: e.actorId ? (roles.get(e.actorId) ?? null) : null,
        actorName: e.actorId ? (name.get(e.actorId) ?? null) : null,
        objectName: e.objectType === 'user' ? (name.get(e.objectId) ?? null) : null,
      })),
    };
  }
}
