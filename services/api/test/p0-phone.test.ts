// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-phone.db';
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
  for (const f of ['test-p0-phone.db', 'test-p0-phone.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-phone.db', 'test-p0-phone.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('phone numbers at rest, one number per account, and repeat accounts', () => {
  const smsCode = (to: string) => /(\d{6})/.exec([...smsSvc.outbox].reverse().find((m: any) => m.to === to)!.text)![1];
  const confirmPhone = async (u: { token: string }, phone: string) => {
    assert.equal((await post('/v1/me/phone/send-code', u.token, { phone })).status, 201);
    return post('/v1/me/phone/verify', u.token, { code: smsCode(phone.replace(/\s/g, '')) });
  };

  it('keeps the number encrypted, shows it masked, and lets only one account have it', async () => {
    const a = await signup('PhoneA');
    const b = await signup('PhoneB');
    assert.equal((await confirmPhone(a, '+39 345 000 1111')).body.phoneVerified, true);
    const row = await prisma.user.findUnique({ where: { id: a.id } });
    assert.match(row.phoneNumber, /^enc1:/, 'stored encrypted');
    assert.ok(!row.phoneNumber.includes('3450001111') && !row.phoneNumber.includes('345'), 'no digits of the number are readable');
    assert.ok(row.phoneHash && row.phoneHash.length === 64, 'and has a fingerprint to check for duplicates');
    const pending = await prisma.contactCode.findMany({ where: { userId: a.id, channel: 'phone' } });
    assert.ok(pending.every((c: { target: string | null }) => !c.target || c.target.startsWith('enc1:')), 'the number waiting next to a code is encrypted too');
    assert.equal((await get('/v1/me', a.token)).body.phone, '+39••••11', 'the owner sees it masked');
    // another account cannot take the same number, in any spelling
    assert.equal((await post('/v1/me/phone/send-code', b.token, { phone: '+393450001111' })).body.code, 'PHONE_IN_USE');
    // it is free again once the first account lets it go
    assert.equal((await call('DELETE', '/v1/me/phone', a.token)).status, 200);
    assert.equal((await confirmPhone(b, '+393450001111')).body.phoneVerified, true);
    // the export shows the real number to its owner
    assert.equal((await exportOf(b)).body.account.phoneNumber, '+393450001111');
  });

  it('encrypts numbers that older accounts still hold as plain text, once, when the API starts', async () => {
    const { ContactVerificationService } = await import('../src/auth/contact-verification.service');
    const old = await signup('PhoneOld');
    await prisma.user.update({ where: { id: old.id }, data: { phoneNumber: '+393450002222', phoneVerifiedAt: new Date(), phoneHash: null } });
    await app.get(ContactVerificationService).onModuleInit();
    const row = await prisma.user.findUnique({ where: { id: old.id } });
    assert.match(row.phoneNumber, /^enc1:/);
    assert.ok(row.phoneHash);
    assert.equal((await get('/v1/me', old.token)).body.phone, '+39••••22');
  });

  it('limits accounts per device, and remembers a banned account so it cannot start over from the same device', async () => {
    const reg = (name: string, device?: string) =>
      fetch(base + '/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(device ? { 'x-device-id': device } : {}) },
        body: JSON.stringify({ email: `${name}${++n}@example.com`, password: 'a-long-password-1', displayName: name, adultConfirmed: true }),
      });
    const deviceA = 'device-aaaaaaaaaaaaaaaaaaaaaaaa';
    for (let i = 0; i < 3; i++) assert.equal((await reg('Same', deviceA)).status, 201);
    const fourth = await reg('Same', deviceA);
    assert.equal(fourth.status, 403);
    assert.equal((await fourth.json()).code, 'REGISTRATION_BLOCKED');
    assert.equal((await reg('Other', 'device-bbbbbbbbbbbbbbbbbbbbbbbb')).status, 201, 'another device is fine');
    assert.equal((await reg('NoId')).status, 201, 'an old app that sends no id is not blocked');

    // a ban remembers the device; a timed suspension does not; restoring forgets it
    assert.equal((await reg('Banned', 'device-cccccccccccccccccccccccc')).status, 201);
    const bad = { user: await prisma.user.findFirstOrThrow({ where: { email: { startsWith: 'banned' } } }) };
    assert.equal((await post(`/v1/admin/users/${bad.user.id}/suspend`, adminToken, { reason: 'timed', days: 3 })).status, 201);
    assert.equal(await prisma.bannedIdentity.count({ where: { userId: bad.user.id } }), 0);
    assert.equal((await reg('Retry', 'device-cccccccccccccccccccccccc')).status, 201);
    assert.equal((await post(`/v1/admin/users/${bad.user.id}/restore`, adminToken, { reason: 'all fine' })).status, 201);
    assert.equal((await post(`/v1/admin/users/${bad.user.id}/suspend`, adminToken, { reason: 'fraud' })).status, 201);
    assert.ok((await prisma.bannedIdentity.count({ where: { userId: bad.user.id } })) >= 2, 'email and device are remembered');
    const again = await reg('Again', 'device-cccccccccccccccccccccccc');
    assert.equal(again.status, 403);
    assert.equal((await again.json()).code, 'REGISTRATION_BLOCKED');
    assert.equal((await post(`/v1/admin/users/${bad.user.id}/restore`, adminToken, { reason: 'mistake' })).status, 201);
    assert.equal(await prisma.bannedIdentity.count({ where: { userId: bad.user.id } }), 0);
  });
});
