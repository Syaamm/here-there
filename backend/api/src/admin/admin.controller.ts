import { metrics } from '../common/observability';
import { decryptField, maskPhone } from '../common/vault';
import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Perm, RegionalOk, Staff } from '../common/auth';
import { STAFF_PERMISSIONS, STAFF_ROLES } from '../common/constants';
import { E } from '../common/errors';
import { hashPassword } from '../common/password';
import { afterKeyset, beforeKeyset, decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { banIdentities, liftBans } from '../common/identity';
import { ModerationService } from '../moderation/moderation.controller';
import { ReliabilityService } from '../reliability/reliability.controller';
import { RegionsService } from '../regions/regions.service';
import { inScope } from '../regions/regions';
import { MfaService } from '../auth/mfa.controller';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { parse } from '../common/validate';
import { TripsService } from '../trips/trips.service';
import { VerificationService } from '../verification/verification.service';

// Two kinds of console account: staff (one area, the parts an admin allows) and admins (everything).
const ALL = [...STAFF_ROLES];
const MOD = [...STAFF_ROLES];
/** Overturning, resetting and re-requesting identity checks, and the audit log: admins only. */
const TRUST = ['admin'];

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
export const staffCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(2).max(40),
  role: z.literal('staff').optional(),
  regionKey: z.string().trim().min(1).max(60),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)).optional(),
});
/** An admin changes what one staff member may do, or where. */
export const staffUpdateSchema = z.object({
  regionKey: z.string().trim().min(1).max(60).optional(),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)).optional(),
});
/**
 * A from/to window on when something happens. Both: from (inclusive) to (exclusive), earliest first. Only to: everything before
 * it, latest first (what already happened). Neither: no window. Invalid dates are ignored.
 */
function timeWindow(fromRaw?: string, toRaw?: string) {
  const at = (v?: string) => (v && !isNaN(+new Date(v)) ? new Date(v) : null);
  const from = at(fromRaw);
  const to = at(toRaw);
  if (!from && !to) return null;
  const order = from ? ('asc' as const) : ('desc' as const);
  return {
    order,
    range: { ...(from && { gte: from }), ...(to && { lt: to }) },
    keyset: (cur: { at: Date; id: string } | null, field: string) => (from ? afterKeyset(cur, field) : beforeKeyset(cur, field)),
  };
}

/** Leave userId out (or send your own) to take the report yourself; an admin may name any staff member. */
export const assignSchema = z.object({ userId: z.string().min(1).max(64).optional() });
export const roleSchema = z.object({ role: z.enum(['user', ...STAFF_ROLES]), regionKey: z.string().trim().min(1).max(60).nullable().optional(), permissions: z.array(z.enum(STAFF_PERMISSIONS)).optional() });

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
    private readonly reliability: ReliabilityService,
    private readonly regions: RegionsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Account-wide actions (suspend, restore): only staff of the person's home city, or an admin. Never other staff. */
  private async assertUserInScope(actor: User, userId: string) {
    await this.regions.assertPersonHome(actor, userId);
  }

  private async assertActivityInScope(actor: User, activityId: string) {
    const a = await this.prisma.activity.findUnique({ where: { id: activityId }, select: { cityKey: true } });
    if (!a) throw E.notFound('Activity');
    await this.regions.assertCity(actor, a.cityKey);
  }

  // ------------------------------------------------------------ overview
  @Staff(...ALL)
  @Get('overview')
  async overview(@Query('from') fromRaw?: string, @Query('to') toRaw?: string) {
    // a range of whole UTC days (default: the last 30, today included, at most a year) and the same length just before it
    const DAY = 24 * 3600 * 1000;
    const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(+new Date(v + 'T00:00:00.000Z')) ? new Date(v + 'T00:00:00.000Z') : null);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    let end = day(toRaw) ?? today;
    if (+end > +today) end = today;
    let from = day(fromRaw) ?? new Date(+end - 29 * DAY);
    if (+from > +end) from = end;
    if ((+end - +from) / DAY > 365) from = new Date(+end - 365 * DAY);
    const length = Math.round((+end - +from) / DAY) + 1;
    const until = new Date(+end + DAY);
    const before = new Date(+from - length * DAY);
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
      this.prisma.user.findMany({ where: { ...members, createdAt: { gte: from, lt: until } }, select: created }),
      this.prisma.activity.findMany({ where: { createdAt: { gte: from, lt: until } }, select: created }),
      this.prisma.trip.findMany({ where: { createdAt: { gte: from, lt: until } }, select: created }),
      this.prisma.report.findMany({ where: { createdAt: { gte: from, lt: until } }, select: { createdAt: true, category: true } }),
      this.prisma.user.count({ where: { ...members, createdAt: { gte: before, lt: from } } }),
      this.prisma.activity.count({ where: { createdAt: { gte: before, lt: from } } }),
      this.prisma.trip.count({ where: { createdAt: { gte: before, lt: from } } }),
      this.prisma.user.count({ where: members }),
      this.prisma.user.count({ where: { ...members, eligibility: 'verified' } }),
      this.prisma.verificationCheck.groupBy({ by: ['eligibility'], where: { eligibility: { in: ['verified', 'rejected'] } }, _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['category'], where: { createdAt: { gte: from, lt: until } }, _count: { _all: true } }),
    ]);
    const days = Array.from({ length }, (_, i) => new Date(+from + i * DAY).toISOString().slice(0, 10));
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
      period: { from: days[0], to: days[days.length - 1], days },
      series: { members: perDay(memberRows), activities: perDay(activityRows), trips: perDay(tripRows), reports: perDay(reportRows) },
      previous: { members: prevMembers, activities: prevActivities, trips: prevTrips },
      reportsByCategory: categories.map((c) => ({ category: c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
    };
  }

  /**
   * How the service is doing right now, for the console's Overview: per-minute sign-ups, joins, messages and requests, the
   * error rate, the slowest recent database statements (never with the values in them) and how long a trivial query takes.
   * Counted by this server process since it started (see deployment/FOR_DEPLOYMENT.md for more than one server).
   */
  @Staff(...ALL)
  @Get('health')
  async health(@Query('minutes') minutes?: string) {
    const n = Math.min(120, Math.max(5, Number(minutes) || 60));
    const started = process.hrtime.bigint();
    await this.prisma.$queryRaw`SELECT 1`;
    const dbMs = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 10) / 10;
    return { ...metrics.snapshot(n), database: { pingMs: dbMs }, errorTracking: { configured: !!process.env.SENTRY_DSN }, logFormat: process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text') };
  }

  // ------------------------------------------------------------ users
  @Staff(...ALL)
  @RegionalOk()
  @Perm('users')
  @Get('users')
  async users(@CurrentUser() actor: User, @Query('q') q?: string, @Query('state') state?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Headers('x-admin-place') place?: string) {
    // timed suspensions that have run out end now, so the list never shows someone as suspended who is not
    await this.prisma.user.updateMany({ where: { state: 'suspended', suspendedUntil: { lte: new Date() } }, data: { state: 'active', suspendedUntil: null } });
    // staff see the members whose home city is in their area or who have been active there lately, and never other staff
    const scope = await this.regions.scopeOf(actor, place);
    // kept apart with AND: the area and the search both use OR, and one must never replace the other
    // only people who signed up in the app: no staff or admin accounts (those are on the Staff page) and no demo guests
    const where: Prisma.UserWhereInput = {
      AND: [
        { role: 'user' },
        scope ? this.regions.peopleWhere(scope) : {},
        state ? { state } : {},
        q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { profile: { displayName: { contains: q, mode: 'insensitive' } } }, { id: q }] } : {},
      ],
    };
    const size = pageLimit(limit, 100, 200);
    const all = await this.prisma.user.findMany({
      where: { AND: [where, beforeKeyset(decodeKeyset(cursor))] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      include: {
        profile: { select: { displayName: true, homeCity: true, photoUrl: true } },
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
        adminRegionKey: u.adminRegionKey,
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
        photoUrl: u.profile?.photoUrl ?? null,
        homeCity: u.profile?.homeCity,
        createdAt: u.createdAt,
      })),
    };
  }

  @Staff(...ALL)
  @RegionalOk()
  @Perm('users')
  @Get('users/:id')
  async user(@CurrentUser() actor: User, @Param('id') id: string) {
    await this.regions.assertPersonLocal(actor, id);
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
  @RegionalOk()
  @Perm('users')
  @Post('users/:id/suspend')
  async suspend(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason, days } = parse(suspendSchema, body);
    await this.assertUserInScope(actor, id);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw E.notFound('User');
    if (target.id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot suspend yourself');
    if (target.role !== 'user' && actor.role !== 'admin') throw E.forbidden('FORBIDDEN', 'Only admins can suspend staff');
    const until = days ? new Date(Date.now() + days * 864e5) : null;
    await this.prisma.user.update({ where: { id }, data: { state: 'suspended', suspendedUntil: until } });
    // a suspended account is signed out everywhere, so its phones stop getting its pushes (they register again after a sign-in)
    await this.prisma.pushSubscription.deleteMany({ where: { userId: id } });
    await this.settleReports(actor, 'user', id, days ? `suspended for ${days} ${days === 1 ? 'day' : 'days'}` : 'suspended until staff restore the account');
    // suspended until staff restore it = a ban: remember the email, number and device so a new account cannot start from them
    const remembered = days ? 0 : await banIdentities(this.prisma, target, reason);
    await this.audit.log(actor.id, 'user.suspend', 'user', id, { reason, ...(days ? { days, until } : { until: 'restored by staff', identitiesRemembered: remembered }) });
    return { state: 'suspended', suspendedUntil: until };
  }

  @Staff(...MOD)
  @RegionalOk()
  @Perm('users')
  @Post('users/:id/restore')
  async restore(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    await this.assertUserInScope(actor, id);
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

  /** Every staff account, with whether its two-step sign-in is connected. */
  @Staff('admin')
  @Get('staff')
  async staffList() {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: [...STAFF_ROLES] }, state: { not: 'deleted' } },
      orderBy: [{ createdAt: 'asc' }],
      take: 200,
      include: { profile: { select: { displayName: true, photoUrl: true } } },
    });
    return { items: rows.map((u) => ({ id: u.id, email: u.email, displayName: u.profile?.displayName ?? null, photoUrl: u.profile?.photoUrl ?? null, role: u.role, regionKey: u.adminRegionKey, permissions: u.role === 'admin' ? [...STAFF_PERMISSIONS] : u.staffPermissions, state: u.state, mfaEnabled: !!u.mfaEnabledAt, mustChangePassword: u.mustChangePassword, createdAt: u.createdAt })) };
  }

  /**
   * An administrator makes a staff account for one area, with the parts of the console it may use (all of them unless chosen). The server picks a temporary password and shows it once;
   * on their first sign-in the console asks them to choose their own password, then to connect an authenticator app, before
   * anything else opens (`mustChangePassword`, cleared by the first password change).
   */
  @Staff('admin')
  @Post('staff')
  async createStaff(@CurrentUser() actor: User, @Body() body: unknown) {
    const dto = parse(staffCreateSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: dto.email } })) throw E.conflict('EMAIL_TAKEN', 'An account with that email already exists. Change its role from the Users page instead.');
    const area = dto.regionKey;
    if (!(await this.regions.exists(area))) throw E.badRequest('INVALID_PLACE', 'That place does not exist');
    const permissions = dto.permissions ?? [...STAFF_PERMISSIONS];
    const h = randomBytes(8).toString('hex');
    const temporaryPassword = `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12)}`;
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await hashPassword(temporaryPassword),
        role: 'staff',
        adminRegionKey: area,
        staffPermissions: permissions,
        mustChangePassword: true,
        adultConfirmed: true,
        emailVerifiedAt: new Date(),
        profile: { create: { displayName: dto.displayName } },
      },
    });
    await this.audit.log(actor.id, 'staff.create', 'user', user.id, { role: 'staff', regionKey: area, permissions });
    return { id: user.id, email: user.email, role: user.role, regionKey: area, permissions, temporaryPassword };
  }

  /** An admin changes one staff member's area or permissions. Recorded in the audit log with what it was before. */
  @Staff('admin')
  @Patch('staff/:id')
  async updateStaff(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const dto = parse(staffUpdateSchema, body);
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row || row.state === 'deleted') throw E.notFound('User');
    if (row.role !== 'staff') throw E.badRequest('INVALID_TARGET', 'Only staff accounts have an area and permissions');
    if (dto.regionKey && !(await this.regions.exists(dto.regionKey))) throw E.badRequest('INVALID_PLACE', 'That place does not exist');
    const data = { ...(dto.regionKey && { adminRegionKey: dto.regionKey }), ...(dto.permissions && { staffPermissions: dto.permissions }) };
    await this.prisma.user.update({ where: { id }, data });
    await this.audit.log(actor.id, 'staff.update', 'user', id, { before: { regionKey: row.adminRegionKey, permissions: row.staffPermissions }, after: data });
    return { id, regionKey: dto.regionKey ?? row.adminRegionKey, permissions: dto.permissions ?? row.staffPermissions };
  }

  @Staff('admin')
  @Post('users/:id/role')
  async setRole(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { role, regionKey, permissions } = parse(roleSchema, body);
    if (id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot change your own role');
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw E.notFound('User');
    // Staff always look after one city, region or country. Admins and members have no area.
    const area = role === 'staff' ? (regionKey ?? null) : null;
    if (role === 'staff' && !area) throw E.badRequest('AREA_REQUIRED', 'Choose the area this staff member looks after');
    if (area && !(await this.regions.exists(area))) throw E.badRequest('INVALID_PLACE', 'That place does not exist');
    const perms = role === 'staff' ? (permissions ?? [...STAFF_PERMISSIONS]) : [];
    await this.prisma.user.update({ where: { id }, data: { role, adminRegionKey: area, staffPermissions: perms } });
    await this.audit.log(actor.id, 'user.role_change', 'user', id, { role, regionKey: area, permissions: perms });
    return { role, regionKey: area, permissions: perms };
  }

  // ------------------------------------------------------------ verification
  @Staff(...ALL)
  @RegionalOk()
  @Perm('verification')
  @Get('verifications')
  async verifications(@CurrentUser() actor: User, @Query('status') status = 'pending', @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Headers('x-admin-place') place?: string) {
    const size = pageLimit(limit, 100, 200);
    const scope = await this.regions.scopeOf(actor, place);
    const all = await this.prisma.verificationCheck.findMany({
      where: { AND: [{ eligibility: status }, scope ? { user: { profile: { homeCityKey: { in: [...scope.cityKeys] } } } } : {}, afterKeyset(decodeKeyset(cursor))] },
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

  @Staff(...MOD)
  @RegionalOk()
  @Perm('verification')
  @Post('verifications/:id/decision')
  async decideVerification(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { decision, reason } = parse(verificationDecisionSchema, body);
    // staff decide only for people whose home city is in their area
    const check = await this.prisma.verificationCheck.findUnique({ where: { id }, select: { userId: true } });
    if (!check) throw E.notFound('Verification');
    await this.regions.assertPersonHome(actor, check.userId);
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
  @RegionalOk()
  @Perm('reports')
  @Get('reports')
  async reports(@CurrentUser() actor: User, @Query('status') status?: string, @Query('category') category?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Headers('x-admin-place') place?: string) {
    return this.moderation.queue(status, category, new Date(), await this.regions.scopeOf(actor, place), { limit, cursor });
  }

  @Staff(...MOD)
  @RegionalOk()
  @Perm('reports')
  @Post('reports/:id/assign')
  async assign(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { userId } = parse(assignSchema, body ?? {});
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw E.notFound('Report');
    await this.moderation.assertReportInScope(await this.regions.scopeOf(actor), r);
    // staff take a report themselves; an admin may give it to any staff member who looks after its area and works on reports
    let to = actor;
    if (userId && userId !== actor.id) {
      if (actor.role !== 'admin') throw E.forbidden('ADMIN_ONLY', 'Only an admin can give a report to someone else');
      const target = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!target || target.state !== 'active' || !['staff', 'admin'].includes(target.role)) throw E.badRequest('INVALID_TARGET', 'Choose an active staff member');
      if (target.role === 'staff') {
        if (!target.staffPermissions.includes('reports')) throw E.badRequest('INVALID_TARGET', 'That staff member does not work on reports');
        try {
          await this.moderation.assertReportInScope(await this.regions.scopeOf(target), r);
        } catch {
          throw E.badRequest('INVALID_TARGET', 'That staff member does not look after the area of this report');
        }
      }
      to = target;
    }
    await this.prisma.report.update({ where: { id }, data: { assignedTo: to.id, status: r.status === 'open' ? 'in_review' : r.status, firstReviewedAt: r.firstReviewedAt ?? new Date() } });
    await this.audit.log(actor.id, 'report.assign', 'report', id, to.id === actor.id ? {} : { assignedTo: to.id });
    if (to.id !== actor.id) await this.notifications.notify(to.id, 'report_assigned', 'A report was given to you', 'Open the admin console, Reports, to look at it.', { reportId: id }).catch(() => undefined);
    return { ok: true, assignedTo: to.id };
  }

  @Staff(...MOD)
  @RegionalOk()
  @Perm('reports')
  @Post('reports/:id/resolve')
  async resolve(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const dto = parse(resolveSchema, body);
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw E.notFound('Report');
    await this.moderation.assertReportInScope(await this.regions.scopeOf(actor), report);
    const data = { status: dto.status, resolution: dto.resolution, assignedTo: actor.id, resolvedAt: dto.status === 'in_review' ? null : new Date() };
    if (dto.status === 'in_review') {
      await this.prisma.report.update({ where: { id }, data });
    } else {
      // Any staff member who sees a report may decide it. Two deciding at the same moment: the check and the write are one
      // statement (only while the report is still open or in review), so exactly one decision counts. The other gets a clear
      // answer and nothing runs twice (one audit entry, one message to the person, one reliability note).
      const won = await this.prisma.report.updateMany({ where: { id, status: { in: ['open', 'in_review'] } }, data });
      if (won.count === 0) {
        const now = await this.prisma.report.findUnique({ where: { id }, select: { status: true, assignedTo: true } });
        const by = now?.assignedTo ? await this.prisma.profile.findUnique({ where: { userId: now.assignedTo }, select: { displayName: true } }) : null;
        const verb = now?.status === 'dismissed' ? 'dismissed' : 'resolved';
        throw E.conflict('REPORT_ALREADY_DECIDED', by?.displayName ? `Already ${verb} by ${by.displayName}.` : `This report was already ${verb}.`, { status: now?.status ?? null });
      }
    }
    await this.audit.log(actor.id, `report.${dto.status}`, 'report', id, { resolution: dto.resolution });
    // a decision was taken about someone: they can read it and ask for a review once
    if (dto.status === 'resolved' && report.status !== 'resolved') await this.moderation.tellSubject(report).catch(() => undefined);
    // "resolved" on a host-did-not-show-up report means a moderator confirmed it: the host's notes for that plan are cancelled
    if (dto.status === 'resolved' && report.category === 'host_no_show' && report.status !== 'resolved') await this.reliability.onHostAbsenceUpheld(actor, report);
    return { ok: true };
  }

  // ------------------------------------------------------------ moderation: content
  @Staff(...ALL)
  @RegionalOk()
  @Perm('content')
  @Get('activities')
  async activitiesList(@CurrentUser() actor: User, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Headers('x-admin-place') place?: string, @Query('from') fromRaw?: string, @Query('to') toRaw?: string) {
    const size = pageLimit(limit, 100, 200);
    const scope = await this.regions.scopeOf(actor, place);
    // with a window: by when they happen (from..to earliest first; only "to": what already happened, latest first)
    const win = timeWindow(fromRaw, toRaw);
    const all = await this.prisma.activity.findMany({
      where: { AND: [status ? { status } : {}, scope ? { cityKey: { in: [...scope.cityKeys] } } : {}, win ? { startsAt: win.range } : {}, win ? win.keyset(decodeKeyset(cursor), 'startsAt') : beforeKeyset(decodeKeyset(cursor))] },
      orderBy: win ? [{ startsAt: win.order }, { id: win.order }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      include: { host: { select: { id: true, profile: { select: { displayName: true } } } }, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });
    const { items: rows, nextCursor } = sliceKeyset(all, size, (a) => (win ? a.startsAt : a.createdAt));
    return {
      nextCursor,
      limitMonths: await this.regions.limitMonths(scope, 'here'),
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
  @RegionalOk()
  @Perm('content')
  @Post('activities/:id/remove')
  async removeActivity(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    await this.assertActivityInScope(actor, id);
    await this.audit.log(actor.id, 'activity.remove_reason', 'activity', id, { reason });
    await this.settleReports(actor, 'activity', id, 'listing removed');
    return this.activities.cancel(actor, id, true);
  }

  @Staff(...ALL)
  @RegionalOk()
  @Perm('content')
  @Get('trips')
  async tripsList(@CurrentUser() actor: User, @Query('status') status?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Headers('x-admin-place') place?: string, @Query('from') fromRaw?: string, @Query('to') toRaw?: string) {
    const size = pageLimit(limit, 100, 200);
    const scope = await this.regions.scopeOf(actor, place);
    const win = timeWindow(fromRaw, toRaw);
    const all = await this.prisma.trip.findMany({
      where: { AND: [status ? { status } : {}, scope ? { originKey: { in: [...scope.cityKeys] } } : {}, win ? { dateStart: win.range } : {}, win ? win.keyset(decodeKeyset(cursor), 'dateStart') : beforeKeyset(decodeKeyset(cursor))] },
      orderBy: win ? [{ dateStart: win.order }, { id: win.order }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      take: size + 1,
      include: { host: { select: { id: true, profile: { select: { displayName: true } } } }, _count: { select: { memberships: { where: { state: 'approved' } } } } },
    });
    const { items: rows, nextCursor } = sliceKeyset(all, size, (t) => (win ? t.dateStart : t.createdAt));
    return {
      nextCursor,
      limitMonths: await this.regions.limitMonths(scope, 'there'),
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
  @RegionalOk()
  @Perm('content')
  @Post('trips/:id/remove')
  async removeTrip(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    const trip = await this.prisma.trip.findUnique({ where: { id }, select: { originKey: true } });
    if (!trip) throw E.notFound('Trip');
    await this.regions.assertCity(actor, trip.originKey);
    await this.audit.log(actor.id, 'trip.remove_reason', 'trip', id, { reason });
    await this.settleReports(actor, 'trip', id, 'trip removed');
    return this.trips.cancel(actor, id, true);
  }

  @Staff(...MOD)
  @RegionalOk()
  @Perm('content')
  @Post('activities/:id/members/:userId/remove')
  async removeMember(@CurrentUser() actor: User, @Param('id') id: string, @Param('userId') userId: string) {
    await this.assertActivityInScope(actor, id);
    return this.activities.removeMember(actor, id, userId, true);
  }

  // ------------------------------------------------------------ audit
  @Staff(...TRUST)
  @Get('audit')
  async auditLog(@Query('objectType') objectType?: string, @Query('objectId') objectId?: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('from') from?: string) {
    const size = pageLimit(limit, 200, 200);
    // from: only entries at or after this time (the console's Today / Last 7 days / This month)
    const since = from && !isNaN(+new Date(from)) ? new Date(from) : null;
    const { items, nextCursor } = sliceKeyset(
      await this.prisma.auditEvent.findMany({
        where: { AND: [{ ...(objectType && { objectType }), ...(objectId && { objectId }), ...(since && { createdAt: { gte: since } }) }, beforeKeyset(decodeKeyset(cursor))] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: size + 1,
      }),
      size,
      (e) => e.createdAt,
    );
    // The log stores ids. Add a name for everything an entry mentions, so the console can show it as a sentence (one query per kind).
    const metas = items.map((e) => (e.metadata ? (JSON.parse(e.metadata) as Record<string, unknown>) : null));
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const of = (type: string) => items.filter((e) => e.objectType === type).map((e) => e.objectId);
    const fromMeta = (...keys: string[]) => metas.flatMap((m) => keys.map((k) => str(m?.[k]))).filter((x): x is string => !!x);
    const reports = await this.prisma.report.findMany({ where: { id: { in: [...of('report'), ...fromMeta('reportId')] } }, select: { id: true, targetType: true, targetId: true, category: true } });
    const messages = await this.prisma.message.findMany({
      where: { id: { in: [...of('message'), ...reports.filter((r) => r.targetType === 'message').map((r) => r.targetId)] } },
      select: { id: true, senderId: true, conversation: { select: { activity: { select: { title: true } }, trip: { select: { title: true } } } } },
    });
    const userIds = [
      ...items.flatMap((e) => [e.actorId, e.objectType === 'user' ? e.objectId : null]),
      ...fromMeta('userId', 'senderId', 'applicantId', 'from'),
      ...reports.filter((r) => r.targetType === 'user').map((r) => r.targetId),
      ...messages.map((m) => m.senderId),
    ].filter((x): x is string => !!x);
    const activityIds = [...of('activity'), ...fromMeta('activityId'), ...reports.filter((r) => r.targetType === 'activity').map((r) => r.targetId)];
    const tripIds = [...of('trip'), ...fromMeta('tripId'), ...reports.filter((r) => r.targetType === 'trip').map((r) => r.targetId)];
    const regionKeys = [...of('region'), ...fromMeta('regionKey', 'parentKey'), ...metas.flatMap((m) => [str((m?.before as Record<string, unknown> | undefined)?.regionKey), str((m?.after as Record<string, unknown> | undefined)?.adminRegionKey)])].filter((x): x is string => !!x);
    const [profiles, users, activities, trips, regions] = await Promise.all([
      this.prisma.profile.findMany({ where: { userId: { in: [...new Set(userIds)] } }, select: { userId: true, displayName: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, role: true } }),
      this.prisma.activity.findMany({ where: { id: { in: [...new Set(activityIds)] } }, select: { id: true, title: true } }),
      this.prisma.trip.findMany({ where: { id: { in: [...new Set(tripIds)] } }, select: { id: true, title: true } }),
      this.prisma.region.findMany({ where: { key: { in: [...new Set(regionKeys)] } }, select: { key: true, name: true } }),
    ]);
    const names: Record<string, string> = {};
    for (const p of profiles) names[p.userId] = p.displayName;
    for (const x of activities) names[x.id] = x.title;
    for (const x of trips) names[x.id] = x.title;
    for (const x of regions) names[x.key] = x.name;
    const roles = new Map(users.map((u) => [u.id, u.role]));
    const chatOf = (m: (typeof messages)[number] | undefined) => m?.conversation?.activity?.title ?? m?.conversation?.trip?.title ?? null;
    const msg = new Map(messages.map((m) => [m.id, m]));
    // "a message from Marco in Coffee and a walk", "Sofia", "Brunch in Brera"
    const describe = (type: string, id: string): string | null => {
      if (type === 'message') {
        const m = msg.get(id);
        if (!m) return 'a message';
        const chat = chatOf(m);
        return `a message from ${names[m.senderId] ?? 'someone'}${chat ? ` in ${chat}` : ''}`;
      }
      return names[id] ?? null;
    };
    const reportAbout = new Map(reports.map((r) => [r.id, describe(r.targetType, r.targetId)]));
    return {
      nextCursor,
      names,
      items: items.map((e, i) => ({
        ...e,
        metadata: metas[i],
        actorRole: e.actorId ? (roles.get(e.actorId) ?? null) : null,
        actorName: e.actorId ? (names[e.actorId] ?? null) : null,
        objectName: e.objectType === 'report' ? (reportAbout.get(e.objectId) ?? null) : describe(e.objectType, e.objectId),
        objectRole: e.objectType === 'user' ? (roles.get(e.objectId) ?? null) : null,
      })),
    };
  }
}
