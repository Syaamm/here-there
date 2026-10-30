import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
let adminToken = '';
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600'; // a slow machine can take longer than the usual 15 minutes
  process.env.ON_CALL_OWNER_EMAIL = 'owner@example.com';
  process.env.ON_CALL_OWNER_PHONE = '+390000000000';
  h = await startHarness('oncall' + (process.env.TEST_DB_TAG ?? ''), { queueWrites: true });
  adminToken = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token;
});
after(async () => {
  await h?.stop();
  delete process.env.ON_CALL_OWNER_EMAIL;
  delete process.env.ON_CALL_OWNER_PHONE;
});

type Person = { token: string; id: string; email: string };
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const alerts = async (u: { token: string }, type: string) => (await h.get('/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === type);
const mails = () => (h.emailSvc.outbox as { to: string; subject: string; text: string }[]).slice();

async function staff(name: string, role = 'moderator'): Promise<Person> {
  const s = await h.verified(name);
  await h.prisma.user.update({ where: { id: s.id }, data: { role } });
  return s;
}
let n = 0;
/** A report about a fresh target, made through the API, then backdated to `ageMinutes`. */
async function report(category: string, ageMinutes: number, reporter?: Person) {
  const by = reporter ?? (await h.verified(`Rp${++n}`));
  const target = await h.verified(`Tg${++n}`);
  const r = await h.post('/v1/reports', by.token, { targetType: 'user', targetId: target.id, category, details: 'details' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await h.prisma.report.update({ where: { id: r.body.id }, data: { createdAt: minutesAgo(ageMinutes) } });
  return { id: r.body.id as string, reporter: by, target };
}
const queue = async (token = adminToken, qs = '?status=open') => (await h.get(`/v1/admin/reports${qs}`, token)).body.items as { id: string; priority: string; escalationLevel: number; overdue: boolean }[];

describe('the moderation queue is worked in a fixed order: urgency first, then how long it has waited', () => {
  it('orders by urgency, escalation level, answer time and age, the same way every time', async () => {
    const { orderQueue } = await import('../src/moderation/moderation.controller');
    const base = { open: true, escalated: false, overdue: false, escalationLevel: 0, priority: 'normal', category: 'spam' };
    const at = (minutes: number) => minutesAgo(minutes);
    const item = (id: string, over: Record<string, unknown>) => {
      const createdAt = (over.createdAt as Date) ?? at(10);
      const urgent = over.priority === 'urgent';
      return { id, ...base, createdAt, answerBy: new Date(+createdAt + (urgent ? 1 : 24) * 3600e3), ...over };
    };
    const items = [
      item('fresh-normal', { createdAt: at(5) }),
      item('old-overdue-normal', { createdAt: at(30 * 60), overdue: true, escalated: true }),
      item('fresh-urgent', { priority: 'urgent', createdAt: at(5), category: 'physical_safety' }),
      item('underage', { category: 'underage', createdAt: at(20) }),
      item('urgent-level-2', { priority: 'urgent', createdAt: at(130), escalationLevel: 2, escalated: true, overdue: true, category: 'immediate_danger' }),
      item('urgent-level-1', { priority: 'urgent', createdAt: at(70), escalationLevel: 1, escalated: true, overdue: true, category: 'immediate_danger' }),
      item('older-normal', { createdAt: at(600) }),
      item('closed-new', { open: false, createdAt: at(1) }),
      item('closed-old', { open: false, createdAt: at(5000) }),
      item('overdue-normal-2', { createdAt: at(26 * 60), overdue: true }),
    ];
    const order = orderQueue(items).map((x) => x.id);
    assert.deepEqual(order, [
      'urgent-level-2', // the most escalated urgent report first
      'urgent-level-1',
      'fresh-urgent', // any urgent report before anything that is not
      'old-overdue-normal', // then what is past its answer time, the one that has waited longest first
      'overdue-normal-2',
      'underage',
      'older-normal', // then by how soon it is due: the older one is due first
      'fresh-normal',
      'closed-new', // finished reports last, newest first
      'closed-old',
    ]);
    assert.deepEqual(orderQueue([...items].reverse()).map((x) => x.id), order, 'the input order makes no difference');
  });

  it('puts the newest urgent report at the top even when hundreds of older ones are waiting', async () => {
    // 520 waiting reports would have hidden the newest one before: only the oldest 200 were read
    const reporter = await h.verified('FloodReporter');
    const target = await h.verified('FloodTarget');
    await h.prisma.report.createMany({
      data: Array.from({ length: 510 }, (_, i) => ({ reporterId: reporter.id, targetType: 'user', targetId: target.id, category: 'spam', createdAt: minutesAgo(3000 + i) })),
    });
    const urgent = await report('immediate_danger', 0);
    const q = await queue();
    assert.equal(q[0].id, urgent.id, 'urgent first, found among 500+ waiting reports');
    assert.equal(q[0].priority, 'urgent');
    await h.prisma.report.deleteMany({ where: { reporterId: reporter.id } });
  });

  it('shows the real queue in that order through the console\'s own list', async () => {
    const mod = await staff('QueueMod');
    await h.prisma.report.updateMany({ where: { status: { in: ['open', 'in_review'] } }, data: { status: 'dismissed' } });
    const old = await report('spam', 25 * 60);
    const fresh = await report('spam', 5);
    const danger = await report('immediate_danger', 10);
    const safety = await report('physical_safety', 20);
    const q = await queue(mod.token);
    // the two urgent reports come first (the older one first, it is due first), then the overdue one, then the fresh one
    assert.deepEqual(q.slice(0, 4).map((x) => x.id), [safety.id, danger.id, old.id, fresh.id]);
    assert.equal(q[2].overdue, true);
    assert.equal(q[3].overdue, false);
  });
});

describe('when nobody answers: escalation, in steps, each once', () => {
  it('an urgent report nobody has taken goes up at 1 hour (on-call, seniors, the person who reported) and again at 2 hours (every administrator and the owner)', async () => {
    const { ModerationService } = await import('../src/moderation/moderation.controller');
    const svc = h.app.get(ModerationService);
    const lead = await staff('EscLead', 'trust_lead');
    const mod = await staff('EscMod');
    const reporter = await h.verified('EscUrgentReporter');
    const r = await report('immediate_danger', 20, reporter);

    // 20 minutes in: nothing happens yet
    assert.equal(await svc.escalateOverdue(), 0);
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 0);

    // 61 minutes: level 1
    await h.prisma.report.update({ where: { id: r.id }, data: { createdAt: minutesAgo(61) } });
    const before = mails().length;
    assert.ok((await svc.escalateOverdue()) >= 1);
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 1);
    assert.equal((await svc.escalateOverdue()), 0, 'level 1 happens once');
    const level1 = mails().slice(before);
    assert.ok(level1.some((m) => m.to === lead.email && /unanswered/i.test(m.subject)), 'the trust lead is emailed');
    assert.ok(level1.some((m) => m.to === 'admin@example.com'));
    assert.ok(!level1.some((m) => m.to === 'owner@example.com'), 'the owner is only for level 2');
    assert.ok(level1.every((m) => !/details/.test(m.text)), 'a page never carries what the report says');
    assert.ok((await alerts(lead, 'report_escalated')).length >= 1);
    // the person who reported hears that we are late, and the emergency number
    const told = (await alerts(reporter, 'report_update'))[0];
    assert.match(told.body, /112/);
    assert.match(told.title, /not answered/);

    // 121 minutes and still nobody has taken it: level 2, every administrator and the owner contact, marked critical
    await h.prisma.report.update({ where: { id: r.id }, data: { createdAt: minutesAgo(121) } });
    const before2 = mails().length;
    const texts = h.app.get((await import('../src/common/sms.service')).SmsService).outbox.length;
    await svc.escalateOverdue();
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 2);
    const level2 = mails().slice(before2);
    assert.ok(level2.some((m) => m.to === 'owner@example.com' && /CRITICAL/.test(m.subject)), 'the owner contact is told');
    assert.ok(level2.some((m) => m.to === 'admin@example.com' && /CRITICAL/.test(m.subject)));
    assert.ok(h.app.get((await import('../src/common/sms.service')).SmsService).outbox.length > texts, 'and the owner is texted');
    assert.equal(await svc.escalateOverdue(), 0, 'level 2 happens once');
    assert.equal((await h.prisma.auditEvent.count({ where: { action: 'report.escalated', objectId: r.id } })), 2, 'both steps are in the audit trail');
    // the queue shows the level
    assert.equal((await queue(mod.token)).find((x) => x.id === r.id)!.escalationLevel, 2);
  });

  it('does not go to level 2 once a moderator has taken the report, however long it then stays open', async () => {
    const { ModerationService } = await import('../src/moderation/moderation.controller');
    const svc = h.app.get(ModerationService);
    const mod = await staff('TakerMod');
    const r = await report('immediate_danger', 90);
    await svc.escalateOverdue(); // level 1
    assert.equal((await h.post(`/v1/admin/reports/${r.id}/assign`, mod.token)).status, 201);
    await h.prisma.report.update({ where: { id: r.id }, data: { createdAt: minutesAgo(300) } });
    const before = mails().length;
    await svc.escalateOverdue();
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 1);
    assert.ok(!mails().slice(before).some((m) => m.to === 'owner@example.com'));
  });

  it('a normal report goes up once, after a day, and never pages anyone or reaches level 2', async () => {
    const { ModerationService } = await import('../src/moderation/moderation.controller');
    const svc = h.app.get(ModerationService);
    const lead = await staff('NormalLead', 'trust_lead');
    const r = await report('harassment', 23 * 60);
    assert.equal((await svc.escalateOverdue()) >= 0, true);
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 0, 'not yet a day old');
    await h.prisma.report.update({ where: { id: r.id }, data: { createdAt: minutesAgo(25 * 60) } });
    const before = mails().length;
    await svc.escalateOverdue();
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 1);
    assert.ok((await alerts(lead, 'report_escalated')).length >= 1, 'the senior staff are told in the app');
    assert.equal(mails().length, before, 'no email or text for a normal report');
    assert.equal((await alerts(r.reporter, 'report_update')).length, 0, 'nor a message to the person who reported');
    await h.prisma.report.update({ where: { id: r.id }, data: { createdAt: minutesAgo(100 * 60) } });
    await svc.escalateOverdue();
    assert.equal((await h.prisma.report.findUnique({ where: { id: r.id } })).escalationLevel, 1, 'a normal report has no level 2');
  });
});

describe('the on-call rota', () => {
  it('pages the people on a shift (and nobody off shift) the moment an immediate-danger report arrives, by email and text', async () => {
    const { encryptField } = await import('../src/common/vault');
    const { SmsService } = await import('../src/common/sms.service');
    const onDuty = await staff('OnDutyMod');
    const offDuty = await staff('OffDutyMod');
    await h.prisma.user.update({ where: { id: onDuty.id }, data: { phoneNumber: encryptField('+39 333 000 1111'), phoneVerifiedAt: new Date() } });
    // a person who is not staff cannot be put on the rota, and a shift must make sense
    const plain = await h.verified('RotaPlain');
    const now = Date.now();
    const shift = (userId: string, startMin: number, endMin: number) => h.post('/v1/admin/oncall', adminToken, { userId, startsAt: new Date(now + startMin * 60_000), endsAt: new Date(now + endMin * 60_000) });
    assert.equal((await shift(plain.id, -10, 60)).body.code, 'INVALID_SHIFT');
    assert.equal((await shift(onDuty.id, 60, 30)).body.code, 'INVALID_SHIFT', 'ends before it starts');
    assert.equal((await shift(onDuty.id, 0, 60 * 24 * 15)).body.code, 'INVALID_SHIFT', 'longer than 14 days');
    assert.equal((await h.post('/v1/admin/oncall', onDuty.token, { userId: onDuty.id, startsAt: new Date(now), endsAt: new Date(now + 3600e3) })).status, 403, 'only administrators set the rota');
    const added = await shift(onDuty.id, -10, 240);
    assert.equal(added.status, 201, JSON.stringify(added.body));
    await shift(offDuty.id, 600, 900); // later today: not on call now

    const overview = (await h.get('/v1/admin/oncall', offDuty.token)).body;
    assert.equal(overview.fallback, false);
    assert.deepEqual(overview.now.map((p: { id: string }) => p.id), [onDuty.id]);
    assert.equal(overview.now[0].hasConfirmedPhone, true);
    assert.equal(overview.steps.length, 3);

    const before = mails().length;
    const sms = h.app.get(SmsService);
    const smsBefore = sms.outbox.length;
    const r = await report('immediate_danger', 0);
    const sent = mails().slice(before).filter((m) => /urgent report/i.test(m.subject)); // (sign-up codes for the people in the test are not pages)
    assert.deepEqual(sent.map((m) => m.to), [onDuty.email], 'only the person on call is emailed');
    assert.equal(sms.outbox.length - smsBefore, 1);
    assert.equal(sms.outbox[sms.outbox.length - 1].to, '+39 333 000 1111');
    assert.ok(!sent[0].text.includes('details'));
    assert.ok((await alerts(onDuty, 'report_urgent')).some((a: { data: { oncall?: boolean } }) => a.data.oncall), 'and told in the app as the person on call');
    const paged = await h.prisma.auditEvent.findFirst({ where: { action: 'report.oncall_paged', objectId: r.id } });
    assert.equal(JSON.parse(paged.metadata).fallback, false);

    // removing the shift: the next page falls back to the trust leads and administrators
    assert.equal((await h.call('DELETE', `/v1/admin/oncall/${added.body.id}`, adminToken)).status, 200);
    assert.equal((await h.call('DELETE', `/v1/admin/oncall/${added.body.id}`, adminToken)).status, 404);
    await h.prisma.onCallShift.deleteMany({});
    const fallback = (await h.get('/v1/admin/oncall', adminToken)).body;
    assert.equal(fallback.fallback, true);
    assert.ok(fallback.now.some((p: { role: string }) => p.role === 'admin'));
  });

  it('pages for a physical-safety report only when nobody is on duty, and never for an ordinary one', async () => {
    const { OnCallService } = await import('../src/moderation/oncall');
    const svc = h.app.get(OnCallService);
    assert.ok(await svc.pageArrival({ id: 'r1', category: 'physical_safety' }, true), 'out of hours');
    assert.equal(await svc.pageArrival({ id: 'r2', category: 'physical_safety' }, false), null, 'in hours the moderators are working');
    assert.equal(await svc.pageArrival({ id: 'r3', category: 'harassment' }, true), null);
    assert.ok(await svc.pageArrival({ id: 'r4', category: 'immediate_danger' }, false), 'immediate danger always');
  });
});
