// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-staff-mfa.db';
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
  for (const f of ['test-p0-staff-mfa.db', 'test-p0-staff-mfa.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-staff-mfa.db', 'test-p0-staff-mfa.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('two-step sign-in for staff', () => {
  const stepNow = () => Math.floor(Date.now() / 30_000);
  const codeAt = async (secret: string, offset = 0) => {
    const { totp, base32Decode } = await import('../src/common/totp');
    return totp(base32Decode(secret), stepNow() + offset);
  };
  const makeStaff = async (name: string, role = 'moderator') => {
    const s = await signup(name);
    await prisma.user.update({ where: { id: s.id }, data: { role } });
    return s;
  };
  const login = (email: string) => post('/v1/auth/login', undefined, { email, password: 'a-long-password-1' });

  it('produces the same codes as every authenticator app (RFC 6238 test vector) and reads base32 both ways', async () => {
    const { totp, base32Encode, base32Decode, checkTotp } = await import('../src/common/totp');
    const secret = Buffer.from('12345678901234567890');
    assert.equal(totp(secret, Math.floor(59 / 30)), '287082');
    assert.equal(totp(secret, Math.floor(1111111109 / 30)), '081804');
    assert.deepEqual(base32Decode(base32Encode(secret)), secret);
    const b32 = base32Encode(secret);
    assert.equal(checkTotp(b32, '287082', null, 59_000), Math.floor(59 / 30));
    assert.equal(checkTotp(b32, '287082', Math.floor(59 / 30), 59_000), null, 'a used code cannot be used again');
    assert.equal(checkTotp(b32, '000000', null, 59_000), null);
    assert.equal(checkTotp(b32, 'abcdef', null, 59_000), null);
  });

  it('asks staff for a code after the password, accepts each code once, and honours recovery codes', async () => {
    const s = await makeStaff('Mod');
    // before it is on: a plain sign-in
    assert.ok((await login(s.email)).body.token);
    assert.deepEqual((await get('/v1/me/mfa', s.token)).body, { enabled: false, required: false, recoveryCodesLeft: 0 });

    const setup = await post('/v1/me/mfa/setup', s.token);
    assert.equal(setup.status, 201, JSON.stringify(setup.body));
    assert.match(setup.body.secret, /^[A-Z2-7]{32}$/);
    assert.match(setup.body.otpauthUri, /^otpauth:\/\/totp\/HERE%20%26%20THERE:/);
    const stored = await prisma.user.findUnique({ where: { id: s.id } });
    assert.match(stored.mfaSecret, /^enc1:/, 'the secret is stored encrypted');
    assert.equal(stored.mfaEnabledAt, null, 'nothing is on until a code is confirmed');
    assert.equal((await post('/v1/me/mfa/enable', s.token, { code: '000000' })).body.code, 'INVALID_SETUP_CODE');
    const on = await post('/v1/me/mfa/enable', s.token, { code: await codeAt(setup.body.secret) });
    assert.equal(on.status, 201, JSON.stringify(on.body));
    assert.equal(on.body.recoveryCodes.length, 8);
    assert.match(on.body.recoveryCodes[0], /^[0-9a-f]{5}-[0-9a-f]{5}$/);
    assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: s.id } }), 8);
    assert.ok(!JSON.stringify(await prisma.mfaRecoveryCode.findMany({ where: { userId: s.id } })).includes(on.body.recoveryCodes[0]), 'recovery codes are stored only as hashes');

    // the password alone no longer signs in
    const first = await login(s.email);
    assert.equal(first.status, 201);
    assert.equal(first.body.mfaRequired, true);
    assert.equal(first.body.token, undefined);
    assert.equal((await get('/v1/me', first.body.mfaToken)).status, 401, 'the pass from the password step is not a sign-in');
    assert.equal((await post('/v1/auth/mfa/verify', undefined, { mfaToken: first.body.mfaToken, code: '000000' })).body.code, 'INVALID_MFA_CODE');
    assert.equal((await post('/v1/auth/mfa/verify', undefined, { mfaToken: 'not-a-token-at-all', code: '123456' })).body.code, 'MFA_EXPIRED');

    const code = await codeAt(setup.body.secret, 1); // the enable step is used up, so the next one
    const done = await post('/v1/auth/mfa/verify', undefined, { mfaToken: first.body.mfaToken, code });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal((await get('/v1/me', done.body.token)).status, 200);
    assert.equal((await post('/v1/auth/mfa/verify', undefined, { mfaToken: first.body.mfaToken, code })).body.code, 'INVALID_MFA_CODE', 'the same code cannot be replayed');

    // a recovery code works once
    const second = await login(s.email);
    const viaRecovery = await post('/v1/auth/mfa/verify', undefined, { mfaToken: second.body.mfaToken, code: on.body.recoveryCodes[0] });
    assert.equal(viaRecovery.status, 201);
    assert.equal(viaRecovery.body.usedRecoveryCode, true);
    const third = await login(s.email);
    assert.equal((await post('/v1/auth/mfa/verify', undefined, { mfaToken: third.body.mfaToken, code: on.body.recoveryCodes[0] })).body.code, 'INVALID_MFA_CODE');
    assert.equal((await get('/v1/me/mfa', done.body.token)).body.recoveryCodesLeft, 7);
    assert.ok(await prisma.auditEvent.findFirst({ where: { actorId: s.id, action: 'mfa.recovery_used' } }));
  });

  it('is for staff only, can be turned off with the password and a code, and an administrator can reset it', async () => {
    const plain = await signup('PlainUser');
    assert.equal((await post('/v1/me/mfa/setup', plain.token)).body.code, 'STAFF_ONLY');

    const s = await makeStaff('Mod2');
    const setup = await post('/v1/me/mfa/setup', s.token);
    await post('/v1/me/mfa/enable', s.token, { code: await codeAt(setup.body.secret) });
    assert.equal((await post('/v1/me/mfa/setup', s.token)).body.code, 'MFA_ALREADY_ON');
    // switching it off needs the password and a code
    assert.equal((await call('DELETE', '/v1/me/mfa', s.token, { password: 'wrong-password-1', code: await codeAt(setup.body.secret, 1) })).body.code, 'WRONG_PASSWORD');
    // an administrator resets it for someone who lost their phone
    assert.equal((await post(`/v1/admin/users/${s.id}/mfa/reset`, adminToken, { reason: 'lost phone' })).status, 201);
    const after = await prisma.user.findUnique({ where: { id: s.id } });
    assert.equal(after.mfaEnabledAt, null);
    assert.equal(after.mfaSecret, null);
    assert.equal(await prisma.mfaRecoveryCode.count({ where: { userId: s.id } }), 0);
    assert.ok((await login(s.email)).body.token, 'a plain sign-in works again until they set it up anew');
    assert.ok(await prisma.auditEvent.findFirst({ where: { objectId: s.id, action: 'mfa.reset_by_admin' } }));
  });

  it('keeps staff out of the admin console until two-step sign-in is on, when that is required', async () => {
    const s = await makeStaff('Mod3');
    process.env.STAFF_MFA_REQUIRED = 'true';
    try {
      const blocked = await get('/v1/admin/overview', s.token);
      assert.equal(blocked.status, 403);
      assert.equal(blocked.body.code, 'MFA_REQUIRED');
      assert.equal((await get('/v1/me/mfa', s.token)).body.required, true, 'but the page that sets it up stays open');
      const setup = await post('/v1/me/mfa/setup', s.token);
      await post('/v1/me/mfa/enable', s.token, { code: await codeAt(setup.body.secret) });
      assert.notEqual((await get('/v1/admin/overview', s.token)).status, 403);
      assert.equal((await call('DELETE', '/v1/me/mfa', s.token, { password: 'a-long-password-1', code: await codeAt(setup.body.secret, 1) })).body.code, 'MFA_REQUIRED', 'staff cannot turn it off');
    } finally {
      delete process.env.STAFF_MFA_REQUIRED;
    }
  });
});
