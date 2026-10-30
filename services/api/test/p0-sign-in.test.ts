// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-sign-in.db';
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
  for (const f of ['test-p0-sign-in.db', 'test-p0-sign-in.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-sign-in.db', 'test-p0-sign-in.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('sign-in protection, proxies and the seed script', () => {
  const tryLogin = async (ip: string, email: string, password: string) => {
    const r = await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ email, password }) });
    return { status: r.status, body: await r.json() };
  };

  it('stops a guessing attack on one account even when it comes from many addresses, and keeps other accounts open', async () => {
    limiter.reset();
    const target = await signup('Guarded');
    const other = await signup('Bystander');
    // 20 wrong guesses, each from a different address: the per-address limit never trips, the per-account one counts them all
    for (let i = 1; i <= 20; i++) assert.equal((await tryLogin(`10.0.0.${i}`, target.email, 'not-the-password')).body.code, 'INVALID_CREDENTIALS');
    // now even the right password from a fresh address has to wait
    assert.equal((await tryLogin('10.0.1.1', target.email, 'a-long-password-1')).body.code, 'RATE_LIMITED');
    // someone else is not affected
    assert.equal((await tryLogin('10.0.1.1', other.email, 'a-long-password-1')).status, 201);
  });

  it('stops one address from trying many different accounts, and tells addresses apart behind a proxy', async () => {
    limiter.reset();
    for (let i = 0; i < 100; i++) assert.equal((await tryLogin('10.9.9.9', `nobody${i}@example.com`, 'whatever-it-is')).body.code, 'INVALID_CREDENTIALS');
    assert.equal((await tryLogin('10.9.9.9', 'nobody-else@example.com', 'whatever-it-is')).body.code, 'RATE_LIMITED');
    // a different visitor behind the same proxy has their own allowance (needs TRUST_PROXY, which this test run sets to 1)
    assert.equal((await tryLogin('10.9.9.10', 'nobody-else@example.com', 'whatever-it-is')).body.code, 'INVALID_CREDENTIALS');
  });

  it('accepts only safe proxy settings', async () => {
    const { trustProxy } = await import('../src/main');
    assert.equal(trustProxy(undefined), false);
    assert.equal(trustProxy(''), false);
    assert.equal(trustProxy('0'), false);
    assert.equal(trustProxy('1'), 1);
    assert.equal(trustProxy('loopback'), 'loopback');
    assert.throws(() => trustProxy('true'), /trusts any address/);
  });

  it('refuses to seed a live system with the public admin password or the demo people', () => {
    const seed = path.join(root, 'dist', 'scripts', 'seed.js');
    const run = (adminPassword: string) => {
      try {
        execFileSync(process.execPath, [seed], { cwd: root, env: { ...process.env, NODE_ENV: 'production', ADMIN_PASSWORD: adminPassword }, stdio: 'pipe' });
        return '';
      } catch (e: any) {
        return String(e.stderr);
      }
    };
    assert.match(run(''), /ADMIN_PASSWORD/); // empty means "not set": the public default is refused
    assert.match(run('change-me-admin-1'), /ADMIN_PASSWORD/);
    assert.match(run('too-short'), /at least 14/);
  });
});
