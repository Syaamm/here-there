// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-retention.db';
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
  for (const f of ['test-p0-retention.db', 'test-p0-retention.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-retention.db', 'test-p0-retention.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('retention: old data is purged on schedule', () => {
  const ago = (d: number) => new Date(Date.now() - d * 864e5);

  it('deletes what has outlived its period and keeps everything else, including reported messages', async () => {
    const { RetentionService } = await import('../src/retention/retention.service');
    const u = await signup('Retainer');
    const plan = (endedDaysAgo: number, title: string) =>
      prisma.activity.create({ data: { hostId: u.id, title, category: 'coffee', city: 'Oldtown', cityKey: 'oldtown', venueName: 'Somewhere', startsAt: ago(endedDaysAgo + 1), endsAt: ago(endedDaysAgo), capacity: 3, status: 'completed' } });
    const chat = async (activityId: string, body: string, sentDaysAgo: number) => {
      const conv = (await prisma.conversation.findUnique({ where: { activityId } })) ?? (await prisma.conversation.create({ data: { scopeType: 'activity', activityId } }));
      return prisma.message.create({ data: { conversationId: conv.id, senderId: u.id, body, createdAt: ago(sentDaysAgo) } });
    };
    const oldPlan = await plan(200, 'Old plan');
    const recentPlan = await plan(5, 'Recent plan');
    const oldMsg = await chat(oldPlan.id, 'plain old message', 199);
    const reportedMsg = await chat(oldPlan.id, 'reported old message', 199);
    const recentMsg = await chat(recentPlan.id, 'recent message', 4);
    await prisma.report.create({ data: { reporterId: u.id, targetType: 'message', targetId: reportedMsg.id, category: 'harassment' } });

    const note = (daysAgo: number, read: boolean, title: string) => prisma.notification.create({ data: { userId: u.id, type: 'x', title, body: 'b', createdAt: ago(daysAgo), readAt: read ? ago(daysAgo) : null } });
    await note(100, true, 'old read');
    await note(10, true, 'recent read');
    await note(300, false, 'unread but within a year');
    await note(400, false, 'unread and over a year');

    const rep = (status: string, closedDaysAgo: number | null, details: string) =>
      prisma.report.create({ data: { reporterId: u.id, targetType: 'user', targetId: u.id, category: 'spam', details, status, resolvedAt: closedDaysAgo === null ? null : ago(closedDaysAgo), createdAt: ago((closedDaysAgo ?? 800) + 1) } });
    await rep('resolved', 800, 'closed long ago');
    await rep('dismissed', 10, 'closed recently');
    await rep('open', null, 'still open and old');

    await prisma.auditEvent.create({ data: { actorId: u.id, action: 'old.thing', objectType: 'x', objectId: 'x', createdAt: ago(800) } });
    await prisma.auditEvent.create({ data: { actorId: u.id, action: 'recent.thing', objectType: 'x', objectId: 'x', createdAt: ago(5) } });
    await prisma.contactCode.create({ data: { userId: u.id, channel: 'email', codeHash: 'h', expiresAt: ago(30) } });
    await prisma.contactCode.create({ data: { userId: u.id, channel: 'email', codeHash: 'h2', expiresAt: new Date(Date.now() + 600000) } });
    // identity checks: an old result goes, but the newest check of the person always stays
    await prisma.verificationCheck.create({ data: { userId: u.id, providerRef: 'old1', eligibility: 'rejected', decidedAt: ago(500), createdAt: ago(501) } });
    const latestCheck = await prisma.verificationCheck.create({ data: { userId: u.id, providerRef: 'old2', eligibility: 'verified', decidedAt: ago(400), createdAt: ago(401) } });

    const counts = await app.get(RetentionService).runOnce();
    assert.equal(counts.messages, 1);
    assert.equal(await prisma.message.count({ where: { id: oldMsg.id } }), 0, 'an old, unreported message is gone');
    assert.equal(await prisma.message.count({ where: { id: reportedMsg.id } }), 1, 'a reported message stays');
    assert.equal(await prisma.message.count({ where: { id: recentMsg.id } }), 1, 'a recent chat is untouched');
    const titles = (await prisma.notification.findMany({ where: { userId: u.id, type: 'x' } })).map((n: { title: string }) => n.title).sort();
    assert.deepEqual(titles, ['recent read', 'unread but within a year']);
    const details = (await prisma.report.findMany({ where: { reporterId: u.id, targetType: 'user' } })).map((r: { details: string }) => r.details).sort();
    assert.deepEqual(details, ['closed recently', 'still open and old']);
    assert.equal(await prisma.auditEvent.count({ where: { action: 'old.thing' } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { action: 'recent.thing' } }), 1);
    assert.equal(await prisma.contactCode.count({ where: { userId: u.id, channel: 'email', codeHash: 'h' } }), 0);
    assert.equal(await prisma.contactCode.count({ where: { userId: u.id, channel: 'email', codeHash: 'h2' } }), 1);
    assert.equal(await prisma.verificationCheck.count({ where: { userId: u.id } }), 1);
    assert.equal((await prisma.verificationCheck.findFirst({ where: { userId: u.id } })).id, latestCheck.id);
    assert.ok(await prisma.auditEvent.findFirst({ where: { action: 'retention.purged' } }), 'the clean-up is itself recorded');

    // running it again finds nothing more to do
    const again = await app.get(RetentionService).runOnce();
    assert.deepEqual((Object.values(again) as number[]).filter((n) => n > 0), []);
  });

  it('publishes what is kept and for how long, in plain words, without signing in', async () => {
    const r = await get('/v1/retention');
    assert.equal(r.status, 200);
    const chat = r.body.items.find((x: { what: string }) => x.what === 'Group chat messages');
    assert.match(chat.kept, /3 months after the plan or trip ends/);
    assert.ok(r.body.items.find((x: { what: string }) => /audit/i.test(x.what)).kept.includes('2 years'));
    assert.ok(r.body.items.some((x: { what: string }) => /account details/i.test(x.what)));
  });
});
