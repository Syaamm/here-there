// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-safety.db';
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
  for (const f of ['test-p0-safety.db', 'test-p0-safety.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-safety.db', 'test-p0-safety.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('safety: blocks, reports, suspension, moderation', () => {
  it('blocking hides activities and prevents requests in both directions', async () => {
    const host = await verified('BHost');
    const u = await verified('Blocker');
    const id = (await post('/v1/activities', host.token, activityBody())).body.id;
    assert.equal((await post('/v1/blocks', u.token, { userId: host.id })).status, 201);
    assert.equal((await get('/v1/activities?city=milan', u.token)).body.items.some((x: any) => x.id === id), false);
    assert.equal((await get(`/v1/activities/${id}`, u.token)).status, 404);
    assert.equal((await post(`/v1/activities/${id}/requests`, u.token, {})).status, 404);
    // host (the blocked party) cannot discover the blocker's activities either
    const theirs = (await post('/v1/activities', u.token, activityBody({ title: 'Blocker meetup' }))).body.id;
    assert.equal((await get(`/v1/activities/${theirs}`, host.token)).status, 404);
    assert.equal((await call('DELETE', `/v1/blocks/${host.id}`, u.token)).status, 200);
  });

  it('routes reports into the moderation queue with audit logging', async () => {
    const host = await verified('Shady');
    const u = await verified('Reporter');
    const rep = await post('/v1/reports', u.token, { targetType: 'user', targetId: host.id, category: 'harassment', details: 'rude' });
    assert.equal(rep.status, 201);
    const queue = await get('/v1/admin/reports?status=open', adminToken);
    assert.ok(queue.body.items.some((r: any) => r.id === rep.body.id));
    assert.equal((await post(`/v1/admin/reports/${rep.body.id}/assign`, adminToken)).status, 201);
    assert.equal((await post(`/v1/admin/reports/${rep.body.id}/resolve`, adminToken, { status: 'resolved', resolution: 'warned' })).status, 201);
    // normal users cannot touch the queue
    assert.equal((await get('/v1/admin/reports', u.token)).status, 403);
    const audit = await get(`/v1/admin/audit?objectType=report&objectId=${rep.body.id}`, adminToken);
    assert.deepEqual(audit.body.items.map((e: any) => e.action).sort(), ['report.assign', 'report.resolved']);
  });

  it('suspension takes effect immediately on existing tokens', async () => {
    const u = await verified('Troll');
    assert.equal((await get('/v1/me', u.token)).status, 200);
    assert.equal((await post(`/v1/admin/users/${u.id}/suspend`, adminToken, { reason: 'abuse in chat' })).status, 201);
    const r = await get('/v1/me', u.token);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'ACCOUNT_SUSPENDED');
    assert.equal((await post('/v1/auth/login', undefined, { email: (await prisma.user.findUnique({ where: { id: u.id } })).email, password: 'a-long-password-1' })).status, 403);
  });

  it('rate limits chat for new accounts', async () => {
    limiter.reset();
    const host = await verified('ChatHost');
    const id = (await post('/v1/activities', host.token, activityBody())).body.id;
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post(`/v1/conversations/${conv.id}/messages`, host.token, { body: `m${i}` })).status);
    assert.equal(codes.filter((c) => c === 201).length, 10);
    assert.equal(codes[11], 429);
  });
});
