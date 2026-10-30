// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-favourites.db';
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
  for (const f of ['test-p0-favourites.db', 'test-p0-favourites.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-favourites.db', 'test-p0-favourites.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('favourites: trips can be saved, and savers hear when a place opens', () => {
  const alerts = async (u: { token: string }, type: string) => (await get('/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === type);
  const tripBody = (over: Record<string, unknown> = {}) => ({
    title: 'Lisbon long weekend',
    destination: 'Lisbon, Portugal',
    originCity: 'Milan',
    dateStart: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString(),
    dateEnd: new Date(Date.now() + 44 * 24 * 3600 * 1000).toISOString(),
    dateFlexibility: 'exact',
    budgetMin: 600,
    budgetMax: 900,
    budgetIncludesTransport: true,
    tags: ['food'],
    groupSize: '2-3',
    ...over,
  });

  it('tells people who saved a full activity when a place frees up, but not those already going or waiting', async () => {
    const host = await verified('OpenHost');
    const a = await verified('OpenA');
    const fan = await verified('OpenFan');
    const waiter = await verified('OpenWaiter');
    const id = (await post('/v1/activities', host.token, activityBody({ title: 'Tiny table', capacity: 2 }))).body.id as string;
    const reqA = await post(`/v1/activities/${id}/requests`, a.token, {});
    await post(`/v1/activities/${id}/requests/${reqA.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'full');
    // one person saves it, another saves it and joins the waiting list
    assert.equal((await post(`/v1/activities/${id}/favorite`, fan.token)).status, 201);
    assert.equal((await post(`/v1/activities/${id}/favorite`, waiter.token)).status, 201);
    assert.equal((await post(`/v1/activities/${id}/requests`, waiter.token, {})).body.state, 'waitlisted');

    // a place frees up and the waiting list takes it: nothing to announce
    assert.equal((await post(`/v1/activities/${id}/leave`, a.token)).status, 201);
    assert.equal((await get(`/v1/activities/${id}`, waiter.token)).body.isMember, true);
    assert.equal((await alerts(fan, 'spot_opened')).length, 0);

    // it frees up again and nobody is waiting: the person who saved it is told, once; the one who was going is not
    assert.equal((await call('DELETE', `/v1/activities/${id}/members/${waiter.id}`, host.token)).status, 200);
    const told = await alerts(fan, 'spot_opened');
    assert.equal(told.length, 1);
    assert.equal(told[0].data.activityId, id);
    assert.equal((await alerts(waiter, 'spot_opened')).length, 0);
    assert.equal((await alerts(host, 'spot_opened')).length, 0);

    // a plan that was not full says nothing when someone leaves it
    const roomy = (await post('/v1/activities', host.token, activityBody({ title: 'Roomy table', capacity: 5 }))).body.id as string;
    const reqR = await post(`/v1/activities/${roomy}/requests`, a.token, {});
    await post(`/v1/activities/${roomy}/requests/${reqR.body.id}/decision`, host.token, { decision: 'approve' });
    await post(`/v1/activities/${roomy}/favorite`, fan.token);
    await post(`/v1/activities/${roomy}/leave`, a.token);
    assert.equal((await alerts(fan, 'spot_opened')).length, 1, 'still just the first one');
  });

  it('lets trips be saved with the heart, shows them in the list, and refuses cancelled and started ones', async () => {
    const org = await verified('HeartOrg');
    const fan = await verified('HeartFan');
    const t = (await post('/v1/trips', org.token, tripBody())).body.id as string;
    assert.equal((await get(`/v1/trips/${t}`, fan.token)).body.favorited, false);
    assert.equal((await post(`/v1/trips/${t}/favorite`, fan.token)).status, 201);
    assert.equal((await get(`/v1/trips/${t}`, fan.token)).body.favorited, true);
    const list = (await get('/v1/me/favorite-trips', fan.token)).body;
    assert.deepEqual(list.items.map((x: { id: string }) => x.id), [t]);
    assert.equal(list.items[0].favorited, true);
    assert.equal((await call('DELETE', `/v1/trips/${t}/favorite`, fan.token)).status, 200);
    assert.equal((await get('/v1/me/favorite-trips', fan.token)).body.items.length, 0);

    const gone = (await post('/v1/trips', org.token, tripBody({ title: 'Cancelled trip' }))).body.id as string;
    assert.equal((await post(`/v1/trips/${gone}/cancel`, org.token)).status, 201);
    const refused = await post(`/v1/trips/${gone}/favorite`, fan.token);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'TRIP_CLOSED');
    assert.equal((await fetch(`${base}/t/${gone}`, { redirect: 'manual' })).status, 404);

    const begun = (await post('/v1/trips', org.token, tripBody({ title: 'Already under way' }))).body.id as string;
    await prisma.trip.update({ where: { id: begun }, data: { dateStart: new Date(Date.now() - 86_400_000), dateEnd: new Date(Date.now() + 3 * 86_400_000) } });
    assert.equal((await post(`/v1/trips/${begun}/favorite`, fan.token)).body.code, 'TRIP_CLOSED');
    assert.equal((await fetch(`${base}/t/${begun}`, { redirect: 'manual' })).status, 404);
  });

  it('tells people who saved a full trip when a place frees up, but not those in the group or already applied', async () => {
    const org = await verified('FullOrg');
    const m1 = await verified('FullM1');
    const m2 = await verified('FullM2');
    const fan = await verified('FullFan');
    const t = (await post('/v1/trips', org.token, tripBody({ title: 'Full house trip' }))).body.id as string;
    const apply = { intro: 'I love food and walking.', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
    for (const who of [m1, m2]) {
      const ap = await post(`/v1/trips/${t}/applications`, who.token, apply);
      assert.equal((await post(`/v1/trips/${t}/applications/${ap.body.id}/decision`, org.token, { decision: 'approve' })).body.state, 'approved');
    }
    assert.equal((await get(`/v1/trips/${t}`, org.token)).body.status, 'full');
    assert.equal((await post(`/v1/trips/${t}/favorite`, fan.token)).status, 201);
    assert.equal((await post(`/v1/trips/${t}/favorite`, m2.token)).status, 201);

    assert.equal((await post(`/v1/trips/${t}/leave`, m1.token)).status, 201);
    const told = await alerts(fan, 'spot_opened');
    assert.equal(told.length, 1);
    assert.equal(told[0].data.tripId, t);
    assert.equal((await alerts(m2, 'spot_opened')).length, 0, 'someone already in the group is not told');
    assert.equal((await alerts(org, 'spot_opened')).length, 0);
  });

  it('tells people who saved a plan when it changes or is cancelled, but not members, the host or blocked people', async () => {
    const host = await verified('SavedHost');
    const member = await verified('SavedMember');
    const fan = await verified('SavedFan');
    const blocked = await verified('SavedBlocked');
    const hours = (n: number) => new Date(Date.now() + n * 3600 * 1000).toISOString();
    const id = (await post('/v1/activities', host.token, activityBody({ title: 'Saved plan' }))).body.id as string;
    const req = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${req.body.id}/decision`, host.token, { decision: 'approve' });
    for (const u of [member, fan, blocked]) await post(`/v1/activities/${id}/favorite`, u.token);
    await post('/v1/blocks', host.token, { userId: blocked.id });

    // a small edit (title) says nothing; a new time or place does
    await call('PATCH', `/v1/activities/${id}`, host.token, { description: 'Just a nicer description for everyone.' });
    assert.equal((await alerts(fan, 'activity_changed')).length, 0);
    assert.equal((await call('PATCH', `/v1/activities/${id}`, host.token, { venueName: 'Caffe Navigli', startsAt: hours(30), endsAt: hours(32) })).status, 200);
    const told = await alerts(fan, 'activity_changed');
    assert.equal(told.length, 1);
    assert.equal(told[0].data.activityId, id);
    assert.equal((await alerts(member, 'activity_changed')).length, 1, 'the member gets their own alert, not two');
    assert.equal((await alerts(host, 'activity_changed')).length, 0);
    assert.equal((await alerts(blocked, 'activity_changed')).length, 0);

    assert.equal((await post(`/v1/activities/${id}/cancel`, host.token)).status, 201);
    assert.equal((await alerts(fan, 'activity_cancelled')).length, 1);
    assert.equal((await alerts(member, 'activity_cancelled')).length, 1);
    assert.equal((await alerts(blocked, 'activity_cancelled')).length, 0);
  });

  it('tells people who saved a trip when its dates change or it is cancelled', async () => {
    const org = await verified('SavedTripOrg');
    const member = await verified('SavedTripMember');
    const fan = await verified('SavedTripFan');
    const t = (await post('/v1/trips', org.token, tripBody({ title: 'Saved trip' }))).body.id as string;
    const ap = await post(`/v1/trips/${t}/applications`, member.token, { intro: 'I love food and walking.', confirmBudget: true, confirmDates: true, confirmGuidelines: true });
    await post(`/v1/trips/${t}/applications/${ap.body.id}/decision`, org.token, { decision: 'approve' });
    await post(`/v1/trips/${t}/favorite`, fan.token);
    await post(`/v1/trips/${t}/favorite`, member.token);

    const later = (d: number) => new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
    assert.equal((await call('PATCH', `/v1/trips/${t}`, org.token, { dateStart: later(50), dateEnd: later(55) })).status, 200);
    assert.equal((await alerts(fan, 'trip_changed')).length, 1);
    assert.equal((await alerts(member, 'trip_changed')).length, 1);
    assert.equal((await alerts(org, 'trip_changed')).length, 0);

    assert.equal((await post(`/v1/trips/${t}/cancel`, org.token)).status, 201);
    assert.equal((await alerts(fan, 'trip_cancelled')).length, 1);
    assert.equal((await alerts(member, 'trip_cancelled')).length, 1);
  });
});
