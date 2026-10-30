// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-social.db';
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
  for (const f of ['test-p0-social.db', 'test-p0-social.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-social.db', 'test-p0-social.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('sign in with Google or Apple, and the document-only identity check', () => {
  let signer: { privateKey: any; jwk: any };
  const makeToken = async (claims: Record<string, unknown>, opts: { alg?: string; key?: any; kid?: string } = {}) => {
    const { createPrivateKey, sign } = await import('node:crypto');
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = b({ alg: opts.alg ?? 'RS256', kid: opts.kid ?? 'k1' });
    const body = b({ iss: 'https://accounts.google.com', aud: 'test-google-client', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'g-sub-1', email: 'social1@example.com', email_verified: true, name: 'Sam Social', ...claims });
    const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? signer.privateKey).toString('base64url');
    void createPrivateKey;
    return `${head}.${body}.${sig}`;
  };
  const social = (idToken: string, extra: Record<string, unknown> = {}) => post('/v1/auth/social', undefined, { provider: 'google', idToken, ...extra });

  before(async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const { SocialService } = await import('../src/auth/social.service');
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    signer = { privateKey: pair.privateKey, jwk: pair.publicKey.export({ format: 'jwk' }) };
    app.get(SocialService).fetchJwks = async () => ({ keys: [{ ...signer.jwk, kid: 'k1' }] });
    process.env.GOOGLE_CLIENT_IDS = 'test-google-client';
  });
  after(() => {
    delete process.env.GOOGLE_CLIENT_IDS;
  });

  it('shows only the providers that are switched on', async () => {
    assert.deepEqual((await get('/v1/auth/social/providers')).body, { apple: false, google: true });
  });

  it('creates an account on first use (after the 18+ confirmation), then signs the same person in', async () => {
    const t = await makeToken({ sub: 'g-new', email: 'social-new@example.com' });
    const first = await social(t);
    assert.equal(first.body.code, 'ADULT_CONFIRMATION_REQUIRED');
    assert.equal(await prisma.user.count({ where: { email: 'social-new@example.com' } }), 0, 'nothing is created before they confirm');
    const made = await social(t, { adultConfirmed: true });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.user.email, 'social-new@example.com');
    assert.equal(made.body.user.emailVerified, true, 'the provider has confirmed the address');
    assert.equal(made.body.user.profile.displayName, 'Sam Social');
    assert.equal((await get('/v1/me', made.body.token)).status, 200);
    const row = await prisma.user.findUnique({ where: { id: made.body.user.id } });
    assert.ok(row.passwordHash.startsWith('!'), 'no password exists to guess');
    assert.equal(await prisma.socialIdentity.count({ where: { userId: row.id, provider: 'google', subject: 'g-new' } }), 1);
    // next time: straight in, same account, no questions
    const again = await social(await makeToken({ sub: 'g-new', email: 'social-new@example.com' }));
    assert.equal(again.status, 201);
    assert.equal(again.body.user.id, made.body.user.id);
  });

  it('refuses a token that is forged, expired, for another app, from another issuer, or unsigned', async () => {
    const { generateKeyPairSync } = await import('node:crypto');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const bad = async (idToken: string) => {
      const r = await social(idToken, { adultConfirmed: true });
      assert.equal(r.status, 401, JSON.stringify(r.body));
      assert.equal(r.body.code, 'INVALID_SOCIAL_TOKEN');
    };
    await bad(await makeToken({ sub: 'x1', email: 'x1@example.com' }, { key: other.privateKey }));
    await bad(await makeToken({ sub: 'x2', email: 'x2@example.com', exp: Math.floor(Date.now() / 1000) - 60 }));
    await bad(await makeToken({ sub: 'x3', email: 'x3@example.com', aud: 'someone-elses-app' }));
    await bad(await makeToken({ sub: 'x4', email: 'x4@example.com', iss: 'https://evil.example.com' }));
    await bad(await makeToken({ sub: 'x5', email: 'x5@example.com' }, { kid: 'unknown-key' }));
    await bad('this.is-not-a-real.token-at-all');
    const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x6' })).toString('base64url')}.`;
    await bad(unsigned);
    assert.equal(await prisma.user.count({ where: { email: { in: ['x1@example.com', 'x2@example.com', 'x3@example.com', 'x4@example.com', 'x5@example.com'] } } }), 0);
    // a provider that is not switched on (no app ids) is simply not there
    assert.equal((await post('/v1/auth/social', undefined, { provider: 'apple', idToken: await makeToken({}), adultConfirmed: true })).status, 404);
  });

  it('links to an existing account only when that account has confirmed its email, and never signs staff in this way', async () => {
    const open = await signup('NotConfirmed');
    const refused = await social(await makeToken({ sub: 'g-open', email: open.email }), { adultConfirmed: true });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'ACCOUNT_EXISTS');
    assert.equal(await prisma.socialIdentity.count({ where: { subject: 'g-open' } }), 0, 'nobody can claim an account by knowing its email');

    const mine = await signup('Confirmed');
    await confirmEmail(mine);
    const linked = await social(await makeToken({ sub: 'g-mine', email: mine.email }));
    assert.equal(linked.status, 201, JSON.stringify(linked.body));
    assert.equal(linked.body.user.id, mine.id);

    const staff = await signup('StaffViaGoogle');
    await confirmEmail(staff);
    await prisma.user.update({ where: { id: staff.id }, data: { role: 'moderator' } });
    const blocked = await social(await makeToken({ sub: 'g-staff', email: staff.email }));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'SOCIAL_NOT_FOR_STAFF');
  });

  it('offers a document-only identity check with no face match, and records which kind it was', async () => {
    const a = await signup('DocOnly');
    await confirmEmail(a);
    const started = await post('/v1/me/verification', a.token, { consent: true, method: 'document' });
    assert.equal(started.status, 201, JSON.stringify(started.body));
    const check = await prisma.verificationCheck.findFirst({ where: { userId: a.id } });
    assert.equal(check.method, 'document');
    assert.equal((await get('/v1/me/verification', a.token)).body.method, 'document');
    const queue = await get('/v1/admin/verifications?status=pending', adminToken);
    assert.equal(queue.body.items.find((c: { id: string }) => c.id === check.id).method, 'document');

    const b = await signup('FaceMatch');
    await confirmEmail(b);
    assert.equal((await post('/v1/me/verification', b.token, { consent: true })).status, 201);
    assert.equal((await prisma.verificationCheck.findFirst({ where: { userId: b.id } })).method, 'face', 'face match stays the default');
    const c = await signup('NoConsent');
    await confirmEmail(c);
    assert.equal((await post('/v1/me/verification', c.token, { method: 'document' })).body.code, 'CONSENT_REQUIRED');
  });
});
