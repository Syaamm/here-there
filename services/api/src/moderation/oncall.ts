import { Body, Controller, Delete, Get, Injectable, Param, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Staff } from '../common/auth';
import { EmailService } from '../common/email.service';
import { E } from '../common/errors';
import { log } from '../common/observability';
import { PrismaService } from '../common/prisma.service';
import { SmsService } from '../common/sms.service';
import { decryptField } from '../common/vault';
import { parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';

const HOUR = 3600 * 1000;
const MOD = ['moderator', 'trust_lead', 'admin'];
const ALL = ['support', 'moderator', 'trust_lead', 'admin'];

/**
 * The on-call process for urgent reports, as code. The people and the times are the owner's decision (see
 * docs/compliance/oncall-process.md); this file only carries out what is written there.
 *
 *   0 minutes   immediate danger: every moderator is alerted in the app, and the on-call people by push, email and text.
 *               physical safety: the same, but only when nobody is on duty (outside coverage hours).
 *   1 hour      nobody has answered: trust leads and administrators are alerted too, and the person who reported is told
 *               we have not answered yet (and to call 112 if anyone is in danger).
 *   2 hours     still nobody has taken it: every administrator and the owner contact are alerted by every channel.
 *
 * "Answered" means a moderator took the report (assigned it to themselves). If nobody is on a shift, the trust leads and
 * administrators are on call.
 */
export const ESCALATION_STEPS = [
  { afterMinutes: 0, who: 'Every moderator (in the app); the people on call by push, email and text', when: 'Immediate danger at any hour; physical safety only outside coverage hours' },
  { afterMinutes: 60, who: 'Trust leads, administrators and the people on call, by every channel; the person who reported is told we have not answered yet', when: 'Nobody has taken an urgent report' },
  { afterMinutes: 120, who: 'Every administrator and the owner contact (ON_CALL_OWNER_EMAIL, ON_CALL_OWNER_PHONE), by every channel, marked critical', when: 'Still nobody has taken it' },
] as const;
export const SECOND_ESCALATION_HOURS = 2;

export type Paged = { id: string; category: string; ageMinutes?: number };
type Person = { id: string; email: string; role: string; phoneNumber: string | null; phoneVerifiedAt: Date | null; profile: { displayName: string } | null };

export const shiftSchema = z.object({
  userId: z.string().min(1),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  note: z.string().trim().max(200).optional(),
});

@Injectable()
export class OnCallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
  ) {}

  private select = { id: true, email: true, role: true, phoneNumber: true, phoneVerifiedAt: true, profile: { select: { displayName: true } } } as const;

  /** Who is on call right now: the people whose shift covers this moment; with no shift, the trust leads and administrators. */
  async current(now = new Date()): Promise<{ people: Person[]; fallback: boolean }> {
    const shifts = await this.prisma.onCallShift.findMany({ where: { startsAt: { lte: now }, endsAt: { gt: now }, user: { state: 'active', role: { in: MOD } } }, include: { user: { select: this.select } } });
    const people = [...new Map(shifts.map((s) => [s.user.id, s.user as Person])).values()];
    if (people.length) return { people, fallback: false };
    return { people: await this.prisma.user.findMany({ where: { role: { in: ['trust_lead', 'admin'] }, state: 'active' }, select: this.select }), fallback: true };
  }

  private async admins(): Promise<Person[]> {
    return this.prisma.user.findMany({ where: { role: 'admin', state: 'active' }, select: this.select });
  }

  /** One short message to a person's email and (if they confirmed a number) phone. It never carries what the report says. */
  private async reach(people: Person[], subject: string, text: string) {
    const sent = { email: 0, sms: 0 };
    for (const p of people) {
      try {
        await this.email.send(p.email, subject, text);
        sent.email++;
      } catch (e) {
        log('warn', 'on-call email failed', { userId: p.id, error: (e as Error).message });
      }
      if (p.phoneNumber && p.phoneVerifiedAt) {
        try {
          await this.sms.send(decryptField(p.phoneNumber), `${subject}. ${text}`.slice(0, 300));
          sent.sms++;
        } catch (e) {
          log('warn', 'on-call text failed', { userId: p.id, error: (e as Error).message });
        }
      }
    }
    return sent;
  }

  private link() {
    return process.env.ADMIN_URL ? `${process.env.ADMIN_URL.replace(/\/$/, '')}/reports` : 'the admin console, Reports';
  }

  /** The first page: when an urgent report arrives (see the steps above). */
  async pageArrival(report: Paged, outOfHours: boolean) {
    if (report.category !== 'immediate_danger' && !(report.category === 'physical_safety' && outOfHours)) return null;
    const { people, fallback } = await this.current();
    const label = report.category === 'immediate_danger' ? 'someone may be in danger' : 'a physical safety concern';
    await this.notifications.notifyMany(people.map((p) => p.id), 'report_urgent', `Urgent report: ${label}`, 'You are on call. Open the reports queue now.', { reportId: report.id, oncall: true });
    const sent = await this.reach(people, 'HERE & THERE: urgent report', `An urgent report is waiting (${label}). Please open ${this.link()} and take it.`);
    await this.audit.log(null, 'report.oncall_paged', 'report', report.id, { level: 0, people: people.length, fallback, ...sent });
    return { people: people.length, fallback, ...sent };
  }

  /** Level 1 (answer time passed) or 2 (nobody took it after two hours): who is told, and by what, grows each time. */
  async pageEscalation(report: Paged, level: 1 | 2) {
    const { people } = await this.current();
    const admins = await this.admins();
    const seniors = await this.prisma.user.findMany({ where: { role: { in: ['trust_lead', 'admin'] }, state: 'active' }, select: this.select });
    const targets = level === 1 ? [...people, ...seniors] : [...people, ...seniors, ...admins];
    const unique = [...new Map(targets.map((p) => [p.id, p])).values()];
    const minutes = report.ageMinutes ?? (level === 1 ? 60 : 120);
    const critical = level === 2;
    await this.notifications.notifyMany(unique.map((p) => p.id), 'report_escalated', critical ? 'CRITICAL: nobody has answered an urgent report' : 'An urgent report has not been answered', `An urgent report has waited about ${minutes} minutes and nobody has taken it.`, { reportId: report.id, level, oncall: true });
    const sent = await this.reach(unique, critical ? 'HERE & THERE: CRITICAL urgent report unanswered' : 'HERE & THERE: urgent report unanswered', `An urgent report has waited about ${minutes} minutes and nobody has taken it. Please open ${this.link()} now.`);
    // the owner contact is the last resort at level 2: an address and number that are not tied to one person's shift
    const ownerEmail = process.env.ON_CALL_OWNER_EMAIL;
    const ownerPhone = process.env.ON_CALL_OWNER_PHONE;
    if (critical && (ownerEmail || ownerPhone)) {
      const text = `CRITICAL: an urgent report has been waiting about ${minutes} minutes and nobody has taken it. Open ${this.link()}.`;
      if (ownerEmail) await this.email.send(ownerEmail, 'HERE & THERE: CRITICAL urgent report unanswered', text).catch((e) => log('warn', 'owner email failed', { error: (e as Error).message }));
      if (ownerPhone) await this.sms.send(ownerPhone, text).catch((e) => log('warn', 'owner text failed', { error: (e as Error).message }));
    }
    await this.audit.log(null, 'report.oncall_paged', 'report', report.id, { level, people: unique.length, owner: critical && !!(ownerEmail || ownerPhone), ...sent });
    return { people: unique.length, ...sent };
  }

  // ---------------------------------------------------------------- the rota
  async overview(now = new Date()) {
    const { people, fallback } = await this.current(now);
    const shifts = await this.prisma.onCallShift.findMany({ where: { endsAt: { gt: new Date(+now - 24 * HOUR) } }, orderBy: { startsAt: 'asc' }, take: 100, include: { user: { select: { id: true, email: true, profile: { select: { displayName: true } } } } } });
    return {
      now: people.map((p) => ({ id: p.id, name: p.profile?.displayName ?? p.email, role: p.role, hasConfirmedPhone: !!(p.phoneNumber && p.phoneVerifiedAt) })),
      fallback,
      shifts: shifts.map((s) => ({ id: s.id, userId: s.userId, name: s.user.profile?.displayName ?? s.user.email, startsAt: s.startsAt, endsAt: s.endsAt, note: s.note })),
      steps: ESCALATION_STEPS,
      ownerContactSet: !!(process.env.ON_CALL_OWNER_EMAIL || process.env.ON_CALL_OWNER_PHONE),
    };
  }

  async addShift(actor: User, body: unknown) {
    const dto = parse(shiftSchema, body);
    if (+dto.endsAt <= +dto.startsAt) throw E.badRequest('INVALID_SHIFT', 'A shift must end after it starts');
    if (+dto.endsAt - +dto.startsAt > 14 * 24 * HOUR) throw E.badRequest('INVALID_SHIFT', 'A shift can be at most 14 days long');
    const who = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!who || who.state !== 'active' || !MOD.includes(who.role)) throw E.badRequest('INVALID_SHIFT', 'Only an active moderator, trust lead or administrator can be on call');
    const s = await this.prisma.onCallShift.create({ data: { userId: dto.userId, startsAt: dto.startsAt, endsAt: dto.endsAt, note: dto.note || null, createdBy: actor.id } });
    await this.audit.log(actor.id, 'oncall.shift_added', 'user', dto.userId, { shiftId: s.id, startsAt: dto.startsAt, endsAt: dto.endsAt });
    return { id: s.id };
  }

  async removeShift(actor: User, id: string) {
    const s = await this.prisma.onCallShift.findUnique({ where: { id } });
    if (!s) throw E.notFound('Shift');
    await this.prisma.onCallShift.delete({ where: { id } });
    await this.audit.log(actor.id, 'oncall.shift_removed', 'user', s.userId, { shiftId: id });
    return { ok: true };
  }
}

@Controller('v1/admin/oncall')
export class OnCallController {
  constructor(private readonly oncall: OnCallService) {}

  /** Who is on call now, the coming shifts, and the steps taken when an urgent report is not answered. */
  @Staff(...ALL)
  @Get()
  overview() {
    return this.oncall.overview();
  }

  @Staff('admin')
  @Post()
  add(@CurrentUser() actor: User, @Body() body: unknown) {
    return this.oncall.addShift(actor, body);
  }

  @Staff('admin')
  @Delete(':id')
  remove(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.oncall.removeShift(actor, id);
  }
}
