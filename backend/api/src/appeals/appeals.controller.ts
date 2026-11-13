import { Body, Controller, Get, Injectable, Ip, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { checkPassword } from '../common/password';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { afterKeyset, beforeKeyset, decodeKeyset, pageLimit, sliceKeyset, pageOf } from '../common/paging';
import { CurrentUser, Perm, Public, RegionalOk, Staff } from '../common/auth';
import { RegionsService } from '../regions/regions.service';
import { inScope } from '../regions/regions';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { liftBans } from '../common/identity';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { VerificationService } from '../verification/verification.service';
import { ProofsService } from './proofs.controller';

const messageSchema = z.string().trim().min(10, 'Please say a little more (at least a sentence)').max(1000);
/** Photos sent earlier with PUT /v1/me/proofs (a chat screenshot, say): up to 3. */
const proofIds = z.array(z.string().min(1)).max(3).optional().describe('ids of photos sent with PUT /v1/me/proofs, up to 3 (a screenshot of a chat, say)');
export const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verification'), message: messageSchema, proofIds }),
  z.object({ kind: z.literal('removal'), targetType: z.enum(['activity', 'trip']), targetId: z.string().min(1), message: messageSchema, proofIds }),
  z.object({ kind: z.literal('report'), targetId: z.string().min(1), message: messageSchema, proofIds }),
  z.object({ kind: z.literal('warning'), targetId: z.string().min(1), message: messageSchema, proofIds }),
  z.object({ kind: z.literal('message'), targetId: z.string().min(1), message: messageSchema, proofIds }),
]);
const suspensionSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), message: messageSchema });
const decisionSchema = z.object({ decision: z.enum(['uphold', 'reject']), note: z.string().trim().min(3, 'Write a short note the person will see').max(500) });

const replySchema = z.object({ message: z.string().trim().min(2, 'Write a short message').max(1000) });

const STAFF = ['staff', 'admin'];
/** After a suspension appeal the person may ask again no sooner than this. */
const SUSPENSION_COOLDOWN_DAYS = 30;

const WORDS: Record<string, string> = { verification: 'identity check', suspension: 'suspension', removal: 'removed listing', report: 'decision on a report about you', warning: 'warning', message: 'removed message' };

/**
 * Appeals (spec 4.3, 9.4, 17): a person asking staff to look at a decision again. Three kinds: a rejected identity check, a
 * suspension, and an activity or trip that staff removed. Each can be appealed once per decision. A moderator decides, and
 * the person is always told the outcome with a short note. (A declined join request is handled between the person and
 * the host: see POST activities/:id/appeal and trips/:id/appeal.)
 */
@Injectable()
export class AppealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly verification: VerificationService,
    private readonly email: EmailService,
    private readonly limiter: RateLimiter,
    private readonly regions: RegionsService,
    private readonly proofs: ProofsService,
  ) {}

  /** A new appeal: every admin is told, and the staff who look after the person's home city and work on reports. */
  private async tell(userId: string, kind: string) {
    const home = (await this.prisma.profile.findUnique({ where: { userId }, select: { homeCityKey: true } }))?.homeCityKey ?? null;
    const people = await this.prisma.user.findMany({ where: { role: { in: ['admin', 'staff'] }, state: 'active' }, select: { id: true, role: true, adminRegionKey: true, staffPermissions: true } });
    const to: string[] = [];
    for (const p of people) {
      if (p.role === 'admin') to.push(p.id);
      else if (kind !== 'verification' && p.adminRegionKey && p.staffPermissions.includes('reports') && inScope(await this.regions.scopeOf(p), home)) to.push(p.id);
    }
    await this.notifications.notifyMany(to, 'appeal_new', 'A new appeal', `Someone asked for a ${WORDS[kind] ?? kind} to be looked at again.`, {}).catch(() => undefined);
  }

  private clean(message: string) {
    const bad = contentProblem(message);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    return message;
  }

  async create(me: User, body: unknown) {
    const dto = parse(createSchema, body);
    this.clean(dto.message);
    this.limiter.hit(`appeal:${me.id}`, 5, 24 * 3600 * 1000);
    const photos = await this.proofs.claimable(me.id, dto.proofIds); // checked first, so nothing is half sent
    if (await this.prisma.appeal.findFirst({ where: { userId: me.id, state: 'open' } })) throw E.conflict('APPEAL_OPEN', 'You already have an appeal waiting for a decision');

    let targetType: string | null = null;
    let targetId: string | null = null;
    if (dto.kind === 'verification') {
      const check = await this.prisma.verificationCheck.findFirst({ where: { userId: me.id }, orderBy: { createdAt: 'desc' } });
      if (me.eligibility !== 'rejected' || !check || check.eligibility !== 'rejected' || ['superseded', 'cancelled'].includes(check.rejectionReason ?? ''))
        throw E.conflict('NOTHING_TO_APPEAL', 'There is no rejected identity check to appeal');
      targetType = 'verification_check';
      targetId = check.id;
    } else if (dto.kind === 'report') {
      // the person a report is ABOUT can ask for a review once, after staff took a decision (a person who reports cannot appeal)
      const rep = await this.prisma.report.findUnique({ where: { id: dto.targetId } });
      if (!rep || rep.status !== 'resolved' || rep.reporterId === me.id || !(await this.about(rep, me.id))) throw E.conflict('NOTHING_TO_APPEAL', 'There is no decision about you to appeal');
      targetType = 'report';
      targetId = rep.id;
    } else if (dto.kind === 'warning') {
      const w = await this.prisma.userWarning.findUnique({ where: { id: dto.targetId } });
      if (!w || w.userId !== me.id || w.withdrawnAt) throw E.conflict('NOTHING_TO_APPEAL', 'There is no warning of yours to appeal');
      targetType = 'warning';
      targetId = w.id;
    } else if (dto.kind === 'message') {
      const m = await this.prisma.message.findUnique({ where: { id: dto.targetId } });
      if (!m || m.senderId !== me.id || m.moderationState !== 'removed' || !m.removedBy) throw E.conflict('NOTHING_TO_APPEAL', 'Only a message of yours that a moderator removed can be appealed');
      targetType = 'message';
      targetId = m.id;
    } else {
      const row =
        dto.targetType === 'activity'
          ? await this.prisma.activity.findUnique({ where: { id: dto.targetId }, select: { hostId: true, status: true, cancelledAt: true } })
          : await this.prisma.trip.findUnique({ where: { id: dto.targetId }, select: { hostId: true, status: true, cancelledAt: true } });
      // only a listing that STAFF took down (the host's own cancellation leaves a time stamp) can be appealed, and only by its host
      if (!row || row.hostId !== me.id || row.status !== 'cancelled' || row.cancelledAt) throw E.conflict('NOTHING_TO_APPEAL', 'Only a listing that staff removed can be appealed');
      targetType = dto.targetType;
      targetId = dto.targetId;
    }
    if (await this.prisma.appeal.findFirst({ where: { userId: me.id, kind: dto.kind, targetId } })) throw E.conflict('ALREADY_APPEALED', 'This decision was already appealed once');
    const a = await this.prisma.appeal.create({ data: { userId: me.id, kind: dto.kind, targetType, targetId, message: dto.message } });
    await this.proofs.attach(photos, { appealId: a.id });
    await this.audit.log(me.id, 'appeal.create', 'appeal', a.id, { kind: dto.kind, photos: photos.length });
    await this.tell(me.id, a.kind);
    return { ...this.dto(a), proofs: photos };
  }

  /** Is this report about the person: the user reported, the sender of the message, or the host of the listing? */
  private async about(r: { targetType: string; targetId: string }, userId: string) {
    if (r.targetType === 'user') return r.targetId === userId;
    if (r.targetType === 'message') return (await this.prisma.message.findUnique({ where: { id: r.targetId }, select: { senderId: true } }))?.senderId === userId;
    const row = r.targetType === 'activity' ? await this.prisma.activity.findUnique({ where: { id: r.targetId }, select: { hostId: true } }) : r.targetType === 'trip' ? await this.prisma.trip.findUnique({ where: { id: r.targetId }, select: { hostId: true } }) : null;
    return row?.hostId === userId;
  }

  /** A suspended person cannot sign in, so this one proves who they are with their email and password instead. */
  async createSuspension(body: unknown, ip: string) {
    const dto = parse(suspensionSchema, body);
    this.limiter.hit(`appeal-suspension:${ip}:${dto.email}`, 10, 15 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await checkPassword(dto.password, user.passwordHash))) throw E.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (user.state !== 'suspended') throw E.conflict('NOTHING_TO_APPEAL', 'This account is not suspended');
    this.clean(dto.message);
    if (await this.prisma.appeal.findFirst({ where: { userId: user.id, kind: 'suspension', state: 'open' } })) throw E.conflict('APPEAL_OPEN', 'You already have an appeal waiting for a decision');
    const since = new Date(Date.now() - SUSPENSION_COOLDOWN_DAYS * 86_400_000);
    if (await this.prisma.appeal.findFirst({ where: { userId: user.id, kind: 'suspension', createdAt: { gt: since } } }))
      throw E.conflict('ALREADY_APPEALED', `You can appeal a suspension once every ${SUSPENSION_COOLDOWN_DAYS} days`);
    const a = await this.prisma.appeal.create({ data: { userId: user.id, kind: 'suspension', message: dto.message } });
    await this.audit.log(user.id, 'appeal.create', 'appeal', a.id, { kind: 'suspension' });
    await this.tell(user.id, 'suspension');
    return { id: a.id, state: a.state };
  }

  async mine(me: User, limitRaw?: string, cursorRaw?: string) {
    const page = await pageOf((a) => this.prisma.appeal.findMany({ ...a, include: { thread: { orderBy: { createdAt: 'asc' } } } }), { limit: pageLimit(limitRaw, 20), cursor: cursorRaw, where: { userId: me.id } });
    const photos = await this.proofs.idsFor('appealId', page.items.map((a) => a.id));
    return { items: page.items.map((a) => ({ ...this.dto(a), proofs: photos.get(a.id) ?? [], thread: a.thread.map((m) => ({ id: m.id, fromStaff: m.fromStaff, body: m.body, createdAt: m.createdAt })) })), nextCursor: page.nextCursor };
  }

  /** The person answers a question staff asked, while the appeal is still open. */
  async userReply(me: User, id: string, body: unknown) {
    const { message } = parse(replySchema, body);
    const a = await this.prisma.appeal.findUnique({ where: { id } });
    if (!a || a.userId !== me.id) throw E.notFound('Appeal');
    if (a.state !== 'open') throw E.conflict('APPEAL_DECIDED', 'This appeal was already decided');
    this.clean(message);
    const m = await this.prisma.appealMessage.create({ data: { appealId: id, fromStaff: false, authorId: me.id, body: message } });
    await this.audit.log(me.id, 'appeal.user_reply', 'appeal', id, { kind: a.kind });
    return { id: m.id };
  }

  /** Staff write to the person before deciding: to ask a question or say what is missing. The person is told. */
  async staffReply(actor: User, id: string, body: unknown) {
    const { message } = parse(replySchema, body);
    const a = await this.prisma.appeal.findUnique({ where: { id } });
    if (!a) throw E.notFound('Appeal');
    if (a.state !== 'open') throw E.conflict('APPEAL_DECIDED', 'This appeal was already decided');
    if (a.userId === actor.id) throw E.forbidden('OWN_APPEAL', 'You cannot answer your own appeal');
    if (a.kind === 'verification' && actor.role !== 'admin') throw E.forbidden('FORBIDDEN', 'Identity appeals are handled by an admin');
    if (a.kind === 'suspension') await this.regions.assertPersonHome(actor, a.userId);
    else await this.regions.assertPersonLocal(actor, a.userId);
    const m = await this.prisma.appealMessage.create({ data: { appealId: id, fromStaff: true, authorId: actor.id, body: message } });
    await this.audit.log(actor.id, 'appeal.reply', 'appeal', id, { kind: a.kind, userId: a.userId });
    const title = 'A moderator replied to your appeal';
    await this.notifications.notify(a.userId, 'appeal_reply', title, message, { appealId: id, ...(a.kind === 'report' && a.targetId ? { reportId: a.targetId } : {}) }).catch(() => undefined);
    if (a.kind === 'suspension') {
      // a suspended person cannot open the app: the question goes by email
      const u = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { email: true } });
      if (u) await this.email.send(u.email, title, message).catch(() => undefined);
    }
    return { id: m.id };
  }

  /** What the person sees: their words, the state and the moderator's note. Never who decided. */
  private dto(a: { id: string; kind: string; targetType: string | null; targetId: string | null; message: string; state: string; decision: string | null; createdAt: Date; decidedAt: Date | null }) {
    return { id: a.id, kind: a.kind, what: WORDS[a.kind] ?? a.kind, targetType: a.targetType, targetId: a.targetId, message: a.message, state: a.state, decision: a.decision, createdAt: a.createdAt, decidedAt: a.decidedAt };
  }

  // ---------------------------------------------------------------- staff
  async queue(actor: User, state: string, limitRaw?: string, cursorRaw?: string, pageRaw?: string) {
    const scope = await this.regions.scopeOf(actor);
    const size = pageLimit(limitRaw, 100, 200);
    const include = { thread: { orderBy: { createdAt: 'asc' as const } }, user: { select: { id: true, email: true, state: true, eligibility: true, profile: { select: { displayName: true } } } } };
    const where = { state, ...(scope && { user: this.regions.peopleWhere(scope) }) };
    // numbered pages ("Page 1 / 10"): newest first
    let paging: { page: number; pages: number; total: number; pageSize: number } | null = null;
    let found;
    if (pageRaw) {
      const pageSize = pageLimit(limitRaw, 20, 50);
      const total = await this.prisma.appeal.count({ where });
      const pages = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(pages, Math.max(1, Math.floor(Number(pageRaw)) || 1));
      const dir = 'desc'; // newest first, in every state
      found = { items: await this.prisma.appeal.findMany({ where, include, orderBy: [{ createdAt: dir }, { id: dir }], skip: (page - 1) * pageSize, take: pageSize }), nextCursor: null as string | null };
      paging = { page, pages, total, pageSize };
    } else {
      found = await pageOf((a) => this.prisma.appeal.findMany({ ...a, include }), { limit: size, cursor: cursorRaw, where, order: 'asc' });
    }
    const { items: rows, nextCursor } = found;
    const photos = await this.proofs.idsFor('appealId', rows.map((a) => a.id));
    return {
      nextCursor,
      ...(paging ?? {}),
      items: await Promise.all(
        rows.map(async (a) => ({
          ...this.dto(a),
          proofs: photos.get(a.id) ?? [],
          decidedBy: a.decidedBy,
          thread: a.thread.map((m) => ({ id: m.id, fromStaff: m.fromStaff, body: m.body, createdAt: m.createdAt })),
          user: { id: a.user.id, email: a.user.email, displayName: a.user.profile?.displayName ?? null, state: a.user.state, eligibility: a.user.eligibility },
          target: await this.targetInfo(a),
        })),
      ),
    };
  }

  private async targetInfo(a: { kind: string; targetType: string | null; targetId: string | null; userId: string }) {
    if (a.kind === 'verification' && a.targetId) {
      const c = await this.prisma.verificationCheck.findUnique({ where: { id: a.targetId }, select: { rejectionReason: true, method: true, decidedAt: true } });
      return c ? { reason: c.rejectionReason, method: c.method, decidedAt: c.decidedAt } : null;
    }
    if (a.kind === 'removal' && a.targetId) {
      const t = a.targetType === 'trip' ? await this.prisma.trip.findUnique({ where: { id: a.targetId }, select: { title: true } }) : await this.prisma.activity.findUnique({ where: { id: a.targetId }, select: { title: true } });
      return { type: a.targetType, title: t?.title ?? null };
    }
    if (a.kind === 'report' && a.targetId) {
      const r = await this.prisma.report.findUnique({ where: { id: a.targetId }, select: { category: true, targetType: true, resolution: true, assignedTo: true, details: true, status: true, createdAt: true, resolvedAt: true } });
      return r ? { reportCategory: r.category, reportAbout: r.targetType, decidedWith: r.resolution, reportDetails: r.details, reportStatus: r.status, reportedAt: r.createdAt, reportDecidedAt: r.resolvedAt } : null;
    }
    if (a.kind === 'warning' && a.targetId) {
      const w = await this.prisma.userWarning.findUnique({ where: { id: a.targetId }, select: { reason: true, createdAt: true } });
      return w ? { warning: w.reason, at: w.createdAt } : null;
    }
    if (a.kind === 'message' && a.targetId) {
      const m = await this.prisma.message.findUnique({ where: { id: a.targetId }, select: { body: true, removedReason: true } });
      return m ? { message: m.body, removedBecause: m.removedReason } : null;
    }
    if (a.kind === 'suspension') {
      const u = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { suspendedUntil: true } });
      return { suspendedUntil: u?.suspendedUntil ?? null };
    }
    return null;
  }

  async decide(actor: User, id: string, body: unknown) {
    const { decision, note } = parse(decisionSchema, body);
    const a = await this.prisma.appeal.findUnique({ where: { id } });
    if (!a) throw E.notFound('Appeal');
    if (a.state !== 'open') throw E.conflict('APPEAL_DECIDED', 'This appeal was already decided');
    if (a.userId === actor.id) throw E.forbidden('OWN_APPEAL', 'You cannot decide your own appeal');
    if (a.kind === 'verification' && actor.role !== 'admin') throw E.forbidden('FORBIDDEN', 'Identity appeals are decided by an admin');
    // staff decide appeals from people of their area (a suspension: only the staff of the person's home city); admins any
    if (a.kind === 'suspension') await this.regions.assertPersonHome(actor, a.userId);
    else await this.regions.assertPersonLocal(actor, a.userId);
    // a second pair of eyes: the person who made the decision does not review the appeal of it (an administrator may)
    const earlier =
      a.kind === 'report' ? (await this.prisma.report.findUnique({ where: { id: a.targetId ?? '' }, select: { assignedTo: true } }))?.assignedTo
      : a.kind === 'warning' ? (await this.prisma.userWarning.findUnique({ where: { id: a.targetId ?? '' }, select: { createdById: true } }))?.createdById
      : a.kind === 'message' ? (await this.prisma.message.findUnique({ where: { id: a.targetId ?? '' }, select: { removedBy: true } }))?.removedBy
      : null;
    if (earlier && earlier === actor.id && actor.role !== 'admin') throw E.forbidden('SECOND_REVIEWER', 'Another moderator has to review an appeal of your own decision');

    if (decision === 'uphold') {
      if (a.kind === 'verification') await this.verification.overturnRejection(actor, a.userId, note);
      else if (a.kind === 'suspension') {
        await this.prisma.user.update({ where: { id: a.userId }, data: { state: 'active', suspendedUntil: null } });
        await liftBans(this.prisma, a.userId);
      } else if (a.kind === 'removal' && a.targetId) await this.restoreListing(a.targetType, a.targetId);
      else if (a.kind === 'report' && a.targetId) {
        // back into the queue, unassigned, for another moderator
        await this.prisma.report.update({ where: { id: a.targetId }, data: { status: 'open', resolution: null, resolvedAt: null, assignedTo: null, reopenedAt: new Date(), escalatedAt: null } });
      } else if (a.kind === 'warning' && a.targetId) {
        const w = await this.prisma.userWarning.update({ where: { id: a.targetId }, data: { withdrawnAt: new Date() } });
        if (w.messageId) await this.prisma.message.updateMany({ where: { id: w.messageId, moderationState: 'removed' }, data: { moderationState: 'ok', removedBy: null, removedReason: null, removedAt: null } });
      } else if (a.kind === 'message' && a.targetId) {
        await this.prisma.message.updateMany({ where: { id: a.targetId, moderationState: 'removed' }, data: { moderationState: 'ok', removedBy: null, removedReason: null, removedAt: null } });
      }
    }
    const now = new Date();
    const claimed = await this.prisma.appeal.updateMany({ where: { id, state: 'open' }, data: { state: decision === 'uphold' ? 'upheld' : 'rejected', decidedBy: actor.id, decision: note, decidedAt: now } });
    if (claimed.count === 0) throw E.conflict('APPEAL_DECIDED', 'This appeal was already decided');
    await this.audit.log(actor.id, `appeal.${decision}`, 'appeal', id, { kind: a.kind, userId: a.userId, note });

    const word = WORDS[a.kind] ?? 'decision';
    const title = decision === 'uphold' ? 'Your appeal was accepted' : 'Your appeal was reviewed';
    const text = decision === 'uphold' ? `We changed our decision about your ${word}. ${note}` : `We looked again at your ${word} and it stands. ${note}`;
    await this.notifications.notify(a.userId, 'appeal_decided', title, text, { appealId: id, ...(a.kind === 'report' && a.targetId ? { reportId: a.targetId } : {}) });
    if (a.kind === 'suspension') {
      // a suspended person cannot open the app, so this one also goes by email
      const u = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { email: true } });
      if (u) await this.email.send(u.email, title, text).catch(() => undefined);
    }
    return { id, state: decision === 'uphold' ? 'upheld' : 'rejected' };
  }

  /** Puts a removed listing back, unless it is already over. */
  private async restoreListing(type: string | null, id: string) {
    if (type === 'trip') {
      const t = await this.prisma.trip.findUnique({ where: { id } });
      if (t && t.status === 'cancelled' && t.dateEnd > new Date()) await this.prisma.trip.update({ where: { id }, data: { status: 'published' } });
    } else {
      const a = await this.prisma.activity.findUnique({ where: { id } });
      if (a && a.status === 'cancelled' && a.endsAt > new Date()) await this.prisma.activity.update({ where: { id }, data: { status: 'published' } });
    }
  }
}

@Controller('v1')
export class AppealsController {
  constructor(private readonly appeals: AppealsService) {}

  @Post('me/appeals')
  create(@CurrentUser() me: User, @Body() body: unknown) {
    return this.appeals.create(me, body);
  }

  @Get('me/appeals')
  mine(@CurrentUser() me: User, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.appeals.mine(me, limit, cursor);
  }

  @Post('me/appeals/:id/reply')
  reply(@CurrentUser() me: User, @Param('id') id: string, @Body() body: unknown) {
    return this.appeals.userReply(me, id, body);
  }

  @Public()
  @Post('appeals/suspension')
  suspension(@Body() body: unknown, @Ip() ip: string) {
    return this.appeals.createSuspension(body, ip);
  }

  @Staff(...STAFF)
  @RegionalOk()
  @Perm('reports')
  @Get('admin/appeals')
  queue(@CurrentUser() actor: User, @Query('state') state = 'open', @Query('limit') limit?: string, @Query('cursor') cursor?: string, @Query('page') page?: string) {
    return this.appeals.queue(actor, ['open', 'upheld', 'rejected'].includes(state) ? state : 'open', limit, cursor, page);
  }

  @Staff(...STAFF)
  @RegionalOk()
  @Perm('reports')
  @Post('admin/appeals/:id/reply')
  staffReply(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    return this.appeals.staffReply(actor, id, body);
  }

  @Staff(...STAFF)
  @RegionalOk()
  @Perm('reports')
  @Post('admin/appeals/:id/decision')
  decide(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    return this.appeals.decide(actor, id, body);
  }
}
