process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test.db';
process.env.VERIFICATION_MODE = 'manual';
process.env.REGISTER_LIMIT_PER_HOUR = '10000';
process.env.BCRYPT_ROUNDS = '4';

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcryptjs';

const root = path.resolve(__dirname, '..', '..');
const prismaDir = path.join(root, 'prisma');
let base = '';
let app: any;
let prisma: any;
let limiter: any;

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
  const r = await post('/v1/auth/register', undefined, {
    email: `${name}${++n}@example.com`,
    password: 'a-long-password-1',
    displayName: name,
    homeCity: 'Milan',
    adultConfirmed: true,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token as string, id: r.body.user.id as string };
}

let adminToken = '';
async function verified(name: string) {
  const u = await signup(name);
  const s = await post('/v1/me/verification', u.token);
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
  for (const f of ['test.db', 'test.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
  execFileSync(process.execPath, [path.join(root, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'ignore',
  });
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { RateLimiter } = await import('../src/common/rate-limiter');
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  prisma = app.get(PrismaService);
  limiter = app.get(RateLimiter);
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
  for (const f of ['test.db', 'test.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
});

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
});

describe('HERE: create, discover, request, approve, chat', () => {
  it('runs the full P0 journey with access revocation', async () => {
    const host = await verified('Host');
    const a = await verified('Alex');
    const b = await verified('Marta');
    const c = await verified('Carl');

    // validation
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(-1), endsAt: hours(1) }))).body.code, 'INVALID_SCHEDULE');
    assert.equal((await post('/v1/activities', host.token, activityBody({ capacity: 1 }))).body.code, 'VALIDATION_FAILED');
    assert.equal((await post('/v1/activities', host.token, activityBody({ description: 'please send me money' }))).body.code, 'CONTENT_REJECTED');

    // create (capacity 3 incl. host)
    const created = await post('/v1/activities', host.token, activityBody());
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id;
    assert.equal(created.body.going, 1);
    assert.equal(created.body.spotsLeft, 2);

    // discovery by another user: city (case-insensitive), category, no geolocation needed
    const feed = await get('/v1/activities?city=milan&category=drinks', a.token);
    assert.ok(feed.body.items.some((x: any) => x.id === id));
    assert.equal((await get('/v1/activities?city=rome', a.token)).body.items.length, 0);
    const near = await get('/v1/activities?lat=45.47&lng=9.19&radiusKm=2', a.token);
    assert.ok(near.body.items.find((x: any) => x.id === id)?.distanceKm >= 0);

    // before approval: no chat id, and chat endpoints are forbidden
    const before = await get(`/v1/activities/${id}`, a.token);
    assert.equal(before.body.conversationId, null);
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a.token)).status, 403);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, a.token, { body: 'hi' })).body.code, 'NOT_A_MEMBER');

    // request: pending; duplicates blocked; non-hosts cannot decide or list
    const req = await post(`/v1/activities/${id}/requests`, a.token, { intro: 'New in Milan!' });
    assert.equal(req.status, 201);
    assert.equal(req.body.state, 'requested');
    assert.equal((await post(`/v1/activities/${id}/requests`, a.token, {})).body.code, 'ALREADY_REQUESTED');
    assert.equal((await post(`/v1/activities/${id}/requests/${req.body.id}/decision`, a.token, { decision: 'approve' })).body.code, 'NOT_HOST');
    assert.equal((await get(`/v1/activities/${id}/requests`, a.token)).status, 403);
    // still no chat while pending
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a.token)).status, 403);

    // host got notified
    const hn = await get('/v1/notifications', host.token);
    assert.ok(hn.body.items.some((x: any) => x.type === 'join_request'));

    // approve -> chat access
    assert.equal((await post(`/v1/activities/${id}/requests/${req.body.id}/decision`, host.token, { decision: 'approve' })).body.state, 'approved');
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, a.token, { body: 'See you at 19:30' })).status, 201);
    // chat alerts: one unread alert per person per conversation, never for the sender
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, a.token, { body: 'Second message' })).status, 201);
    const chatAlerts = (await get('/v1/notifications', host.token)).body.items.filter((x: any) => x.type === 'chat_message');
    assert.equal(chatAlerts.length, 1);
    assert.equal(chatAlerts[0].data.conversationId, conv.id);
    assert.equal((await get('/v1/notifications', a.token)).body.items.some((x: any) => x.type === 'chat_message'), false);
    const msgs = await get(`/v1/conversations/${conv.id}/messages`, host.token);
    assert.equal(msgs.body.items.length, 2);
    assert.equal((await get(`/v1/activities/${id}`, a.token)).body.conversationId, conv.id);
    assert.ok((await get('/v1/notifications', a.token)).body.items.some((x: any) => x.type === 'request_approved'));

    // fill the activity: second approval makes it full, third request fails
    const reqB = await post(`/v1/activities/${id}/requests`, b.token, {});
    await post(`/v1/activities/${id}/requests/${reqB.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'full');
    assert.equal((await post(`/v1/activities/${id}/requests`, c.token, {})).body.code, 'ACTIVITY_FULL');

    // venue/time change notifies attendees with previous/new values
    const upd = await call('PATCH', `/v1/activities/${id}`, host.token, { venueName: 'Caffe Navigli', startsAt: hours(2), endsAt: hours(4) });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const changed = (await get('/v1/notifications', a.token)).body.items.find((x: any) => x.type === 'activity_changed');
    assert.ok(changed);
    assert.equal(changed.data.previous.venueName, 'Bar Brera');
    assert.equal(changed.data.next.venueName, 'Caffe Navigli');

    // leaving revokes chat access immediately and frees a spot
    assert.equal((await post(`/v1/activities/${id}/leave`, b.token)).status, 201);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, b.token, { body: 'x' })).status, 403);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'published');

    // host removal revokes access immediately
    assert.equal((await call('DELETE', `/v1/activities/${id}/members/${a.id}`, host.token)).status, 200);
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a.token)).status, 403);

    // cancel: closes registration, notifies, keeps audit
    const reqC = await post(`/v1/activities/${id}/requests`, c.token, {});
    assert.equal(reqC.status, 201);
    assert.equal((await post(`/v1/activities/${id}/cancel`, host.token)).status, 201);
    assert.equal((await post(`/v1/activities/${id}/requests`, a.token, {})).body.code, 'ACTIVITY_CANCELLED');
    assert.equal((await get('/v1/activities?city=milan', c.token)).body.items.some((x: any) => x.id === id), false);
    const audit = await get(`/v1/admin/audit?objectType=activity&objectId=${id}`, adminToken);
    assert.ok(audit.body.items.some((e: any) => e.action === 'activity.cancel'));
  });

  it('never lets two approvals overfill a one-seat activity', async () => {
    const host = await verified('Host2');
    const u1 = await verified('P1');
    const u2 = await verified('P2');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 2 }))).body.id;
    const r1 = await post(`/v1/activities/${id}/requests`, u1.token, {});
    const r2 = await post(`/v1/activities/${id}/requests`, u2.token, {});
    const res = await Promise.all([
      post(`/v1/activities/${id}/requests/${r1.body.id}/decision`, host.token, { decision: 'approve' }),
      post(`/v1/activities/${id}/requests/${r2.body.id}/decision`, host.token, { decision: 'approve' }),
    ]);
    assert.deepEqual(res.map((r) => r.status).sort(), [201, 409]);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.going, 2);
  });

  it('supports favorites and a user-specific activity list', async () => {
    const host = await verified('Host3');
    const u = await verified('Fan');
    const id = (await post('/v1/activities', host.token, activityBody({ title: 'Favourite run', category: 'sports' }))).body.id;
    await post(`/v1/activities/${id}/favorite`, u.token);
    assert.equal((await get('/v1/me/favorites', u.token)).body.items[0].id, id);
    assert.equal((await get('/v1/me/activities', host.token)).body.joined[0].role, 'host');
  });
});

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
