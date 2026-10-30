// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-your-data.db';
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
  for (const f of ['test-p0-your-data.db', 'test-p0-your-data.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-your-data.db', 'test-p0-your-data.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('your data: export, a new email address, and deleting the account', () => {
  const mailTo = (email: string, subject: RegExp) => [...emailSvc.outbox].reverse().find((m: any) => m.to === email && subject.test(m.subject));

  it('exports everything held about you, and nothing about anyone else', async () => {
    const u = await verified('Exporter');
    const other = await verified('ExpOther');
    const plan = (await post('/v1/activities', u.token, activityBody({ title: 'Export plan', city: 'Exportville' }))).body;
    assert.equal((await post('/v1/follows', other.token, { userId: u.id })).status, 201);
    assert.equal((await post(`/v1/activities/${plan.id}/favorite`, u.token)).status < 300, true);
    const conv = await prisma.conversation.findUnique({ where: { activityId: plan.id } });
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, u.token, { body: 'hello from the exporter' })).status, 201);

    const ex = await exportOf(u);
    assert.equal(ex.body.format, 'herethere-export-v1');
    assert.equal(ex.body.account.email, u.email);
    assert.equal(ex.body.profile.displayName, 'Exporter');
    assert.deepEqual(ex.body.activities.hosted.map((a: { title: string }) => a.title), ['Export plan']);
    assert.equal(ex.body.favourites[0].title, 'Export plan');
    assert.equal(ex.body.messages.items[0].body, 'hello from the exporter');
    assert.equal(ex.body.followers[0].displayName, 'ExpOther');
    const text = JSON.stringify(ex.body);
    assert.ok(!text.includes('passwordHash') && !text.includes('$2'), 'no password material');
    assert.ok(!text.includes(other.email), 'nobody else has their email address in it');
    // one copy a day
    assert.equal((await post('/v1/me/export/zip-link', u.token, {})).status, 429);
  });

  it('changes the email address only after a code sent to the new address, and warns the old one', async () => {
    const u = await signup('Mover');
    const taken = await signup('Taken');
    const to = `moved${Date.now()}@example.com`;
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: to, password: 'wrong-password-1' })).body.code, 'WRONG_PASSWORD');
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: u.email, password: 'a-long-password-1' })).body.code, 'SAME_EMAIL');
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: taken.email, password: 'a-long-password-1' })).body.code, 'EMAIL_TAKEN');
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: to, password: 'a-long-password-1' })).status, 201);
    const code = /(\d{6})/.exec(mailTo(to, /Confirm your new/)!.text)![1];
    assert.equal((await get('/v1/me', u.token)).body.email, u.email, 'nothing changes until the code is entered');
    assert.equal((await post('/v1/me/email/change/confirm', u.token, { code: code === '000000' ? '111111' : '000000' })).body.code, 'INVALID_CODE');
    const done = await post('/v1/me/email/change/confirm', u.token, { code });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const me = await get('/v1/me', u.token);
    assert.equal(me.body.email, to);
    assert.equal(me.body.emailVerified, true);
    assert.ok(mailTo(u.email, /email address was changed/), 'the old address is told');
    assert.equal((await post('/v1/auth/login', undefined, { email: to, password: 'a-long-password-1' })).status, 201);
    assert.equal((await post('/v1/auth/login', undefined, { email: u.email, password: 'a-long-password-1' })).status, 401);
    assert.equal((await post('/v1/me/email/change/confirm', u.token, { code })).status, 400, 'a code works once');
  });

  it('deletes an account: leaves plans in order, erases what is personal, keeps reported messages, frees the email', async () => {
    const host = await verified('DelHost');
    const member = await verified('DelMember');
    const other = await verified('DelOther');
    // the leaver hosts a plan with a member in it, and is a member of someone else's plan
    const hostPlan = (await post('/v1/activities', host.token, activityBody({ title: 'Doomed plan', city: 'Delville', capacity: 3 }))).body;
    const joined = await post(`/v1/activities/${hostPlan.id}/requests`, member.token, {});
    await post(`/v1/activities/${hostPlan.id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    const otherPlan = (await post('/v1/activities', other.token, activityBody({ title: 'Someone elses plan', city: 'Delville', startsAt: hours(6), endsAt: hours(8), capacity: 3 }))).body;
    const asked = await post(`/v1/activities/${otherPlan.id}/requests`, host.token, {});
    await post(`/v1/activities/${otherPlan.id}/requests/${asked.body.id}/decision`, other.token, { decision: 'approve' });
    assert.equal((await get(`/v1/activities/${otherPlan.id}`, other.token)).body.going, 2);
    // chats, a favourite, follows, and one message that someone reported
    const c1 = await prisma.conversation.findUnique({ where: { activityId: hostPlan.id } });
    const c2 = await prisma.conversation.findUnique({ where: { activityId: otherPlan.id } });
    await post(`/v1/conversations/${c1.id}/messages`, host.token, { body: 'a private thought' });
    const kept = (await post(`/v1/conversations/${c2.id}/messages`, host.token, { body: 'something reported' })).body;
    assert.equal((await post('/v1/reports', other.token, { targetType: 'message', targetId: kept.id, category: 'harassment' })).status, 201);
    await post(`/v1/activities/${otherPlan.id}/favorite`, host.token);
    await post('/v1/follows', host.token, { userId: member.id });
    await post('/v1/follows', member.token, { userId: host.id });

    // refused without the right password or the word DELETE
    assert.equal((await post('/v1/me/delete', host.token, { password: 'wrong-password-1', confirm: 'DELETE' })).body.code, 'WRONG_PASSWORD');
    assert.equal((await post('/v1/me/delete', host.token, { password: 'a-long-password-1' })).status, 400);
    assert.equal((await post('/v1/me/delete', host.token, { password: 'a-long-password-1', confirm: 'delete' })).status, 400);
    const gone = await post('/v1/me/delete', host.token, { password: 'a-long-password-1', confirm: 'DELETE' });
    assert.equal(gone.status, 201, JSON.stringify(gone.body));

    // the sign-in, the password and the old address no longer lead anywhere
    assert.equal((await get('/v1/me', host.token)).status, 401);
    assert.equal((await post('/v1/auth/login', undefined, { email: host.email, password: 'a-long-password-1' })).status, 401);
    assert.ok(mailTo(host.email, /account was deleted/));
    // the plan they hosted is cancelled and the member told; they are out of the other plan, which is open again
    assert.equal((await get(`/v1/activities/${hostPlan.id}`, member.token)).body.status, 'cancelled');
    assert.ok((await get('/v1/notifications', member.token)).body.items.some((n: { type: string }) => n.type === 'activity_cancelled'));
    const after = (await get(`/v1/activities/${otherPlan.id}`, other.token)).body;
    assert.equal(after.going, 1);
    assert.ok(!after.participants.some((p: { id: string }) => p.id === host.id));
    // what was personal is gone; the bare row stays so other people's history still hangs together
    const row = await prisma.user.findUnique({ where: { id: host.id }, include: { profile: true } });
    assert.equal(row.state, 'deleted');
    assert.match(row.email, /^deleted-.*@deleted\.invalid$/);
    assert.equal(row.profile.displayName, 'Deleted user');
    assert.equal(row.phoneNumber, null);
    assert.equal(await prisma.follow.count({ where: { OR: [{ followerId: host.id }, { followingId: host.id }] } }), 0);
    assert.equal(await prisma.favorite.count({ where: { userId: host.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { userId: host.id } }), 0);
    assert.equal(await prisma.message.count({ where: { senderId: host.id, body: 'a private thought' } }), 0, 'their messages are erased');
    assert.equal(await prisma.message.count({ where: { id: kept.id } }), 1, 'a reported message stays for the moderators');
    assert.ok(await prisma.auditEvent.findFirst({ where: { actorId: host.id, action: 'account.deleted' } }));
    // the address can be used for a new account
    const again = await post('/v1/auth/register', undefined, { email: host.email, password: 'a-long-password-1', displayName: 'Back Again', adultConfirmed: true });
    assert.equal(again.status, 201, JSON.stringify(again.body));
  });

  it('does not let a staff account delete itself from the app', async () => {
    const s = await signup('StaffMember');
    await prisma.user.update({ where: { id: s.id }, data: { role: 'moderator' } });
    assert.equal((await post('/v1/me/delete', s.token, { password: 'a-long-password-1', confirm: 'DELETE' })).body.code, 'STAFF_ACCOUNT');
  });
});
