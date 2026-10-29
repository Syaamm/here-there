import { TtlCache } from '../common/ttl-cache';
import { Controller, Get, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { Public } from '../common/auth';
import { PrismaService } from '../common/prisma.service';

const DAY = 24 * 3600 * 1000;
const days = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * How long each kind of data is kept. One place, so the clean-up, the tests and the text people read in the app can never
 * disagree. Every period can be changed with an environment variable (the number of days).
 */
export const retention = () => ({
  chat: days('RETENTION_CHAT_DAYS', 90), // messages, counted from the end of the plan or trip
  alertsRead: days('RETENTION_ALERTS_READ_DAYS', 90),
  alertsUnread: days('RETENTION_ALERTS_UNREAD_DAYS', 365),
  reports: days('RETENTION_REPORTS_DAYS', 730), // closed reports, counted from the day they were closed
  audit: days('RETENTION_AUDIT_DAYS', 730),
  identityChecks: days('RETENTION_IDENTITY_CHECKS_DAYS', 365), // older results, counted from the decision
  codes: days('RETENTION_CODES_DAYS', 7), // used or expired email, phone and password codes
  drafts: days('RETENTION_DRAFTS_DAYS', 90), // saved-for-later activities and trips, counted from the last change
  matching: days('RETENTION_MATCHING_DAYS', 90), // travel-matching answers and finished matching wishes, counted from the last change; match-chat messages from when they were sent
  appeals: days('RETENTION_APPEALS_DAYS', 730), // decided appeals, counted from the decision
  reliability: days('RETENTION_RELIABILITY_DAYS', 730), // no-show notes and level history, counted from the plan's end / the change
});

/** The same periods, in plain words, for the app. */
export function retentionSchedule() {
  const r = retention();
  const d = (n: number) => (n % 365 === 0 ? `${n / 365} ${n === 365 ? 'year' : 'years'}` : n % 30 === 0 ? `${n / 30} months` : `${n} days`);
  return [
    { what: 'Group chat messages', kept: `${d(r.chat)} after the plan or trip ends`, why: 'So you can still look back at what was agreed. Messages that someone reported are kept until that report is closed and has aged out.' },
    { what: 'Alerts', kept: `${d(r.alertsRead)} once read, ${d(r.alertsUnread)} if never read`, why: 'They are only there to tell you something happened.' },
    { what: 'Safety reports', kept: `${d(r.reports)} after they are closed (open ones are kept until they are dealt with)`, why: 'So moderators can see repeat problems and defend their decisions.' },
    { what: 'Records of actions on the platform (audit log)', kept: d(r.audit), why: 'Security and accountability. They hold ids and actions, not message text.' },
    { what: 'Identity check results', kept: `${d(r.identityChecks)} after the decision; only the outcome, never your documents or face`, why: 'To show a check was done and when it expires.' },
    { what: 'Warnings from moderators', kept: d(r.audit), why: 'So staff can see repeat problems and a warning can be reviewed if you ask.' },
    { what: 'Drafts (activities and trips you saved for later)', kept: `${d(r.drafts)} after you last changed them`, why: 'So you can finish them; they are private to you and never shown to anyone.' },
    { what: 'Travel matching (where and when you want to travel, and your yes or pass answers)', kept: `${d(r.matching)} after the last change, or as soon as your dates have passed`, why: 'Only used to suggest travelers to each other. You can switch it off any time.' },
    { what: 'Messages in a private travel-match chat', kept: `${d(r.matching)} after they were sent`, why: 'So the two of you can look back while planning.' },
    { what: 'Appeals', kept: `${d(r.appeals)} after the decision`, why: 'So staff can show how a decision was reviewed.' },
    { what: 'Reliability history', kept: d(r.reliability), why: 'Used to work out your level.' },
    { what: 'Sign-in and confirmation codes', kept: `${d(r.codes)} after they are used or expire`, why: 'Short-lived by design.' },
    { what: 'Plans and trips, and who joined them', kept: 'Kept as history (a deleted account is shown as "Deleted user")', why: 'Other people\'s plans and chats depend on them.' },
    { what: 'Your account details', kept: 'Until you delete your account; then they are erased straight away', why: 'You can download or delete them at any time under Settings, Your data.' },
  ];
}

/** Deletes data that has outlived its period. Runs once a day, and can be run on demand (tests, support). */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.RETENTION_ENABLED === 'false') return;
    const run = () => void this.runOnce().catch((e) => console.error('Retention clean-up failed:', e?.message ?? e));
    setTimeout(run, 60_000).unref(); // a minute after start, then daily
    this.timer = setInterval(run, DAY);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(now = new Date()) {
    const r = retention();
    const ago = (n: number) => new Date(+now - n * DAY);

    // chat: finished plans and trips, except messages a safety report still points at
    const reported = (await this.prisma.report.findMany({ where: { targetType: 'message' }, select: { targetId: true } })).map((x) => x.targetId);
    const messages = await this.prisma.message.deleteMany({
      where: {
        id: { notIn: reported },
        conversation: { OR: [{ activity: { endsAt: { lt: ago(r.chat) } } }, { trip: { dateEnd: { lt: ago(r.chat) } } }] },
      },
    });
    const alertsRead = await this.prisma.notification.deleteMany({ where: { readAt: { not: null, lt: ago(r.alertsRead) } } });
    const alertsUnread = await this.prisma.notification.deleteMany({ where: { readAt: null, createdAt: { lt: ago(r.alertsUnread) } } });
    const reports = await this.prisma.report.deleteMany({ where: { status: { in: ['resolved', 'dismissed'] }, resolvedAt: { lt: ago(r.reports) } } });
    const audit = await this.prisma.auditEvent.deleteMany({ where: { createdAt: { lt: ago(r.audit) } } });
    const marks = await this.prisma.attendanceMark.deleteMany({ where: { planEndsAt: { lt: ago(r.reliability) }, state: { not: 'disputed' } } });
    const levelHistory = await this.prisma.reliabilityChange.deleteMany({ where: { createdAt: { lt: ago(r.reliability) } } });
    const matchWishes = await this.prisma.travelMatchPref.deleteMany({ where: { OR: [{ updatedAt: { lt: ago(r.matching) } }, { dateEnd: { lt: new Date(+now - DAY) } }] } });
    const matchAnswers = await this.prisma.travelMatchChoice.deleteMany({ where: { createdAt: { lt: ago(r.matching) } } });
    const matchMessages = await this.prisma.message.deleteMany({ where: { id: { notIn: reported }, conversation: { scopeType: 'match' }, createdAt: { lt: ago(r.matching) } } });
    const warnings = await this.prisma.userWarning.deleteMany({ where: { createdAt: { lt: ago(r.audit) } } });
    const drafts = await this.prisma.draft.deleteMany({ where: { updatedAt: { lt: ago(r.drafts) } } });
    const appeals = await this.prisma.appeal.deleteMany({ where: { state: { not: 'open' }, decidedAt: { lt: ago(r.appeals) } } });
    const codes = await this.prisma.contactCode.deleteMany({ where: { OR: [{ usedAt: { lt: ago(r.codes) } }, { expiresAt: { lt: ago(r.codes) } }] } });

    // identity checks: old results go, but the newest check of each person stays (it is what their status rests on)
    const old = await this.prisma.verificationCheck.findMany({ where: { decidedAt: { lt: ago(r.identityChecks) } }, select: { id: true, userId: true } });
    let checks = 0;
    if (old.length) {
      const newest = new Map<string, string>();
      for (const u of new Set(old.map((c) => c.userId))) {
        const latest = await this.prisma.verificationCheck.findFirst({ where: { userId: u }, orderBy: { createdAt: 'desc' }, select: { id: true } });
        if (latest) newest.set(u, latest.id);
      }
      const doomed = old.filter((c) => newest.get(c.userId) !== c.id).map((c) => c.id);
      checks = (await this.prisma.verificationCheck.deleteMany({ where: { id: { in: doomed } } })).count;
    }

    const counts = { messages: messages.count, alertsRead: alertsRead.count, alertsUnread: alertsUnread.count, reports: reports.count, audit: audit.count, identityChecks: checks, codes: codes.count, attendanceNotes: marks.count, drafts: drafts.count, warnings: warnings.count, matching: matchWishes.count + matchAnswers.count, matchMessages: matchMessages.count, appeals: appeals.count, levelHistory: levelHistory.count };
    if (Object.values(counts).some((n) => n > 0)) await this.audit.log(null, 'retention.purged', 'system', 'retention', counts);
    return counts;
  }
}

const schedule = new TtlCache<{ items: ReturnType<typeof retentionSchedule> }>(60_000, 1); // public text, read by every app start

@Controller('v1')
export class RetentionController {
  /** What is kept and for how long, in plain words. Public: it is part of the privacy information. */
  @Public()
  @Get('retention')
  schedule() {
    return schedule.get('all', () => ({ items: retentionSchedule() }));
  }
}
