// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-auth.db';
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
  for (const f of ['test-p0-auth.db', 'test-p0-auth.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-auth.db', 'test-p0-auth.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('auth, eligibility and verification', () => {
  it('requires 18+ confirmation to register', async () => {
    const r = await post('/v1/auth/register', undefined, {
      email: 'kid@example.com', password: 'a-long-password-1', displayName: 'Kid', adultConfirmed: false,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'VALIDATION_FAILED');
  });

  it('lets unverified users browse but not host or join', async () => {
    const u = await signup('Newbie');
    assert.equal((await get('/v1/activities?city=Milan', u.token)).status, 200);
    const create = await post('/v1/activities', u.token, activityBody());
    assert.equal(create.status, 403);
    assert.equal(create.body.code, 'VERIFICATION_REQUIRED');
  });

  it('rejects unauthenticated access and non-staff admin access', async () => {
    assert.equal((await get('/v1/activities')).status, 401);
    const u = await signup('Normie');
    assert.equal((await get('/v1/admin/users', u.token)).status, 403);
  });

  it('exposes no email or internal fields on public profiles', async () => {
    const u = await signup('Pub');
    const p = await get(`/v1/users/${u.id}`, u.token);
    assert.equal(p.status, 200);
    assert.equal(p.body.email, undefined);
    assert.equal(p.body.passwordHash, undefined);
  });

  it('sends a confirmation code at sign-up and only stores a hash of it', async () => {
    const u = await signup('Mailed');
    const me = await get('/v1/me', u.token);
    assert.equal(me.body.emailVerified, false);
    const code = emailedCode(u.email);
    assert.match(code, /^\d{6}$/);
    const row = await prisma.contactCode.findFirst({ where: { userId: u.id, channel: 'email' } });
    assert.notEqual(row.codeHash, code);
    assert.ok(!row.codeHash.includes(code), 'the code is not stored in the clear');
  });

  it('requires a confirmed email before identity verification, and guards the code', async () => {
    limiter.reset();
    const u = await signup('Mailer');
    const consent = { consent: true };
    // identity verification cannot start before the email is confirmed
    const early = await post('/v1/me/verification', u.token, consent);
    assert.equal(early.status, 403);
    assert.equal(early.body.code, 'EMAIL_NOT_VERIFIED');

    // malformed and wrong codes are rejected
    assert.equal((await post('/v1/me/email/verify', u.token, { code: 'abc' })).body.code, 'VALIDATION_FAILED');
    const real = emailedCode(u.email);
    const wrong = real === '000000' ? '111111' : '000000';
    const bad = await post('/v1/me/email/verify', u.token, { code: wrong });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_CODE');
    assert.equal(bad.body.details.attemptsLeft, 4);

    // a resend replaces the old code
    limiter.reset();
    assert.equal((await post('/v1/me/email/send-code', u.token)).status, 201);
    const fresh = emailedCode(u.email);
    if (fresh !== real) assert.equal((await post('/v1/me/email/verify', u.token, { code: real })).body.code, 'INVALID_CODE');
    // and the resend is rate limited (one every 30 seconds)
    assert.equal((await post('/v1/me/email/send-code', u.token)).status, 429);

    // the right code confirms the email, then identity verification can start
    await confirmEmail({ token: u.token, email: u.email });
    assert.equal((await get('/v1/me', u.token)).body.emailVerified, true);
    assert.equal((await post('/v1/me/verification', u.token, consent)).body.eligibility, 'pending');
    const audit = await get(`/v1/admin/audit?objectType=user&objectId=${u.id}`, adminToken);
    assert.ok(audit.body.items.some((e: any) => e.action === 'email.verified'));
  });

  it('locks a code after five wrong attempts', async () => {
    limiter.reset();
    const u = await signup('Guesser');
    const real = emailedCode(u.email);
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await post('/v1/me/email/verify', u.token, { code: wrong })).body.code, 'INVALID_CODE');
    // the 6th try is refused even with the correct code
    assert.equal((await post('/v1/me/email/verify', u.token, { code: real })).body.code, 'TOO_MANY_ATTEMPTS');
    assert.equal((await get('/v1/me', u.token)).body.emailVerified, false);
  });

  it('needs explicit, recorded consent before an identity + facial check can start', async () => {
    const u = await signup('Consenter');
    await confirmEmail(u);
    const none = await post('/v1/me/verification', u.token, {});
    assert.equal(none.status, 400);
    assert.equal(none.body.code, 'CONSENT_REQUIRED');
    assert.equal((await post('/v1/me/verification', u.token, { consent: 'yes' })).body.code, 'CONSENT_REQUIRED');
    assert.equal((await get('/v1/me', u.token)).body.eligibility, 'unverified'); // nothing started yet

    const ok = await post('/v1/me/verification', u.token, { consent: true });
    assert.equal(ok.body.eligibility, 'pending');
    const st = await get('/v1/me/verification', u.token);
    assert.equal(st.body.eligibility, 'pending');
    assert.equal(st.body.mode, 'manual');
    const check = await prisma.verificationCheck.findFirst({ where: { userId: u.id } });
    assert.ok(check.consentAt, 'consent timestamp is stored');
    const audit = await get(`/v1/admin/audit?objectType=user&objectId=${u.id}`, adminToken);
    assert.ok(audit.body.items.some((e: any) => e.action === 'verification.consent_given'));
  });

  it('lets unverified users explore but not host, join or chat', async () => {
    const host = await verified('ExploreHost');
    const created = await post('/v1/activities', host.token, activityBody());
    const id = created.body.id;
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });

    const lurker = await signup('Lurker');
    // explore: allowed
    assert.equal((await get('/v1/activities?city=milan', lurker.token)).status, 200);
    assert.equal((await get(`/v1/activities/${id}`, lurker.token)).status, 200);
    assert.equal((await get('/v1/trips', lurker.token)).status, 200);
    // host / join: blocked
    assert.equal((await post('/v1/activities', lurker.token, activityBody())).body.code, 'VERIFICATION_REQUIRED');
    assert.equal((await post(`/v1/activities/${id}/requests`, lurker.token, {})).body.code, 'VERIFICATION_REQUIRED');
    // chat: blocked
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, lurker.token)).body.code, 'VERIFICATION_REQUIRED');
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, lurker.token, { body: 'hi' })).body.code, 'VERIFICATION_REQUIRED');
  });

  it('keeps the group and the activity together: leave one, leave both; cancelled activities end their chat', async () => {
    const host = await verified('TogetherHost');
    const a = await verified('TogetherA');
    const b = await verified('TogetherB');
    const id = (await post('/v1/activities', host.token, activityBody())).body.id;
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    for (const u of [a, b]) {
      const req = await post(`/v1/activities/${id}/requests`, u.token, {});
      await post(`/v1/activities/${id}/requests/${req.body.id}/decision`, host.token, { decision: 'approve' });
    }
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, a.token, { body: 'hi all' })).status, 201);

    // leaving the activity also takes you out of the group: no chat, not in the member list, not in your chats
    assert.equal((await post(`/v1/activities/${id}/leave`, a.token)).status, 201);
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a.token)).status, 403);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, a.token, { body: 'let me back' })).status, 403);
    assert.equal((await get('/v1/me/conversations', a.token)).body.items.length, 0);
    const names = (await get(`/v1/conversations/${conv.id}/info`, b.token)).body.members.map((m: any) => m.displayName);
    assert.deepEqual(names, ['TogetherHost', 'TogetherB']);

    // the host cancels: the chat ends for everyone left, even though they are still listed as members of the activity
    assert.equal((await post(`/v1/activities/${id}/cancel`, host.token)).status, 201);
    const gone = await get(`/v1/conversations/${conv.id}/messages`, b.token);
    assert.deepEqual([gone.body.ended, gone.body.writable, gone.body.items.length], [true, false, 0]);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, b.token, { body: 'anyone?' })).status, 409);
    assert.equal((await get('/v1/me/conversations', b.token)).body.items.length, 0);
    assert.equal((await get('/v1/me/conversations', host.token)).body.items.length, 0);
  });

  it('cuts chat access the moment an approved member stops being verified', async () => {
    const host = await verified('RevokeHost');
    const member = await verified('RevokeMember');
    const id = (await post('/v1/activities', host.token, activityBody())).body.id;
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    const req = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${req.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, member.token, { body: 'hello' })).status, 201);

    // group info: the host is first and marked as host; the member sees both, an outsider sees nothing
    const info = await get(`/v1/conversations/${conv.id}/info`, member.token);
    assert.equal(info.status, 200);
    assert.deepEqual(info.body.members.map((m: any) => [m.displayName, m.role, m.isMe]), [['RevokeHost', 'host', false], ['RevokeMember', 'member', true]]);
    assert.equal(info.body.scope, 'activity');
    const outsider = await verified('RevokeOutsider');
    assert.equal((await get(`/v1/conversations/${conv.id}/info`, outsider.token)).status, 403);

    await prisma.user.update({ where: { id: member.id }, data: { eligibility: 'rejected' } });
    const r = await get(`/v1/conversations/${conv.id}/messages`, member.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'VERIFICATION_REQUIRED');
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, member.token, { body: 'still here?' })).status, 403);
  });
});
