import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { z } from 'zod';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Staff } from '../common/auth';
import { STAFF_ROLES } from '../common/constants';
import { E } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { TripsService } from '../trips/trips.service';
import { VerificationService } from '../verification/verification.service';

const ALL = [...STAFF_ROLES];
const MOD = ['moderator', 'trust_lead', 'admin'];
const TRUST = ['trust_lead', 'admin'];

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
// days: how long the suspension lasts; leave it out for "until staff restore the account"
const suspendSchema = reasonSchema.extend({ days: z.number().int().min(1).max(365).optional() });
const verificationDecisionSchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  reason: z.enum(['document', 'liveness', 'underage', 'other']).optional(), // when rejecting
});
const noteSchema = z.object({ note: z.string().trim().min(3).max(500) });
// Why a verified person must verify again. Expiry is automatic; these are the staff-triggered cases.
const reverifySchema = z.object({
  reason: z.enum(['security', 'fraud_suspected', 'other']),
  note: z.string().trim().min(3).max(500),
});
const resolveSchema = z.object({
  status: z.enum(['resolved', 'dismissed', 'in_review']),
  resolution: z.string().trim().max(1000).optional(),
});
const roleSchema = z.object({ role: z.enum(['user', ...STAFF_ROLES]) });

/** Internal operations console API (spec 12). Every mutating action writes an audit event. */
@Controller('v1/admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly verification: VerificationService,
    private readonly activities: ActivitiesService,
    private readonly trips: TripsService,
  ) {}

  // ------------------------------------------------------------ overview
  @Staff(...ALL)
  @Get('overview')
  async overview() {
    const [users, pendingVerifications, openReports, activeActivities, activeTrips] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.verificationCheck.count({ where: { eligibility: 'pending' } }),
      this.prisma.report.count({ where: { status: { in: ['open', 'in_review'] } } }),
      this.prisma.activity.count({ where: { status: { in: ['published', 'full', 'confirmed'] }, endsAt: { gt: new Date() } } }),
      this.prisma.trip.count({ where: { status: { in: ['published', 'full', 'planning', 'confirmed'] } } }),
    ]);
    return { users, pendingVerifications, openReports, activeActivities, activeTrips };
  }

  // ------------------------------------------------------------ users
  @Staff(...ALL)
  @Get('users')
  async users(@Query('q') q?: string, @Query('state') state?: string) {
    // timed suspensions that have run out end now, so the list never shows someone as suspended who is not
    await this.prisma.user.updateMany({ where: { state: 'suspended', suspendedUntil: { lte: new Date() } }, data: { state: 'active', suspendedUntil: null } });
    const where: Prisma.UserWhereInput = {
      ...(state && { state }),
      ...(q && { OR: [{ email: { contains: q } }, { profile: { displayName: { contains: q } } }, { id: q }] }),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        profile: { select: { displayName: true, homeCity: true } },
        verifications: { orderBy: { createdAt: 'desc' }, take: 1, select: { rejectionReason: true } },
      },
    });
    return {
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
    const { passwordHash: _omit, phoneNumber, ...safe } = u;
    return { ...safe, phone: phoneNumber ? `${phoneNumber.slice(0, 3)}••••${phoneNumber.slice(-2)}` : null, stats: { reportsAgainst: Math.max(reportsAgainst, reportList.length), hosted, joined }, history, reports: reportList };
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
    await this.audit.log(actor.id, 'user.suspend', 'user', id, { reason, ...(days ? { days, until } : { until: 'restored by staff' }) });
    return { state: 'suspended', suspendedUntil: until };
  }

  @Staff(...MOD)
  @Post('users/:id/restore')
  async restore(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw E.notFound('User');
    await this.prisma.user.update({ where: { id }, data: { state: 'active', suspendedUntil: null } });
    await this.audit.log(actor.id, 'user.restore', 'user', id, { reason });
    return { state: 'active' };
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
  async verifications(@Query('status') status = 'pending') {
    const rows = await this.prisma.verificationCheck.findMany({
      where: { eligibility: status },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { id: true, email: true, profile: { select: { displayName: true, homeCity: true } } } } },
    });
    return {
      items: rows.map((c) => ({
        id: c.id,
        provider: c.provider,
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
    const rows = await this.prisma.report.findMany({
      where: { ...(status && { status }), ...(category && { category }) },
      orderBy: [{ createdAt: 'asc' }],
      take: 200,
      include: { reporter: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
    // physical-safety reports first
    const rank = (c: string) => (c === 'physical_safety' ? 0 : c === 'underage' ? 1 : 2);
    rows.sort((a, b) => rank(a.category) - rank(b.category) || +a.createdAt - +b.createdAt);
    return { items: rows };
  }

  @Staff(...MOD)
  @Post('reports/:id/assign')
  async assign(@CurrentUser() actor: User, @Param('id') id: string) {
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw E.notFound('Report');
    await this.prisma.report.update({ where: { id }, data: { assignedTo: actor.id, status: r.status === 'open' ? 'in_review' : r.status } });
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
  async activitiesList(@Query('status') status?: string) {
    const rows = await this.prisma.activity.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { host: { select: { id: true, profile: { select: { displayName: true } } } }, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });
    return {
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
  async tripsList(@Query('status') status?: string) {
    const rows = await this.prisma.trip.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { host: { select: { id: true, profile: { select: { displayName: true } } } }, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });
    return {
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
  async auditLog(@Query('objectType') objectType?: string, @Query('objectId') objectId?: string) {
    const items = await this.prisma.auditEvent.findMany({
      where: { ...(objectType && { objectType }), ...(objectId && { objectId }) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    // the log stores ids; add the names of the people involved so it can be read at a glance
    const ids = [...new Set(items.flatMap((e) => [e.actorId, e.objectType === 'user' ? e.objectId : null]).filter((x): x is string => !!x))];
    const profiles = await this.prisma.profile.findMany({ where: { userId: { in: ids } }, select: { userId: true, displayName: true } });
    const name = new Map(profiles.map((p) => [p.userId, p.displayName]));
    const roles = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } })).map((u) => [u.id, u.role]));
    return {
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
