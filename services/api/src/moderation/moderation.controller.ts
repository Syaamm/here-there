import { inScope, type Scope } from '../regions/regions';
import { Body, Controller, Get, Injectable, OnModuleDestroy, OnModuleInit, Param, Post, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { beforeKeyset, decodeKeyset, pageLimit, sliceKeyset } from '../common/paging';
import { CurrentUser, Public, Staff } from '../common/auth';
import { URGENT_CATEGORIES } from '../common/constants';
import { E } from '../common/errors';
import { JobsService } from '../common/jobs.service';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/validate';
import { NotificationsService } from '../notifications/notifications.service';
import { ReliabilityService } from '../reliability/reliability.controller';
import { OnCallService, SECOND_ESCALATION_HOURS } from './oncall';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const MOD = ['moderator', 'trust_lead', 'admin'];
const ALL = ['support', 'moderator', 'trust_lead', 'admin'];

/**
 * The moderation promise (spec 9.4, 12.2), in one place so the app, the admin console and the policy text never disagree.
 * Moderators review reports every day between these hours (Milan time); urgent reports are looked at first and, for
 * immediate danger, tell the staff at once whatever the time. A report that has waited longer than its answer time is
 * escalated to the trust leads and administrators.
 */
export const COVERAGE = { zone: 'Europe/Rome', open: 8, close: 22 };
export const ANSWER_WITHIN_HOURS = { urgent: 1, normal: 24 };
export const EMERGENCY_NUMBER = '112';

/** Is a moderator expected to be on duty at this moment? */
export function inCoverage(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: COVERAGE.zone }).format(now));
  return hour >= COVERAGE.open && hour < COVERAGE.close;
}

export function reportPolicy(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    coverage: { text: `Moderators review reports every day from ${pad(COVERAGE.open)}:00 to ${pad(COVERAGE.close)}:00 (Milan time).`, onDutyNow: inCoverage(now) },
    answerWithin: { urgent: `${ANSWER_WITHIN_HOURS.urgent} hour`, normal: `${ANSWER_WITHIN_HOURS.normal} hours` },
    emergency: { number: EMERGENCY_NUMBER, text: `If someone is in immediate danger, call ${EMERGENCY_NUMBER} (the European emergency number) first. Reports are not an emergency service.` },
  };
}

/**
 * The order staff work the queue in. Waiting reports first: urgent ones (the more levels they have been escalated, the
 * higher), then reports past their answer time (the one that has waited longest first), then age-related concerns, then the
 * rest by how soon they are due. Reports that are finished come last, newest first. The same input always gives the same order.
 */
export function orderQueue<T extends { id: string; open: boolean; priority: string; escalationLevel: number; escalated: boolean; overdue: boolean; category: string; createdAt: Date; answerBy: Date }>(items: T[]): T[] {
  const rank = (x: T) => (!x.open ? 4 : x.priority === 'urgent' ? 0 : x.escalated || x.overdue ? 1 : x.category === 'underage' ? 2 : 3);
  return [...items].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 4) return +b.createdAt - +a.createdAt || (a.id < b.id ? -1 : 1);
    if (ra === 0 && a.escalationLevel !== b.escalationLevel) return b.escalationLevel - a.escalationLevel;
    return +a.answerBy - +b.answerBy || +a.createdAt - +b.createdAt || (a.id < b.id ? -1 : 1);
  });
}

export const warnSchema = z.object({
  reason: z.string().trim().min(5, 'Say what the warning is about').max(500),
  reportId: z.string().optional(),
  messageId: z.string().optional(),
});
export const removeMessageSchema = z.object({ reason: z.string().trim().min(3).max(500) });

type Flag = { flag: boolean; reasons: string[]; warnings: number; reporters: number; suspensions: number };

/** Reports, messages and warnings: what staff see and can do, and the clock that keeps reports from waiting too long. */
@Injectable()
export class ModerationService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
    private readonly oncall: OnCallService,
    private readonly reliability: ReliabilityService,
  ) {}

  onModuleInit() {
    // every 5 minutes: an urgent report has one hour, so a 15-minute wait would let it slip by a quarter of its time
    this.jobs.every('moderation.escalate-overdue', 5 * 60_000, () => this.escalateOverdue());
  }

  onModuleDestroy() {}

  // ---------------------------------------------------------------- when a report comes in
  isUrgent(category: string) {
    return URGENT_CATEGORIES.includes(category);
  }

  /**
   * An immediate-danger report tells every moderator at once, in or out of coverage hours. Either kind of urgent report also
   * pages the people on call (push, email and text); a physical-safety report only when nobody is on duty.
   */
  async onReport(report: { id: string; category: string }) {
    await this.oncall.pageArrival(report, !inCoverage()).catch(() => undefined); // paging must never fail the report itself
    if (report.category !== 'immediate_danger') return;
    const staff = await this.prisma.user.findMany({ where: { role: { in: MOD }, state: 'active' }, select: { id: true } });
    await this.notifications.notifyMany(staff.map((s) => s.id), 'report_urgent', 'Urgent report: someone may be in danger', 'Open the reports queue now. This one is marked urgent.', { reportId: report.id });
    await this.audit.log(null, 'report.urgent_alerted', 'report', report.id, { staff: staff.length });
  }

  /** What the person who reported sees: where each report stands, in plain words (never the moderator's notes). */
  async mine(me: User, limitRaw?: string, cursorRaw?: string) {
    const limit = pageLimit(limitRaw, 20);
    const found = await this.prisma.report.findMany({ where: { reporterId: me.id, ...beforeKeyset(decodeKeyset(cursorRaw)) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
    const page = sliceKeyset(found, limit, (r) => r.createdAt);
    const rows = page.items;
    const appealed = new Set((await this.prisma.appeal.findMany({ where: { userId: me.id, kind: 'report', targetId: { in: rows.map((r) => r.id) } }, select: { targetId: true } })).map((a) => a.targetId));
    const words: Record<string, string> = { open: 'Waiting for a moderator', in_review: 'Being reviewed', resolved: 'We took action', dismissed: 'We found nothing to act on' };
    return {
      nextCursor: page.nextCursor,
      items: rows.map((r) => ({
        id: r.id,
        category: r.category,
        targetType: r.targetType,
        status: r.status,
        outcome: words[r.status] ?? r.status,
        createdAt: r.createdAt,
        canAppeal: r.status === 'dismissed' && !appealed.has(r.id),
      })),
    };
  }

  // ---------------------------------------------------------------- the queue
  /** Who a report is about, as a person: the user, the sender of a message, or the host of a listing. */
  private async targetUsers(reports: { id: string; targetType: string; targetId: string }[]) {
    const out = new Map<string, string | null>();
    const messages = reports.filter((r) => r.targetType === 'message').map((r) => r.targetId);
    const acts = reports.filter((r) => r.targetType === 'activity').map((r) => r.targetId);
    const trips = reports.filter((r) => r.targetType === 'trip').map((r) => r.targetId);
    const [m, a, t] = await Promise.all([
      messages.length ? this.prisma.message.findMany({ where: { id: { in: messages } }, select: { id: true, senderId: true } }) : [],
      acts.length ? this.prisma.activity.findMany({ where: { id: { in: acts } }, select: { id: true, hostId: true } }) : [],
      trips.length ? this.prisma.trip.findMany({ where: { id: { in: trips } }, select: { id: true, hostId: true } }) : [],
    ]);
    const who = new Map<string, string>([...m.map((x) => [x.id, x.senderId] as [string, string]), ...a.map((x) => [x.id, x.hostId] as [string, string]), ...t.map((x) => [x.id, x.hostId] as [string, string])]);
    for (const r of reports) out.set(r.id, r.targetType === 'user' ? r.targetId : (who.get(r.targetId) ?? null));
    return out;
  }

  /** Repeat-offender flag: earlier warnings, several different reporters lately, or an earlier suspension. */
  async offenderFlags(userIds: string[], now = new Date()): Promise<Map<string, Flag>> {
    const ids = [...new Set(userIds)];
    const out = new Map<string, Flag>(ids.map((id) => [id, { flag: false, reasons: [], warnings: 0, reporters: 0, suspensions: 0 }]));
    if (ids.length === 0) return out;
    const [warnings, recent, suspensions] = await Promise.all([
      this.prisma.userWarning.groupBy({ by: ['userId'], where: { userId: { in: ids }, withdrawnAt: null, createdAt: { gte: new Date(+now - 180 * DAY) } }, _count: { _all: true } }),
      this.prisma.report.findMany({ where: { status: { not: 'dismissed' }, createdAt: { gte: new Date(+now - 90 * DAY) } }, select: { id: true, targetType: true, targetId: true, reporterId: true } }),
      this.prisma.auditEvent.groupBy({ by: ['objectId'], where: { action: 'user.suspend', objectType: 'user', objectId: { in: ids } }, _count: { _all: true } }),
    ]);
    for (const w of warnings) out.get(w.userId)!.warnings = w._count._all;
    for (const s of suspensions) out.get(s.objectId)!.suspensions = s._count._all;
    const who = await this.targetUsers(recent);
    const reporters = new Map<string, Set<string>>();
    for (const r of recent) {
      const u = who.get(r.id);
      if (u && out.has(u)) reporters.set(u, (reporters.get(u) ?? new Set()).add(r.reporterId));
    }
    for (const [id, f] of out) {
      f.reporters = reporters.get(id)?.size ?? 0;
      if (f.warnings >= 2) f.reasons.push(`${f.warnings} warnings in the last 6 months`);
      if (f.reporters >= 3) f.reasons.push(`reported by ${f.reporters} different people in 90 days`);
      if (f.suspensions >= 1) f.reasons.push(f.suspensions === 1 ? 'suspended before' : `suspended ${f.suspensions} times before`);
      f.flag = f.reasons.length > 0;
    }
    return out;
  }

  /** The city each report belongs to (its person's home city, the activity's city, the trip's start city), for staff who look after one area. */
  async cityOfReports(reports: { id: string; targetType: string; targetId: string }[]): Promise<Map<string, string | null>> {
    const ids = (type: string) => reports.filter((r) => r.targetType === type).map((r) => r.targetId);
    const [users, acts, trips, msgs] = await Promise.all([
      this.prisma.profile.findMany({ where: { userId: { in: ids('user') } }, select: { userId: true, homeCityKey: true } }),
      this.prisma.activity.findMany({ where: { id: { in: ids('activity') } }, select: { id: true, cityKey: true } }),
      this.prisma.trip.findMany({ where: { id: { in: ids('trip') } }, select: { id: true, originKey: true } }),
      this.prisma.message.findMany({ where: { id: { in: ids('message') } }, select: { id: true, senderId: true } }),
    ]);
    const senders = await this.prisma.profile.findMany({ where: { userId: { in: msgs.map((m) => m.senderId) } }, select: { userId: true, homeCityKey: true } });
    const home = new Map([...users, ...senders].map((p) => [p.userId, p.homeCityKey]));
    const by = new Map<string, string | null>([
      ...users.map((u) => [`user:${u.userId}`, u.homeCityKey] as const),
      ...acts.map((a) => [`activity:${a.id}`, a.cityKey] as const),
      ...trips.map((t) => [`trip:${t.id}`, t.originKey] as const),
      ...msgs.map((m) => [`message:${m.id}`, home.get(m.senderId) ?? null] as const),
    ]);
    return new Map(reports.map((r) => [r.id, by.get(`${r.targetType}:${r.targetId}`) ?? null]));
  }

  /** Throws unless the report is about something in the staff member's area. */
  async assertReportInScope(scope: Scope | null, report: { id: string; targetType: string; targetId: string }) {
    if (!scope) return;
    if (!inScope(scope, (await this.cityOfReports([report])).get(report.id))) throw E.forbidden('OUT_OF_SCOPE', 'That is outside the area you look after');
  }

  async queue(status?: string, category?: string, now = new Date(), scope: Scope | null = null) {
    // Waiting reports (a status of open or in review): the oldest 500, PLUS every urgent or escalated one however new, so a long queue can never hide the
    // newest urgent report. Finished ones: the latest 200.
    const waiting = status === 'open' || status === 'in_review';
    const where = { ...(status && { status }), ...(category && { category }) };
    const include = { reporter: { select: { id: true, profile: { select: { displayName: true } } } } };
    const found = waiting
      ? await Promise.all([
          this.prisma.report.findMany({ where, orderBy: [{ createdAt: 'asc' }], take: 500, include }),
          this.prisma.report.findMany({
            where: { ...where, OR: [{ priority: 'urgent' }, { category: { in: URGENT_CATEGORIES } }, { escalationLevel: { gt: 0 } }] },
            orderBy: [{ createdAt: 'asc' }],
            take: 500,
            include,
          }),
        ]).then(([oldest, urgent]) => [...new Map([...oldest, ...urgent].map((r) => [r.id, r])).values()])
      : await this.prisma.report.findMany({ where, orderBy: [{ createdAt: 'desc' }], take: 200, include });
    // staff who look after one area see only the reports about it (a report about something no place covers is for the whole-service staff)
    const cities = scope ? await this.cityOfReports(found) : null;
    const rows = scope ? found.filter((r) => inScope(scope, cities!.get(r.id))) : found;
    const evidence = await this.reliability.hostAbsenceEvidence(rows.filter((r) => r.category === 'host_no_show'));
    const who = await this.targetUsers(rows);
    const subjects = [...new Set([...who.values()].filter((x): x is string => !!x))];
    const [flags, people, assignees, msgs] = await Promise.all([
      this.offenderFlags(subjects, now),
      this.prisma.user.findMany({ where: { id: { in: subjects } }, select: { id: true, state: true, profile: { select: { displayName: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.assignedTo).filter((x): x is string => !!x) } }, select: { id: true, profile: { select: { displayName: true } }, email: true } }),
      this.prisma.message.findMany({ where: { id: { in: rows.filter((r) => r.targetType === 'message').map((r) => r.targetId) } }, select: { id: true, body: true, moderationState: true, conversationId: true } }),
    ]);
    const person = new Map(people.map((p) => [p.id, p]));
    const assignee = new Map(assignees.map((a) => [a.id, a.profile?.displayName ?? a.email]));
    const message = new Map(msgs.map((m) => [m.id, m]));
    const items = rows.map((r) => {
      const open = ['open', 'in_review'].includes(r.status);
      const urgent = r.priority === 'urgent' || this.isUrgent(r.category);
      const ageHours = (+now - +r.createdAt) / HOUR;
      const subject = who.get(r.id) ?? null;
      const answerBy = new Date(+r.createdAt + (urgent ? ANSWER_WITHIN_HOURS.urgent : ANSWER_WITHIN_HOURS.normal) * HOUR);
      return {
        ...r,
        priority: urgent ? 'urgent' : 'normal',
        open,
        answerBy,
        evidence: evidence.get(r.id) ?? null,
        ageHours: Math.round(ageHours * 10) / 10,
        overdue: open && ageHours > (urgent ? ANSWER_WITHIN_HOURS.urgent : ANSWER_WITHIN_HOURS.normal),
        escalated: !!r.escalatedAt,
        assignedName: r.assignedTo ? (assignee.get(r.assignedTo) ?? 'A moderator') : null,
        subject: subject ? { userId: subject, displayName: person.get(subject)?.profile?.displayName ?? null, state: person.get(subject)?.state ?? null } : null,
        message: r.targetType === 'message' ? (message.get(r.targetId) ?? null) : null,
        repeatOffender: subject ? (flags.get(subject) ?? null) : null,
      };
    });
    return { items: orderQueue(items) };
  }

  /** Who is carrying what: each moderator's open reports, how long the oldest has waited, and what the queue looks like. */
  async workload(now = new Date()) {
    const mods = await this.prisma.user.findMany({ where: { role: { in: MOD }, state: 'active' }, select: { id: true, email: true, role: true, profile: { select: { displayName: true } } } });
    const open = await this.prisma.report.findMany({ where: { status: { in: ['open', 'in_review'] } }, select: { assignedTo: true, createdAt: true, status: true, category: true, priority: true } });
    const done = await this.prisma.report.groupBy({ by: ['assignedTo'], where: { status: { in: ['resolved', 'dismissed'] }, resolvedAt: { gte: new Date(+now - 7 * DAY) } }, _count: { _all: true } });
    const doneBy = new Map(done.map((d) => [d.assignedTo, d._count._all]));
    const slaOf = (r: { category: string; priority: string }) => (r.priority === 'urgent' || this.isUrgent(r.category) ? ANSWER_WITHIN_HOURS.urgent : ANSWER_WITHIN_HOURS.normal);
    const overdue = (r: (typeof open)[number]) => (+now - +r.createdAt) / HOUR > slaOf(r);
    const unassigned = open.filter((r) => !r.assignedTo);
    return {
      policy: reportPolicy(now),
      queue: { unassigned: unassigned.length, urgent: open.filter((r) => r.priority === 'urgent' || this.isUrgent(r.category)).length, overdue: open.filter(overdue).length, oldestUnassignedHours: unassigned.length ? Math.round(((+now - Math.min(...unassigned.map((r) => +r.createdAt))) / HOUR) * 10) / 10 : null },
      moderators: mods
        .map((m) => {
          const mine = open.filter((r) => r.assignedTo === m.id);
          return {
            id: m.id,
            name: m.profile?.displayName ?? m.email,
            role: m.role,
            assigned: mine.length,
            overdue: mine.filter(overdue).length,
            oldestHours: mine.length ? Math.round(((+now - Math.min(...mine.map((r) => +r.createdAt))) / HOUR) * 10) / 10 : null,
            resolvedLast7Days: doneBy.get(m.id) ?? 0,
          };
        })
        .sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name)),
    };
  }

  /**
   * What happens when nobody answers (the rules are written out in docs/compliance/oncall-process.md):
   *  - level 1, past its answer time (1 hour urgent, 24 hours otherwise): the trust leads and administrators are told, once.
   *    For an urgent report the people on call are paged too and the person who reported is told we have not answered yet.
   *  - level 2, urgent and still nobody has taken it after 2 hours: every administrator and the owner contact are paged.
   * Each level happens once per report. Returns how many reports moved up a level in this round.
   */
  async escalateOverdue(now = new Date()) {
    const open = await this.prisma.report.findMany({ where: { status: { in: ['open', 'in_review'] } } });
    let moved = 0;
    for (const r of open) {
      const urgent = r.priority === 'urgent' || this.isUrgent(r.category);
      const hours = (+now - +r.createdAt) / HOUR;
      const level = r.escalationLevel || (r.escalatedAt ? 1 : 0); // reports escalated before levels existed count as level 1
      const ageMinutes = Math.round(hours * 60);
      if (level < 1 && hours > (urgent ? ANSWER_WITHIN_HOURS.urgent : ANSWER_WITHIN_HOURS.normal)) {
        await this.prisma.report.update({ where: { id: r.id }, data: { escalatedAt: now, escalationLevel: 1 } });
        const seniors = await this.prisma.user.findMany({ where: { role: { in: ['trust_lead', 'admin'] }, state: 'active' }, select: { id: true } });
        if (urgent) await this.oncall.pageEscalation({ id: r.id, category: r.category, ageMinutes }, 1).catch(() => undefined);
        else await this.notifications.notifyMany(seniors.map((s) => s.id), 'report_escalated', 'A report is overdue', `A ${r.category.replace(/_/g, ' ')} report has waited longer than its answer time and has not been resolved.`, { reportId: r.id });
        if (urgent) {
          // the person who reported hears that we are late, and is reminded of the emergency number
          await this.notifications.notify(r.reporterId, 'report_update', 'We have not answered your report yet', `Your urgent report is still waiting and a senior member of staff has been told. If anyone is in danger right now, call ${EMERGENCY_NUMBER}.`, { reportId: r.id });
        }
        await this.audit.log(null, 'report.escalated', 'report', r.id, { category: r.category, level: 1, urgent });
        moved++;
      }
      // nobody has taken an urgent report in two hours: the last step
      if (urgent && level < 2 && !r.firstReviewedAt && hours > SECOND_ESCALATION_HOURS) {
        await this.prisma.report.update({ where: { id: r.id }, data: { escalationLevel: 2, ...(r.escalatedAt ? {} : { escalatedAt: now }) } });
        await this.oncall.pageEscalation({ id: r.id, category: r.category, ageMinutes }, 2).catch(() => undefined);
        await this.audit.log(null, 'report.escalated', 'report', r.id, { category: r.category, level: 2, urgent });
        if (level >= 1) moved++;
      }
    }
    return moved;
  }

  // ---------------------------------------------------------------- acting on a message or a person
  private async settleReports(actor: User, targetType: string, targetId: string, action: string) {
    const open = await this.prisma.report.findMany({ where: { targetType, targetId, status: { in: ['open', 'in_review'] } }, select: { id: true } });
    if (open.length === 0) return;
    const resolution = `Action taken: ${action}`;
    await this.prisma.report.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { status: 'resolved', resolution, assignedTo: actor.id, resolvedAt: new Date() } });
    for (const r of open) await this.audit.log(actor.id, 'report.resolved', 'report', r.id, { resolution, automatic: true });
  }

  /** A message with a little of what was said around it, for deciding a report about it. */
  async message(id: string) {
    const m = await this.prisma.message.findUnique({ where: { id }, include: { sender: { select: { id: true, profile: { select: { displayName: true } } } }, conversation: { select: { scopeType: true, tripId: true, activityId: true } } } });
    if (!m) throw E.notFound('Message');
    const around = await this.prisma.message.findMany({
      where: { conversationId: m.conversationId, createdAt: { gte: new Date(+m.createdAt - 30 * 60_000), lte: new Date(+m.createdAt + 30 * 60_000) } },
      orderBy: { createdAt: 'asc' },
      take: 12,
      include: { sender: { select: { id: true, profile: { select: { displayName: true } } } } },
    });
    return {
      id: m.id,
      body: m.body,
      state: m.moderationState,
      removedReason: m.removedReason,
      sentAt: m.createdAt,
      sender: { id: m.sender.id, displayName: m.sender.profile?.displayName ?? null },
      scope: m.conversation.scopeType,
      around: around.map((x) => ({ id: x.id, body: x.body, sentAt: x.createdAt, sender: x.sender.profile?.displayName ?? 'Member', state: x.moderationState, isThis: x.id === m.id })),
    };
  }

  /** Hides a message from the chat (kept for the record, so a report or an appeal can still look at it). The sender is told why. */
  async removeMessage(actor: User, id: string, body: unknown) {
    const { reason } = parse(removeMessageSchema, body);
    const m = await this.prisma.message.findUnique({ where: { id } });
    if (!m) throw E.notFound('Message');
    if (m.moderationState === 'removed') return { ok: true, state: 'removed' };
    await this.prisma.message.update({ where: { id }, data: { moderationState: 'removed', removedBy: actor.id, removedReason: reason, removedAt: new Date() } });
    await this.settleReports(actor, 'message', id, 'message removed');
    await this.audit.log(actor.id, 'message.removed', 'message', id, { reason, senderId: m.senderId });
    if (m.senderId !== actor.id) await this.notifications.notify(m.senderId, 'message_removed', 'A moderator removed a message', `Reason: ${reason}. If you think this was a mistake, you can ask for a review under Settings, Reviews of decisions.`, { messageId: id });
    return { ok: true, state: 'removed' };
  }

  async restoreMessage(actor: User, id: string) {
    const m = await this.prisma.message.findUnique({ where: { id } });
    if (!m) throw E.notFound('Message');
    if (m.moderationState !== 'removed') return { ok: true, state: m.moderationState };
    await this.prisma.message.update({ where: { id }, data: { moderationState: 'ok', removedBy: null, removedReason: null, removedAt: null } });
    await this.audit.log(actor.id, 'message.restored', 'message', id);
    return { ok: true, state: 'ok' };
  }

  /** A formal warning: the person is told what it is about, it can be appealed once, and it counts toward the repeat-offender flag. */
  async warn(actor: User, userId: string, body: unknown) {
    const dto = parse(warnSchema, body);
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.state === 'deleted') throw E.notFound('User');
    if (target.id === actor.id) throw E.badRequest('INVALID_TARGET', 'You cannot warn yourself');
    if (target.role !== 'user' && actor.role !== 'admin') throw E.forbidden('FORBIDDEN', 'Only admins can warn staff');
    const w = await this.prisma.userWarning.create({ data: { userId, reason: dto.reason, reportId: dto.reportId, messageId: dto.messageId, createdById: actor.id } });
    await this.notifications.notify(userId, 'warning', 'A moderator sent you a warning', `${dto.reason} If you think this is a mistake, you can ask for a review under Settings, Reviews of decisions.`, { warningId: w.id });
    await this.audit.log(actor.id, 'user.warned', 'user', userId, { warningId: w.id, reason: dto.reason, reportId: dto.reportId });
    if (dto.reportId) {
      const r = await this.prisma.report.findUnique({ where: { id: dto.reportId } });
      if (r && ['open', 'in_review'].includes(r.status)) {
        await this.prisma.report.update({ where: { id: r.id }, data: { status: 'resolved', resolution: 'Action taken: the person was warned', assignedTo: actor.id, resolvedAt: new Date() } });
        await this.audit.log(actor.id, 'report.resolved', 'report', r.id, { resolution: 'warned', automatic: true });
      }
    }
    const flag = (await this.offenderFlags([userId])).get(userId)!;
    return { id: w.id, warningsInLastSixMonths: flag.warnings, repeatOffender: flag };
  }

  /** A person's own warnings, for their data download and for the review screen. */
  async warningsFor(userId: string) {
    return this.prisma.userWarning.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async offenderFor(userId: string) {
    return (await this.offenderFlags([userId])).get(userId)!;
  }
}

@Controller('v1')
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  /** What a person is told about how reports are handled: hours, answer times and the emergency number. Public. */
  @Public()
  @Get('reports/policy')
  policy() {
    return reportPolicy();
  }

  @Get('me/reports')
  mine(@CurrentUser() me: User, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.moderation.mine(me, limit, cursor);
  }

  @Staff(...ALL)
  @Get('admin/reports/workload')
  workload() {
    return this.moderation.workload();
  }

  @Staff(...ALL)
  @Get('admin/messages/:id')
  message(@Param('id') id: string) {
    return this.moderation.message(id);
  }

  @Staff(...MOD)
  @Post('admin/messages/:id/remove')
  remove(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    return this.moderation.removeMessage(actor, id, body);
  }

  @Staff(...MOD)
  @Post('admin/messages/:id/restore')
  restore(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.moderation.restoreMessage(actor, id);
  }

  @Staff(...MOD)
  @Post('admin/users/:id/warn')
  warn(@CurrentUser() actor: User, @Param('id') id: string, @Body() body: unknown) {
    return this.moderation.warn(actor, id, body);
  }

  @Staff(...ALL)
  @Get('admin/users/:id/offender')
  offender(@Param('id') id: string) {
    return this.moderation.offenderFor(id);
  }
}
