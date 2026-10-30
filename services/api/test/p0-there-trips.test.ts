// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-there-trips.db';
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
  for (const f of ['test-p0-there-trips.db', 'test-p0-there-trips.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-there-trips.db', 'test-p0-there-trips.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('THERE: trips, applications, approval, chat', () => {
  const tripBody = (over: Record<string, unknown> = {}) => ({
    title: 'Tokyo & Kyoto',
    destination: 'Tokyo, Japan',
    originCity: 'Milan',
    dateStart: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString(),
    dateEnd: new Date(Date.now() + 48 * 24 * 3600 * 1000).toISOString(),
    dateFlexibility: 'plus_minus_3',
    budgetMin: 1200,
    budgetMax: 1800,
    budgetIncludesTransport: true,
    tags: ['culture', 'food'],
    groupSize: '2-3',
    ...over,
  });

  it('validates, labels budgets as estimates and searches by date overlap', async () => {
    const org = await verified('Organizer');
    const bad = await post('/v1/trips', org.token, tripBody({ budgetMin: 2000, budgetMax: 1000 }));
    assert.equal(bad.status, 400);
    // trips can only be planned six months ahead
    const tooFar = await post("/v1/trips", org.token, tripBody({ dateStart: new Date(Date.now() + 300 * 864e5).toISOString(), dateEnd: new Date(Date.now() + 305 * 864e5).toISOString() }));
    assert.equal(tooFar.status, 400);
    assert.match(tooFar.body.message, /six months/);

    const t = await post('/v1/trips', org.token, tripBody());
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.equal(t.body.kind, 'trip_proposal');
    assert.equal(t.body.budget.label, 'Estimated personal budget');
    assert.match(t.body.budget.scope, /including travel/);
    assert.match(t.body.disclaimer, /not quotes or booking offers/);

    const seeker = await verified('Seeker');
    const start = new Date(t.body.dateStart);
    const day = 24 * 3600 * 1000;
    const q = (from: Date, to: Date, extra = '') =>
      get(`/v1/trips?destination=japan&from=${from.toISOString()}&to=${to.toISOString()}${extra}`, seeker.token);

    const exact = await q(new Date(+start + day), new Date(+start + 3 * day));
    assert.equal(exact.body.items.find((x: any) => x.id === t.body.id)?.match.dates, 'exact');

    // a window starting 2 days after the trip's end only matches thanks to +/-3 flexibility -> approximate
    const end = new Date(t.body.dateEnd);
    const near = await q(new Date(+end + 2 * day), new Date(+end + 5 * day));
    assert.equal(near.body.items.find((x: any) => x.id === t.body.id)?.match.dates, 'approximate');

    const far = await q(new Date(+end + 60 * day), new Date(+end + 65 * day));
    assert.equal(far.body.items.some((x: any) => x.id === t.body.id), false);

    // budget scope mismatch is surfaced, not hidden
    const mism = await q(new Date(+start + day), new Date(+start + 3 * day), '&budgetMax=2000&includesTransport=false');
    assert.equal(mism.body.items.find((x: any) => x.id === t.body.id)?.match.budgetScopeMismatch, true);
    assert.equal((await get('/v1/trips?budgetMax=500', seeker.token)).body.items.some((x: any) => x.id === t.body.id), false);
  });

  it('pages my trips, organised and applied for, soonest departure first', async () => {
    const org = await verified('TOrg');
    const guest = await verified('TGuest');
    const day = 864e5;
    const t1 = (await post('/v1/trips', org.token, tripBody({ title: 'Trip one', dateStart: new Date(Date.now() + 40 * day).toISOString(), dateEnd: new Date(Date.now() + 45 * day).toISOString() }))).body;
    const t2 = (await post('/v1/trips', org.token, tripBody({ title: 'Trip two', destination: 'Oslo, Norway', dateStart: new Date(Date.now() + 60 * day).toISOString(), dateEnd: new Date(Date.now() + 65 * day).toISOString() }))).body;
    const apply = await post(`/v1/trips/${t2.id}/applications`, guest.token, { intro: 'Count me in.', confirmBudget: true, confirmDates: true, confirmGuidelines: true });
    assert.equal(apply.status, 201, JSON.stringify(apply.body));

    const o1 = await get('/v1/me/trips/page?limit=1', org.token);
    assert.equal(o1.body.items.length, 1);
    assert.equal(o1.body.items[0].id, t1.id);
    assert.equal(o1.body.items[0].row, 'joined');
    assert.equal(o1.body.items[0].kind, 'trip_proposal', 'the trip keeps its own fields');
    assert.deepEqual(o1.body.counts, { joined: 2, applications: 0 });
    const o2 = await get(`/v1/me/trips/page?limit=1&cursor=${o1.body.nextCursor}`, org.token);
    assert.equal(o2.body.items[0].id, t2.id);
    assert.equal(o2.body.nextCursor, null);

    const g = await get('/v1/me/trips/page', guest.token);
    assert.deepEqual(g.body.items.map((x: { row: string }) => x.row), ['application']);
    assert.equal(g.body.items[0].trip.id, t2.id);
    assert.deepEqual(g.body.counts, { joined: 0, applications: 1 });
    const next = await get('/v1/me/trips/page?upcoming=1&limit=1', guest.token);
    assert.equal(next.body.items[0].trip.id, t2.id, 'a pending application counts as upcoming');
    assert.equal((await get('/v1/me/trips/page?cursor=junk', org.token)).status, 400);
  });

  it('ranks trips the same three ways: buddies going first, then people you follow, then everyone else', async () => {
    const viewer = await verified('TTierViewer');
    const buddy = await verified('TTierBuddy');
    const followed = await verified('TTierFollowed');
    const follower = await verified('TTierFollower');
    const stranger = await verified('TTierStranger');
    await post('/v1/follows', viewer.token, { userId: buddy.id });
    await post('/v1/follows', buddy.token, { userId: viewer.id });
    await post('/v1/follows', viewer.token, { userId: followed.id });
    await post('/v1/follows', follower.token, { userId: viewer.id });
    const make = async (who: { token: string }, title: string) => (await post('/v1/trips', who.token, tripBody({ title, destination: 'Tierland' }))).body.id;
    const ids = { stranger: await make(stranger, 'Trip by a stranger'), follower: await make(follower, 'Trip by a follower'), followed: await make(followed, 'Trip by someone I follow'), buddy: await make(buddy, 'Trip by a buddy') };
    const r = await get('/v1/trips?destination=tierland', viewer.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const order = r.body.items.map((x: { id: string }) => x.id);
    assert.equal(order[0], ids.buddy);
    assert.equal(order[1], ids.followed);
    assert.deepEqual(order.slice(2).sort(), [ids.follower, ids.stranger].sort());
    const by = (id: string) => r.body.items.find((x: { id: string }) => x.id === id);
    assert.deepEqual([by(ids.buddy).buddiesGoing, by(ids.buddy).followingGoing], [1, 0]);
    assert.deepEqual([by(ids.followed).buddiesGoing, by(ids.followed).followingGoing], [0, 1]);
    assert.deepEqual([by(ids.follower).buddiesGoing, by(ids.follower).followingGoing], [0, 0]);

    // one at a time with the score cursor: every trip once, in the same order, and the total stays the full count
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const page: Res = await get(`/v1/trips?destination=tierland&limit=1${cursor ? `&cursor=${cursor}` : ''}`, viewer.token);
      assert.equal(page.body.total, 4);
      seen.push(...page.body.items.map((x: { id: string }) => x.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, order);
    assert.equal((await get('/v1/trips?destination=tierland&cursor=junk', viewer.token)).status, 400);
  });

  it('gates the group chat behind organizer approval', async () => {
    const org = await verified('Org2');
    const app1 = await verified('Applicant1');
    const app2 = await verified('Applicant2');
    const app3 = await verified('Applicant3');
    const t = (await post('/v1/trips', org.token, tripBody({ groupSize: '2-3' }))).body;
    const conv = await prisma.conversation.findUnique({ where: { tripId: t.id } });

    // application requires explicit confirmations
    const incomplete = await post(`/v1/trips/${t.id}/applications`, app1.token, { intro: 'I love culture and food.' });
    assert.equal(incomplete.status, 400);

    const body = { intro: 'I love culture and food.', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
    const ap = await post(`/v1/trips/${t.id}/applications`, app1.token, body);
    assert.equal(ap.status, 201);
    const detail = await get(`/v1/trips/${t.id}`, app1.token);
    assert.equal(detail.body.myApplication.message, 'Pending organizer review');
    assert.equal(detail.body.conversationId, null);
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, app1.token)).status, 403);

    assert.equal((await get(`/v1/trips/${t.id}/applications`, app1.token)).status, 403);
    assert.equal((await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, org.token, { decision: 'approve' })).body.state, 'approved');
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, app1.token, { body: 'Hello group' })).status, 201);
    assert.equal((await get(`/v1/trips/${t.id}`, app1.token)).body.conversationId, conv.id);

    // group of 2-3: organizer + 2 approved = full
    const ap2 = await post(`/v1/trips/${t.id}/applications`, app2.token, body);
    await post(`/v1/trips/${t.id}/applications/${ap2.body.id}/decision`, org.token, { decision: 'approve' });
    assert.equal((await get(`/v1/trips/${t.id}`, org.token)).body.status, 'full');
    assert.equal((await post(`/v1/trips/${t.id}/applications`, app3.token, body)).body.code, 'TRIP_FULL');

    // declined applicants stay outside; leaving needs no permission and revokes chat access
    assert.equal((await post(`/v1/trips/${t.id}/leave`, app1.token)).status, 201);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, app1.token, { body: 'still here?' })).status, 403);

    // material change notifies approved members
    await call('PATCH', `/v1/trips/${t.id}`, org.token, { dateStart: new Date(Date.now() + 50 * 24 * 3600 * 1000).toISOString(), dateEnd: new Date(Date.now() + 55 * 24 * 3600 * 1000).toISOString() });
    assert.ok((await get('/v1/notifications', app2.token)).body.items.some((x: any) => x.type === 'trip_changed'));
  });

  it('lets the organizer run date polls in the group chat, and needs every member to confirm the final dates', async () => {
    const org = await verified('PollOrg');
    const m1 = await verified('PollM1');
    const m2 = await verified('PollM2');
    const t = (await post('/v1/trips', org.token, tripBody({ groupSize: '4-6' }))).body;
    const conv = await prisma.conversation.findUnique({ where: { tripId: t.id } });
    const body = { intro: 'I love culture and food.', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
    for (const m of [m1, m2]) {
      const ap = await post(`/v1/trips/${t.id}/applications`, m.token, body);
      await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, org.token, { decision: 'approve' });
    }
    const day = 24 * 3600e3;
    const poll = { title: 'Can everyone do these dates?', dateStart: new Date(Date.now() + 60 * day).toISOString(), dateEnd: new Date(Date.now() + 67 * day).toISOString() };

    // only the organizer starts a poll; members can only answer
    assert.equal((await post(`/v1/conversations/${conv.id}/polls`, m1.token, poll)).body.code, 'NOT_ORGANIZER');
    const made = await post(`/v1/conversations/${conv.id}/polls`, org.token, poll);
    assert.equal(made.status, 201, JSON.stringify(made.body));

    // members answer in the chat; the poll shows counts and their own answer
    assert.equal((await post(`/v1/polls/${made.body.id}/vote`, m1.token, { vote: 'accept' })).body.accept, 1);
    assert.equal((await post(`/v1/polls/${made.body.id}/vote`, m2.token, { vote: 'reject' })).body.reject, 1);
    const outsider = await verified('PollOutsider');
    assert.equal((await post(`/v1/polls/${made.body.id}/vote`, outsider.token, { vote: 'accept' })).status, 403);
    const seen = (await get(`/v1/conversations/${conv.id}/messages`, m1.token)).body.items.find((x: any) => x.kind === 'poll');
    assert.deepEqual([seen.poll.accept, seen.poll.reject, seen.poll.myVote], [1, 1, 'accept']);

    // links are ordinary text for everyone: a member can send one like any message
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, m1.token, { body: 'Maybe this hotel? https://example.com/hotel' })).status, 201);
    assert.equal((await post(`/v1/conversations/${conv.id}/links`, org.token, { url: 'https://example.com/hotel' })).status, 404); // no separate share-link feature

    // adopting the poll puts the dates to the group: nobody is committed until they confirm themselves
    assert.equal((await post(`/v1/polls/${made.body.id}/close`, m1.token, { adopt: true })).body.code, 'NOT_ORGANIZER');
    assert.equal((await post(`/v1/polls/${made.body.id}/close`, org.token, { adopt: true })).status, 201);
    const d1 = (await get(`/v1/trips/${t.id}`, m1.token)).body;
    assert.equal(d1.datesState, 'proposed');
    assert.equal(d1.myDatesConfirmed, false);
    assert.equal(d1.datesConfirmedCount, 1);
    assert.ok((await get('/v1/notifications', m1.token)).body.items.some((n: any) => n.type === 'trip_dates_proposed'));
    assert.equal((await post(`/v1/trips/${t.id}/confirm-dates`, m1.token)).body.confirmed, 2);
    assert.equal((await post(`/v1/trips/${t.id}/confirm-dates`, m2.token)).body.confirmed, 3);
    const done = (await get(`/v1/conversations/${conv.id}/messages`, org.token)).body.items.filter((x: any) => x.kind === 'system');
    assert.ok(done.some((x: any) => /Everyone has confirmed/.test(x.body)));
    assert.equal((await post(`/v1/polls/${made.body.id}/vote`, m1.token, { vote: 'accept' })).body.code, 'POLL_CLOSED');
  });

  it('cannot be approved by someone other than the organizer and a decline keeps chat closed', async () => {
    const org = await verified('Org3');
    const a1 = await verified('Hopeful');
    const t = (await post('/v1/trips', org.token, tripBody())).body;
    const body = { intro: 'Please let me join!', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
    const ap = await post(`/v1/trips/${t.id}/applications`, a1.token, body);
    assert.equal((await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, a1.token, { decision: 'approve' })).body.code, 'NOT_ORGANIZER');
    assert.equal((await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, org.token, { decision: 'decline' })).body.state, 'declined');
    const conv = await prisma.conversation.findUnique({ where: { tripId: t.id } });
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a1.token)).status, 403);
    assert.equal((await post(`/v1/trips/${t.id}/applications`, a1.token, body)).body.code, 'ALREADY_APPLIED');
  });
});
