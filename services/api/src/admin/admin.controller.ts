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
const verificationDecisionSchema = z.object({ decision: z.enum(['verified', 'rejected']) });
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
    const where: Prisma.UserWhereInput = {
      ...(state && { state }),
      ...(q && { OR: [{ email: { contains: q } }, { profile: { displayName: { contains: q } } }, { id: q }] }),
    };
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { profile: { select: { displayName: true, homeCity: true } } },
    });
    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        state: u.state,
        eligibility: u.eligibility,
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
    const { passwordHash: _omit, ...safe } = u;
    return { ...safe, stats: { reportsAgainst, hosted, joined }, history };
  }

  @Staff(...MOD)
  @Post('users/:id/suspend')
  async suspend(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw E.notFound('User');
    if (target.id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot suspend yourself');
    if (target.role !== 'user' && actor.role !== 'admin') throw E.forbidden('FORBIDDEN', 'Only admins can suspend staff');
    await this.prisma.user.update({ where: { id }, data: { state: 'suspended' } });
    await this.audit.log(actor.id, 'user.suspend', 'user', id, { reason });
    return { state: 'suspended' };
  }

  @Staff(...MOD)
  @Post('users/:id/restore')
  async restore(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    const { reason } = parse(reasonSchema, body);
    if (!(await this.prisma.user.findUnique({ where: { id } }))) throw E.notFound('User');
    await this.prisma.user.update({ where: { id }, data: { state: 'active' } });
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
    const { decision } = parse(verificationDecisionSchema, body);
    return this.verification.decide(id, decision, actor.id);
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
    return { items: items.map((e) => ({ ...e, metadata: e.metadata ? JSON.parse(e.metadata) : null })) };
  }
}
