import { Body, Controller, Get, Injectable, Ip, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { beforeKeyset, decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { CurrentUser, Public, Staff } from '../common/auth';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { liftBans } from '../common/identity';
import { PrismaService } from '../common/prisma.service';
import { RateLimiter } from '../common/rate-limiter';
import { contentProblem, parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { VerificationService } from '../verification/verification.service';

const messageSchema = z.string().trim().min(10, 'Please say a little more (at least a sentence)').max(1000);
const createSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('verification'), message: messageSchema }),
  z.object({ kind: z.literal('removal'), targetType: z.enum(['activity', 'trip']), targetId: z.string().min(1), message: messageSchema }),
  z.object({ kind: z.literal('report'), targetId: z.string().min(1), message: messageSchema }),
  z.object({ kind: z.literal('warning'), targetId: z.string().min(1), message: messageSchema }),
  z.object({ kind: z.literal('message'), targetId: z.string().min(1), message: messageSchema }),
]);
const suspensionSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), message: messageSchema });
const decisionSchema = z.object({ decision: z.enum(['uphold', 'reject']), note: z.string().trim().min(3, 'Write a short note the person will see').max(500) });

const STAFF = ['moderator', 'trust_lead', 'admin'];
/** After a suspension appeal the person may ask again no sooner than this. */
const SUSPENSION_COOLDOWN_DAYS = 30;

const WORDS: Record<string, string> = { verification: 'identity check', suspension: 'suspension', removal: 'removed listing', report: 'report that was dismissed', warning: 'warning', message: 'removed message' };

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
  ) {}

  private clean(message: string) {
    const bad = contentProblem(message);
    if (bad) throw E.badRequest('CONTENT_REJECTED', bad);
    return message;
  }

  async create(me: User, body: unknown) {
    const dto = parse(createSchema, body);
    this.clean(dto.message);
    this.limiter.hit(`appeal:${me.id}`, 5, 24 * 3600 * 1000);
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
      // the person who reported can ask for a second look when the report was dismissed
      const rep = await this.prisma.report.findUnique({ where: { id: dto.targetId } });
      if (!rep || rep.reporterId !== me.id || rep.status !== 'dismissed') throw E.conflict('NOTHING_TO_APPEAL', 'Only a report of yours that was dismissed can be appealed');
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
    await this.audit.log(me.id, 'appeal.create', 'appeal', a.id, { kind: dto.kind });
    return this.dto(a);
  }

  /** A suspended person cannot sign in, so this one proves who they are with their email and password instead. */
  async createSuspension(body: unknown, ip: string) {
    const dto = parse(suspensionSchema, body);
    this.limiter.hit(`appeal-suspension:${ip}:${dto.email}`, 10, 15 * 60 * 1000);
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw E.unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect');
    if (user.state !== 'suspended') throw E.conflict('NOTHING_TO_APPEAL', 'This account is not suspended');
    this.clean(dto.message);
    if (await this.prisma.appeal.findFirst({ where: { userId: user.id, kind: 'suspension', state: 'open' } })) throw E.conflict('APPEAL_OPEN', 'You already have an appeal waiting for a decision');
    const since = new Date(Date.now() - SUSPENSION_COOLDOWN_DAYS * 86_400_000);
    if (await this.prisma.appeal.findFirst({ where: { userId: user.id, kind: 'suspension', createdAt: { gt: since } } }))
      throw E.conflict('ALREADY_APPEALED', `You can appeal a suspension once every ${SUSPENSION_COOLDOWN_DAYS} days`);
    const a = await this.prisma.appeal.create({ data: { userId: user.id, kind: 'suspension', message: dto.message } });
    await this.audit.log(user.id, 'appeal.create', 'appeal', a.id, { kind: 'suspension' });
    return { id: a.id, state: a.state };
  }

  async mine(me: User, limitRaw?: string, cursorRaw?: string) {
    const limit = pageLimit(limitRaw, 20);
    const found = await this.prisma.appeal.findMany({ where: { userId: me.id, ...beforeKeyset(decodeKeyset(cursorRaw)) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = sliceKeyset(found, limit, (a) => a.createdAt);
    return { items: page.items.map((a) => this.dto(a)), nextCursor: page.nextCursor };
  }

  /** What the person sees: their words, the state and the moderator's note. Never who decided. */
  private dto(a: { id: string; kind: string; targetType: string | null; targetId: string | null; message: string; state: string; decision: string | null; createdAt: Date; decidedAt: Date | null }) {
    return { id: a.id, kind: a.kind, what: WORDS[a.kind] ?? a.kind, targetType: a.targetType, targetId: a.targetId, message: a.message, state: a.state, decision: a.decision, createdAt: a.createdAt, decidedAt: a.decidedAt };
  }

  // ---------------------------------------------------------------- staff
  async queue(state: string) {
    const rows = await this.prisma.appeal.findMany({
      where: { state },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { user: { select: { id: true, email: true, state: true, eligibility: true, profile: { select: { displayName: true } } } } },
    });
    return {
      items: await Promise.all(
        rows.map(async (a) => ({
          ...this.dto(a),
          decidedBy: a.decidedBy,
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
      const r = await this.prisma.report.findUnique({ where: { id: a.targetId }, select: { category: true, targetType: true, resolution: true, assignedTo: true } });
      return r ? { reportCategory: r.category, reportAbout: r.targetType, dismissedWith: r.resolution } : null;
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
    if (a.kind === 'verification' && !['trust_lead', 'admin'].includes(actor.role)) throw E.forbidden('FORBIDDEN', 'Identity appeals are decided by the trust team');
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
    await this.notifications.notify(a.userId, 'appeal_decided', title, text);
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

  @Public()
  @Post('appeals/suspension')
  suspension(@Body() body: unknown, @Ip() ip: string) {
    return this.appeals.createSuspension(body, ip);
  }

  @Staff(...STAFF)
  @Get('admin/appeals')
  queue(@Query('state') state = 'open') {
    return this.appeals.queue(['open', 'upheld', 'rejected'].includes(state) ? state : 'open');
  }

  @Staff(...STAFF)
  @Post('admin/appeals/:id/decision')
  decide(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    return this.appeals.decide(actor, id, body);
  }
}
