// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-safety-chat.db';
process.env.VERIFICATION_MODE = 'manual';
process.env.REGISTER_LIMIT_PER_HOUR = '10000';
process.env.BCRYPT_ROUNDS = '4';
process.env.TRUST_PROXY = '1';
process.env.ACCESS_TOKEN_MINUTES = '600'; // a slow test run must not outlive the real 15-minute sign-in

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcryptjs';

const root = path.resolve(__dirname, '..', '..');
const prismaDir = path.join(root, 'prisma');
let base = '';
let app: any;
let prisma: any;
let limiter: any;
let emailSvc: any;
let smsSvc: any;
let verificationSvc: any;
let signSandbox: (raw: Buffer | string) => string;

type Res = { status: number; body: any };
async function call(method: string, url: string, token?: string, body?: unknown): Promise<Res> {
  const r = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}
const get = (u: string, t?: string) => call('GET', u, t);
const post = (u: string, t?: string, b: unknown = {}) => call('POST', u, t, b);

let n = 0;
async function signup(name: string) {
  const email = `${name}${++n}@example.com`.toLowerCase(); // the API normalises addresses to lower case
  const r = await post('/v1/auth/register', undefined, {
    email,
    password: 'a-long-password-1',
    displayName: name,
    homeCity: 'Milan',
    adultConfirmed: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.pending, true);
  // sign-up makes the account (email not yet confirmed); signing in gives the token, as for any returning person
  const l = await post('/v1/auth/login', undefined, { email, password: 'a-long-password-1' });
  assert.equal(l.status, 201, JSON.stringify(l.body));
  return { token: l.body.token as string, id: l.body.user.id as string, email };
}

/** The most recent 6-digit code "emailed" to this address (tests keep an in-memory outbox). */
function emailedCode(email: string): string {
  const mail = [...emailSvc.outbox].reverse().find((m: any) => m.to === email);
  assert.ok(mail, `an email was sent to ${email}`);
  return /(\d{6})/.exec(mail.text)![1];
}
async function confirmEmail(u: { token: string; email: string }) {
  const r = await post('/v1/me/email/verify', u.token, { code: emailedCode(u.email) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.emailVerified, true);
}

let adminToken = '';
async function verified(name: string) {
  const u = await signup(name);
  await confirmEmail(u);
  const s = await post('/v1/me/verification', u.token, { consent: true });
  assert.equal(s.body.eligibility, 'pending');
  const pending = await get('/v1/admin/verifications?status=pending', adminToken);
  const check = pending.body.items.find((c: any) => c.user.id === u.id);
  assert.ok(check, 'verification shows up in admin queue');
  const d = await post(`/v1/admin/verifications/${check.id}/decision`, adminToken, { decision: 'verified' });
  assert.equal(d.status, 201);
  return u;
}

const hours = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const activityBody = (over: Record<string, unknown> = {}) => ({
  title: 'After-work aperitivo',
  category: 'drinks',
  city: 'Milan',
  venueName: 'Bar Brera',
  lat: 45.472,
  lng: 9.188,
  startsAt: hours(1),
  endsAt: hours(3),
  capacity: 3,
  ...over,
});

before(async () => {
  for (const f of ['test-p0-safety-chat.db', 'test-p0-safety-chat.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
  execFileSync(process.execPath, [path.join(root, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'ignore',
  });
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { RateLimiter } = await import('../src/common/rate-limiter');
  const { EmailService } = await import('../src/common/email.service');
  const { SmsService } = await import('../src/common/sms.service');
  const { VerificationService } = await import('../src/verification/verification.service');
  ({ signSandbox } = await import('../src/verification/providers/sandbox.provider'));
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  prisma = app.get(PrismaService);
  limiter = app.get(RateLimiter);
  emailSvc = app.get(EmailService);
  smsSvc = app.get(SmsService);
  verificationSvc = app.get(VerificationService);
  await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: await bcrypt.hash('admin-password-1', 4),
      role: 'admin',
      adultConfirmed: true,
      eligibility: 'verified',
      profile: { create: { displayName: 'Admin' } },
    },
  });
  const login = await post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' });
  adminToken = login.body.token;
});

after(async () => {
  await app?.close();
  for (const f of ['test-p0-safety-chat.db', 'test-p0-safety-chat.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
});

/** Downloads the data ZIP the way the app does (signed link), and returns the JSON inside it with the README. */
async function exportOf(u: { token: string }, lang = 'en') {
  const link = await post('/v1/me/export/zip-link', u.token, { lang });
  assert.equal(link.status, 201, JSON.stringify(link.body));
  const res = await fetch(link.body.url.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'my-data.json']);
  return { status: 200, body: JSON.parse(strFromU8(files['my-data.json'])), readme: strFromU8(files['README.txt']) };
}

describe('safety: blocks in group chats, message actions, warnings, urgent reports, workload and appeals', () => {
  const staff = async (name: string, role = 'moderator') => {
    const s = await signup(name);
    await prisma.user.update({ where: { id: s.id }, data: { role } });
    return s;
  };
  const notified = async (u: { token: string }, type: string) => (await get('/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === type);
  const group = async (names: string[]) => {
    const host = await verified('GcHost');
    const members = [];
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 8, title: `Group ${n}` }))).body.id;
    for (const name of names) {
      const m = await verified(name);
      const r = await post(`/v1/activities/${id}/requests`, m.token, {});
      await post(`/v1/activities/${id}/requests/${r.body.id}/decision`, host.token, { decision: 'approve' });
      members.push(m);
    }
    const conv = (await get(`/v1/activities/${id}`, host.token)).body.conversationId as string;
    return { host, members, id, conv };
  };
  const say = (u: { token: string }, conv: string, body: string) => post(`/v1/conversations/${conv}/messages`, u.token, { body });
  const texts = async (u: { token: string }, conv: string) => (await get(`/v1/conversations/${conv}/messages`, u.token)).body.items.map((m: { body: string }) => m.body);

  it('keeps two people who blocked each other from seeing each other in a shared group chat', async () => {
    const { host, members: [b, c], conv } = await group(['GcB', 'GcC']);
    await say(host, conv, 'Hello everyone');
    await say(b, conv, 'B says hi');
    await say(c, conv, 'C says hi');
    assert.deepEqual(await texts(b, conv), ['Hello everyone', 'B says hi', 'C says hi']);
    assert.equal((await post('/v1/blocks', b.token, { userId: c.id })).status, 201);
    assert.deepEqual(await texts(b, conv), ['Hello everyone', 'B says hi'], 'B no longer sees C');
    assert.deepEqual(await texts(c, conv), ['Hello everyone', 'C says hi'], 'and C no longer sees B');
    assert.deepEqual(await texts(host, conv), ['Hello everyone', 'B says hi', 'C says hi'], 'everyone else sees both');
    // new messages too, and the group member list
    await say(c, conv, 'C again');
    await say(b, conv, 'B again');
    assert.equal((await texts(b, conv)).includes('C again'), false);
    assert.equal((await texts(c, conv)).includes('B again'), false);
    const info = (await get(`/v1/conversations/${conv}/info`, b.token)).body;
    assert.equal(info.members.some((m: { id: string }) => m.id === c.id), false);
    // chat alerts do not reach the blocked person either
    assert.equal((await notified(b, 'chat_message')).some((x: { body: string }) => x.body.includes('C again')), false);
    // unblocking brings them back
    await call('DELETE', `/v1/blocks/${c.id}`, b.token);
    assert.equal((await texts(b, conv)).includes('C again'), true);
  });

  it('treats a report of immediate danger as urgent: first in the queue, every moderator alerted, emergency number shown', async () => {
    const mod = await staff('UrgMod');
    const lead = await staff('UrgLead', 'trust_lead');
    const reporter = await verified('UrgReporter');
    const target = await verified('UrgTarget');
    const policy = await get('/v1/reports/policy');
    assert.equal(policy.status, 200, 'public');
    assert.equal(policy.body.emergency.number, '112');
    assert.match(policy.body.coverage.text, /every day from 08:00 to 22:00/);

    const normal = await post('/v1/reports', reporter.token, { targetType: 'user', targetId: target.id, category: 'spam', details: 'sends junk' });
    assert.equal(normal.body.priority, 'normal');
    assert.equal(normal.body.expectedWithin, '24 hours');
    const urgent = await post('/v1/reports', reporter.token, { targetType: 'user', targetId: target.id, category: 'immediate_danger', details: 'threatened me tonight' });
    assert.equal(urgent.status, 201, JSON.stringify(urgent.body));
    assert.deepEqual([urgent.body.priority, urgent.body.expectedWithin, urgent.body.emergency.number], ['urgent', '1 hour', '112']);
    assert.ok((await notified(mod, 'report_urgent')).length >= 1, 'moderators are told at once');
    assert.ok((await notified(lead, 'report_urgent')).length >= 1);

    const queue = (await get('/v1/admin/reports?status=open', mod.token)).body.items;
    assert.equal(queue[0].id, urgent.body.id, 'urgent first');
    assert.equal(queue[0].priority, 'urgent');
    assert.equal(queue[0].subject.userId, target.id);
    const mine = (await get('/v1/me/reports', reporter.token)).body.items;
    assert.deepEqual(mine.map((r: any) => r.outcome), ['Waiting for a moderator', 'Waiting for a moderator']);
  });

  it('escalates a report that waited past its answer time, once, and shows the workload', async () => {
    const { ModerationService } = await import('../src/moderation/moderation.controller');
    const mod = await staff('EscMod');
    const lead = await staff('EscLead', 'trust_lead');
    const reporter = await verified('EscReporter');
    const target = await verified('EscTarget');
    const fresh = (await post('/v1/reports', reporter.token, { targetType: 'user', targetId: target.id, category: 'harassment' })).body.id;
    const old = (await post('/v1/reports', reporter.token, { targetType: 'user', targetId: target.id, category: 'fraud' })).body.id;
    await prisma.report.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 30 * 3600 * 1000) } });
    const before = (await get('/v1/admin/reports?status=open', mod.token)).body.items;
    assert.equal(before.find((r: any) => r.id === old).overdue, true);
    assert.equal(before.find((r: any) => r.id === fresh).overdue, false);
    assert.ok((await app.get(ModerationService).escalateOverdue()) >= 1);
    assert.equal((await app.get(ModerationService).escalateOverdue()), 0, 'only once');
    assert.ok((await notified(lead, 'report_escalated')).length >= 1);
    assert.equal((await get('/v1/admin/reports?status=open', mod.token)).body.items.find((r: any) => r.id === old).escalated, true);

    await post(`/v1/admin/reports/${old}/assign`, mod.token);
    const w = (await get('/v1/admin/reports/workload', mod.token)).body;
    const me = w.moderators.find((m: any) => m.id === mod.id);
    assert.equal(me.assigned, 1);
    assert.equal(me.oldestHours >= 29, true);
    assert.equal(w.queue.unassigned >= 1, true);
    assert.equal(w.queue.overdue >= 1, true);
    assert.equal(w.policy.emergency.number, '112');
    assert.equal((await get('/v1/admin/reports/workload', reporter.token)).status, 403, 'staff only');
  });

  it('lets a moderator hide a reported message and warn the person, and flags repeat offenders', async () => {
    const mod = await staff('MsgMod');
    const { host, members: [bad, other], conv } = await group(['MsgBad', 'MsgOther']);
    const nasty = (await say(bad, conv, 'You are all boring people')).body.id;
    await say(other, conv, 'Let us keep going');
    const rep = (await post('/v1/reports', other.token, { targetType: 'message', targetId: nasty, category: 'harassment', details: 'rude' })).body.id;

    const seen = (await get(`/v1/admin/messages/${nasty}`, mod.token)).body;
    assert.equal(seen.body, 'You are all boring people');
    assert.equal(seen.around.length >= 2, true, 'the messages around it');
    assert.equal(seen.sender.id, bad.id);
    const item = (await get('/v1/admin/reports?status=open', mod.token)).body.items.find((r: any) => r.id === rep);
    assert.equal(item.message.body, 'You are all boring people');
    assert.equal(item.subject.userId, bad.id, 'the report is about the sender');

    assert.equal((await post(`/v1/admin/messages/${nasty}/remove`, other.token, { reason: 'nope' })).status, 403, 'staff only');
    assert.equal((await post(`/v1/admin/messages/${nasty}/remove`, mod.token, { reason: 'Insulting the group' })).status, 201);
    assert.equal((await texts(host, conv)).includes('You are all boring people'), false, 'gone from the chat');
    assert.equal((await texts(bad, conv)).includes('You are all boring people'), false);
    assert.equal((await prisma.report.findUnique({ where: { id: rep } })).status, 'resolved');
    assert.match((await notified(bad, 'message_removed'))[0].body, /Insulting the group/);
    assert.equal((await post(`/v1/admin/messages/${nasty}/restore`, mod.token)).body.state, 'ok');
    assert.equal((await texts(host, conv)).includes('You are all boring people'), true, 'restored');

    // warnings: the person is told; a second one makes a repeat offender
    const w1 = await post(`/v1/admin/users/${bad.id}/warn`, mod.token, { reason: 'Please keep chat friendly.' });
    assert.equal(w1.status, 201, JSON.stringify(w1.body));
    assert.equal(w1.body.repeatOffender.flag, false);
    assert.equal((await notified(bad, 'warning')).length, 1);
    assert.equal((await post(`/v1/admin/users/${bad.id}/warn`, mod.token, { reason: 'sh' })).status, 400, 'a real reason is needed');
    assert.equal((await post(`/v1/admin/users/${mod.id}/warn`, mod.token, { reason: 'Warning myself is silly' })).body.code, 'INVALID_TARGET');
    const w2 = await post(`/v1/admin/users/${bad.id}/warn`, mod.token, { reason: 'This is the second time this month.' });
    assert.equal(w2.body.repeatOffender.flag, true);
    assert.match(w2.body.repeatOffender.reasons[0], /2 warnings/);
    // a new report about this person arrives flagged
    const again = (await post('/v1/reports', other.token, { targetType: 'user', targetId: bad.id, category: 'harassment' })).body.id;
    const flagged = (await get('/v1/admin/reports?status=open', mod.token)).body.items.find((r: any) => r.id === again);
    assert.equal(flagged.repeatOffender.flag, true);
    assert.equal((await get(`/v1/admin/users/${bad.id}/offender`, mod.token)).body.warnings, 2);
    // warning with a report settles it
    const withReport = await post(`/v1/admin/users/${bad.id}/warn`, mod.token, { reason: 'Third warning, tied to a report.', reportId: again });
    assert.equal(withReport.status, 201);
    assert.equal((await prisma.report.findUnique({ where: { id: again } })).status, 'resolved');
    // included in the person data download
    const exported = (await exportOf(bad)).body;
    assert.equal(exported.warnings.length, 3);
  });

  it('lets people appeal a warning, a removed message and a dismissed report, with a second reviewer', async () => {
    const mod = await staff('ApMod');
    const mod2 = await staff('ApMod2');
    const { members: [bad, reporter], conv } = await group(['ApBad', 'ApReporter']);
    const msg = (await say(bad, conv, 'A harsh joke that was not meant badly')).body.id;
    await post(`/v1/admin/messages/${msg}/remove`, mod.token, { reason: 'Looked like an insult' });
    const warn = await post(`/v1/admin/users/${bad.id}/warn`, mod.token, { reason: 'Insulting the group.', messageId: msg });
    const text = 'It was a joke between friends and I have apologised.';

    // only the right person, only for what is theirs
    assert.equal((await post('/v1/me/appeals', reporter.token, { kind: 'warning', targetId: warn.body.id, message: text })).body.code, 'NOTHING_TO_APPEAL');
    assert.equal((await post('/v1/me/appeals', reporter.token, { kind: 'message', targetId: msg, message: text })).body.code, 'NOTHING_TO_APPEAL');
    const a1 = await post('/v1/me/appeals', bad.token, { kind: 'warning', targetId: warn.body.id, message: text });
    assert.equal(a1.status, 201, JSON.stringify(a1.body));
    // the moderator who warned cannot decide it, another can
    assert.equal((await post(`/v1/admin/appeals/${a1.body.id}/decision`, mod.token, { decision: 'uphold', note: 'Fine by me' })).body.code, 'SECOND_REVIEWER');
    const ok = await post(`/v1/admin/appeals/${a1.body.id}/decision`, mod2.token, { decision: 'uphold', note: 'We agree it was a joke.' });
    assert.equal(ok.body.state, 'upheld', JSON.stringify(ok.body));
    assert.equal((await get(`/v1/admin/users/${bad.id}/offender`, mod.token)).body.warnings, 0, 'the warning is withdrawn');
    assert.equal((await texts(reporter, conv)).includes('A harsh joke that was not meant badly'), true, 'and its message is back');
    assert.equal((await post('/v1/me/appeals', bad.token, { kind: 'warning', targetId: warn.body.id, message: text })).body.code, 'NOTHING_TO_APPEAL', 'a withdrawn warning cannot be appealed again');

    // a message removed on its own
    const msg2 = (await say(bad, conv, 'Another remark')).body.id;
    await post(`/v1/admin/messages/${msg2}/remove`, mod.token, { reason: 'Off topic' });
    const a2 = await post('/v1/me/appeals', bad.token, { kind: 'message', targetId: msg2, message: 'It was on topic, we were talking about the venue.' });
    assert.equal(a2.status, 201, JSON.stringify(a2.body));
    await post(`/v1/admin/appeals/${a2.body.id}/decision`, mod2.token, { decision: 'reject', note: 'It stays removed.' });
    assert.equal((await texts(reporter, conv)).includes('Another remark'), false);

    // a dismissed report: the reporter asks for a second look, and it goes back to the queue unassigned
    const rep = (await post('/v1/reports', reporter.token, { targetType: 'user', targetId: bad.id, category: 'harassment', details: 'again' })).body.id;
    assert.equal((await post('/v1/me/appeals', reporter.token, { kind: 'report', targetId: rep, message: 'Please look at this again.' })).body.code, 'NOTHING_TO_APPEAL', 'only dismissed reports');
    await post(`/v1/admin/reports/${rep}/resolve`, mod.token, { status: 'dismissed', resolution: 'Nothing found' });
    assert.equal((await get('/v1/me/reports', reporter.token)).body.items.find((r: any) => r.id === rep).canAppeal, true);
    assert.equal((await post('/v1/me/appeals', bad.token, { kind: 'report', targetId: rep, message: 'I am not the reporter at all.' })).body.code, 'NOTHING_TO_APPEAL');
    const a3 = await post('/v1/me/appeals', reporter.token, { kind: 'report', targetId: rep, message: 'There was more to it than the first review saw.' });
    assert.equal(a3.status, 201, JSON.stringify(a3.body));
    assert.equal((await post(`/v1/admin/appeals/${a3.body.id}/decision`, mod.token, { decision: 'uphold', note: 'x second look' })).body.code, 'SECOND_REVIEWER');
    assert.equal((await post(`/v1/admin/appeals/${a3.body.id}/decision`, mod2.token, { decision: 'uphold', note: 'Reopened for a fresh review.' })).body.state, 'upheld');
    const back = await prisma.report.findUnique({ where: { id: rep } });
    assert.deepEqual([back.status, back.assignedTo, !!back.reopenedAt], ['open', null, true]);
    assert.equal((await get('/v1/me/reports', reporter.token)).body.items.find((r: any) => r.id === rep).canAppeal, false);
  });
});
