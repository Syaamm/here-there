// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-here.db';
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
  for (const f of ['test-p0-here.db', 'test-p0-here.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-here.db', 'test-p0-here.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('HERE: create, discover, request, approve, chat', () => {
  it('runs the full P0 journey with access revocation', async () => {
    const host = await verified('Host');
    const a = await verified('Alex');
    const b = await verified('Marta');
    const c = await verified('Carl');

    // validation
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(-1), endsAt: hours(1) }))).body.code, 'INVALID_SCHEDULE');
    // not sooner than ~10 minutes, and not beyond the planning limit (one month unless an admin sets it otherwise)
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(0.05), endsAt: hours(2) }))).body.code, 'INVALID_SCHEDULE');
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(24 * 45), endsAt: hours(24 * 45 + 2) }))).body.code, 'INVALID_SCHEDULE');
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

    // fill the activity: second approval makes it full, a third request goes on the waiting list
    const reqB = await post(`/v1/activities/${id}/requests`, b.token, {});
    await post(`/v1/activities/${id}/requests/${reqB.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'full');
    const waitC = await post(`/v1/activities/${id}/requests`, c.token, {});
    assert.equal(waitC.status, 201);
    assert.equal(waitC.body.state, 'waitlisted');

    // venue/time change notifies attendees with previous/new values
    const upd = await call('PATCH', `/v1/activities/${id}`, host.token, { venueName: 'Caffe Navigli', startsAt: hours(2), endsAt: hours(4) });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const changed = (await get('/v1/notifications', a.token)).body.items.find((x: any) => x.type === 'activity_changed');
    assert.ok(changed);
    assert.equal(changed.data.previous.venueName, 'Bar Brera');
    assert.equal(changed.data.next.venueName, 'Caffe Navigli');

    // leaving revokes chat access immediately; the freed place goes to the first person on the waiting list (c)
    assert.equal((await post(`/v1/activities/${id}/leave`, b.token)).status, 201);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, b.token, { body: 'x' })).status, 403);
    assert.equal((await get(`/v1/activities/${id}`, c.token)).body.isMember, true);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'full');

    // host removal revokes access immediately and, with nobody waiting, frees the place (the host and c are still going,
    // so it is no longer full but is confirmed)
    assert.equal((await call('DELETE', `/v1/activities/${id}/members/${a.id}`, host.token)).status, 200);
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a.token)).status, 403);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'confirmed');

    // cancel: closes registration, notifies, keeps audit
    const reqB2 = await post(`/v1/activities/${id}/requests`, b.token, {});
    assert.equal(reqB2.status, 201);
    assert.equal((await post(`/v1/activities/${id}/cancel`, host.token)).status, 201);
    assert.equal((await post(`/v1/activities/${id}/requests`, a.token, {})).body.code, 'ACTIVITY_CANCELLED');
    assert.equal((await get('/v1/activities?city=milan', c.token)).body.items.some((x: any) => x.id === id), false);
    const audit = await get(`/v1/admin/audit?objectType=activity&objectId=${id}`, adminToken);
    assert.ok(audit.body.items.some((e: any) => e.action === 'activity.cancel'));
  });

  it('lets people into an instant-join activity at once, while still guarding places, verification and removals', async () => {
    const host = await verified('InstantHost');
    const u1 = await verified('Quick1');
    const u2 = await verified('Quick2');
    const u3 = await verified('Quick3');
    const lurker = await signup('Quick4');

    // manual approval stays the default, and only the two known policies are accepted
    assert.equal((await post('/v1/activities', host.token, activityBody({ joinPolicy: 'whoever' }))).body.code, 'VALIDATION_FAILED');
    const manual = await post('/v1/activities', host.token, activityBody({ title: 'Manual one', venueName: 'Bar Uno', startsAt: hours(5), endsAt: hours(7) }));
    assert.equal(manual.body.joinPolicy, 'host_approval');
    assert.equal((await post(`/v1/activities/${manual.body.id}/requests`, u3.token, {})).body.state, 'requested');

    const made = await post('/v1/activities', host.token, activityBody({ joinPolicy: 'instant' })); // 3 places with the host
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = made.body.id;
    assert.equal(made.body.joinPolicy, 'instant');

    // an unverified person is still turned away
    assert.equal((await post(`/v1/activities/${id}/requests`, lurker.token, {})).body.code, 'VERIFICATION_REQUIRED');

    // no waiting for the host: a member, with chat, straight away; the host is told, but there is nothing to approve
    const r1 = await post(`/v1/activities/${id}/requests`, u1.token, {});
    assert.equal(r1.status, 201);
    assert.equal(r1.body.state, 'approved');
    const seen = await get(`/v1/activities/${id}`, u1.token);
    assert.equal(seen.body.isMember, true);
    assert.ok(seen.body.conversationId);
    assert.equal((await post(`/v1/conversations/${seen.body.conversationId}/messages`, u1.token, { body: 'Hello all' })).status, 201);
    const alerts = (await get('/v1/notifications', host.token)).body.items;
    assert.ok(alerts.some((x: any) => x.type === 'member_joined' && x.data.activityId === id));
    assert.equal(alerts.some((x: any) => x.type === 'join_request' && x.data?.activityId === id), false);
    assert.equal((await post(`/v1/activities/${id}/requests`, u1.token, {})).body.code, 'ALREADY_REQUESTED');

    // the last place fills it; the next person waits in line and is let in automatically when a place opens
    assert.equal((await post(`/v1/activities/${id}/requests`, u2.token, {})).body.state, 'approved');
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'full');
    const waiting = await post(`/v1/activities/${id}/requests`, u3.token, {});
    assert.equal(waiting.body.state, 'waitlisted');
    assert.equal((await post(`/v1/activities/${id}/leave`, u1.token)).status, 201);
    assert.equal((await get(`/v1/activities/${id}`, u3.token)).body.isMember, true);

    // a person the host removed cannot just walk back in
    assert.equal((await call('DELETE', `/v1/activities/${id}/members/${u2.id}`, host.token)).status, 200);
    assert.equal((await post(`/v1/activities/${id}/requests`, u2.token, {})).body.code, 'ALREADY_REQUESTED');
    assert.equal((await get(`/v1/activities/${id}`, u2.token)).body.isMember, false);
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

  it('keeps a waiting list for a full activity and lets the first person in when a member leaves', async () => {
    const host = await verified('WHost');
    const member = await verified('WMember');
    const first = await verified('WFirst');
    const second = await verified('WSecond');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 2 }))).body.id;
    const joined = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    // the host and one member fill both places: further requests join the waiting list, in order
    const a = await post(`/v1/activities/${id}/requests`, first.token, {});
    assert.equal(a.status, 201);
    assert.equal(a.body.state, 'waitlisted');
    assert.equal(a.body.position, 1);
    const b = await post(`/v1/activities/${id}/requests`, second.token, {});
    assert.equal(b.body.state, 'waitlisted');
    assert.equal(b.body.position, 2);
    assert.equal((await get(`/v1/activities/${id}`, second.token)).body.myRequest.position, 2);
    // the member leaves: the first in line gets in and is told, the second moves up
    assert.ok((await post(`/v1/activities/${id}/leave`, member.token)).status < 300);
    const d1 = (await get(`/v1/activities/${id}`, first.token)).body;
    assert.equal(d1.isMember, true);
    assert.equal(d1.myRequest.state, 'approved');
    assert.equal(d1.going, 2);
    assert.ok((await get('/v1/notifications', first.token)).body.items.some((n: { type: string }) => n.type === 'waitlist_promoted'));
    const d2 = (await get(`/v1/activities/${id}`, second.token)).body;
    assert.equal(d2.isMember, false);
    assert.equal(d2.myRequest.state, 'waitlisted');
    assert.equal(d2.myRequest.position, 1);
  });

  it('ranks the feed for the viewer (friends first), pages without repeats, and keeps time order by default', async () => {
    const viewer = await verified('RViewer');
    const friend = await verified('RFriend');
    const stranger = await verified('RStranger');
    const city = 'Rankville';
    // identical plans; the only difference is that the viewer follows one of the hosts
    const bStranger = (await post('/v1/activities', stranger.token, activityBody({ city, title: 'Coffee one', category: 'coffee', startsAt: hours(3), endsAt: hours(4) }))).body.id;
    const bFriend = (await post('/v1/activities', friend.token, activityBody({ city, title: 'Coffee two', category: 'coffee', startsAt: hours(3), endsAt: hours(4) }))).body.id;
    const later = (await post('/v1/activities', stranger.token, activityBody({ city, title: 'Late walk', category: 'sports', startsAt: hours(20), endsAt: hours(21) }))).body.id;
    assert.equal((await post('/v1/follows', viewer.token, { userId: friend.id })).status, 201);

    const ranked = await get(`/v1/activities?city=${city}&from=${encodeURIComponent(hours(0))}&to=${encodeURIComponent(hours(30))}&sort=relevance`, viewer.token);
    assert.equal(ranked.status, 200, JSON.stringify(ranked.body));
    const order = ranked.body.items.map((x: { id: string }) => x.id);
    assert.equal(order.length, 3);
    assert.ok(order.indexOf(bFriend) < order.indexOf(bStranger), 'the followed host comes first');
    assert.equal(order[2], later, 'much later and nobody you know comes last');
    assert.equal(ranked.body.items[0].followingGoing, 1);
    assert.equal(ranked.body.items[0].buddiesGoing, 0);

    // one at a time: every activity exactly once, same order as the single page
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page: Res = await get(`/v1/activities?city=${city}&from=${encodeURIComponent(hours(0))}&to=${encodeURIComponent(hours(30))}&sort=relevance&limit=1${cursor ? `&cursor=${cursor}` : ''}`, viewer.token);
      seen.push(...page.body.items.map((x: { id: string }) => x.id));
      cursor = page.body.nextCursor;
      if (!cursor) break;
    }
    assert.deepEqual(seen, order);
    assert.equal((await get(`/v1/activities?city=${city}&sort=relevance&cursor=junk`, viewer.token)).status, 400);

    // the default is still soonest first
    const timed = await get(`/v1/activities?city=${city}&from=${encodeURIComponent(hours(0))}&to=${encodeURIComponent(hours(30))}`, viewer.token);
    assert.equal(timed.body.items[2].id, later);
  });

  it('pages favourites, alerts and My activities with a cursor, without repeats or gaps', async () => {
    const me = await verified('PMe');
    const other = await verified('POther');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await post('/v1/activities', other.token, activityBody({ title: `Paging plan ${i}`, city: 'Pageville', startsAt: hours(2 + i * 3), endsAt: hours(3 + i * 3) }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      ids.push(r.body.id);
      assert.equal((await post(`/v1/activities/${r.body.id}/favorite`, me.token)).status < 300, true);
    }
    // favourites: newest saved first, 2 then 1, with the whole count
    const f1 = await get('/v1/me/favorites?limit=2', me.token);
    assert.equal(f1.body.items.length, 2);
    assert.equal(f1.body.total, 3);
    assert.ok(f1.body.nextCursor);
    const f2 = await get(`/v1/me/favorites?limit=2&cursor=${f1.body.nextCursor}`, me.token);
    assert.equal(f2.body.items.length, 1);
    assert.equal(f2.body.nextCursor, null);
    assert.deepEqual([...f1.body.items, ...f2.body.items].map((a: { id: string }) => a.id), [...ids].reverse());
    assert.equal((await get('/v1/me/favorites?cursor=junk', me.token)).status, 400);

    // alerts: three people follow `me`; two pages, no chat alerts, every alert once
    for (const n of ['PF1', 'PF2', 'PF3']) {
      const f = await verified(n);
      assert.equal((await post('/v1/follows', f.token, { userId: me.id })).status, 201);
    }
    const a1 = await get('/v1/notifications?scope=alerts&limit=2', me.token);
    assert.equal(a1.body.items.length, 2);
    assert.ok(a1.body.nextCursor);
    const a2 = await get(`/v1/notifications?scope=alerts&limit=2&cursor=${a1.body.nextCursor}`, me.token);
    const alertIds = [...a1.body.items, ...a2.body.items].map((n: { id: string }) => n.id);
    assert.equal(new Set(alertIds).size, alertIds.length, 'no repeats');
    const everyAlert = (await get('/v1/notifications?scope=alerts&limit=100', me.token)).body.items;
    assert.equal(everyAlert.filter((n: { type: string }) => n.type === 'follow').length, 3);
    assert.deepEqual(alertIds, everyAlert.map((n: { id: string }) => n.id).slice(0, alertIds.length), 'the pages are the newest alerts in order');

    // My activities: `me` hosts two and asks to join one of `other`'s
    for (let i = 0; i < 2; i++) assert.equal((await post('/v1/activities', me.token, activityBody({ title: `My own plan ${i}`, city: 'Pageville', startsAt: hours(2 + i * 4), endsAt: hours(3 + i * 4) }))).status, 201);
    assert.equal((await post(`/v1/activities/${ids[2]}/requests`, me.token, {})).status, 201);
    const m1 = await get('/v1/me/activities/page?tab=mine&limit=1', me.token);
    assert.equal(m1.body.items.length, 1);
    assert.deepEqual(m1.body.counts, { mine: 2, pending: 1, rejected: 0 });
    const m2 = await get(`/v1/me/activities/page?tab=mine&limit=1&cursor=${m1.body.nextCursor}`, me.token);
    assert.equal(m2.body.items.length, 1);
    assert.equal(m2.body.nextCursor, null);
    assert.notEqual(m1.body.items[0].id, m2.body.items[0].id);
    const pend = await get('/v1/me/activities/page?tab=pending', me.token);
    assert.equal(pend.body.items.length, 1);
    assert.equal(pend.body.items[0].state, 'requested');
    assert.equal(pend.body.items[0].activity.id, ids[2]);
  });

  it('pages connections and the chat list, and answers the recent, soon and overlapping plan views', async () => {
    const me = await verified('QMe');
    const [a, b, c, d] = [await verified('QA'), await verified('QB'), await verified('QC'), await verified('QD')];
    // I follow A, B and C; A and D follow me: A is a buddy, B and C only followed, D only a follower
    for (const o of [a, b, c]) assert.equal((await post('/v1/follows', me.token, { userId: o.id })).status, 201);
    for (const o of [a, d]) assert.equal((await post('/v1/follows', o.token, { userId: me.id })).status, 201);
    const f1 = await get('/v1/me/connections?kind=following&limit=1', me.token);
    assert.deepEqual(f1.body.counts, { following: 2, followers: 1, buddies: 1 });
    assert.equal(f1.body.items.length, 1);
    const f2 = await get(`/v1/me/connections?kind=following&limit=1&cursor=${f1.body.nextCursor}`, me.token);
    assert.equal(f2.body.items.length, 1);
    assert.equal(f2.body.nextCursor, null);
    assert.deepEqual([f1.body.items[0].userId, f2.body.items[0].userId].sort(), [b.id, c.id].sort());
    const buddies = (await get('/v1/me/connections?kind=buddies', me.token)).body.items;
    assert.deepEqual(buddies.map((x: { userId: string; buddy: boolean }) => [x.userId, x.buddy]), [[a.id, true]]);
    const followers = (await get('/v1/me/connections?kind=followers', me.token)).body.items;
    assert.deepEqual(followers.map((x: { userId: string; following: boolean }) => [x.userId, x.following]), [[d.id, false]]);
    // blocking someone takes them out of the lists and the counts
    assert.equal((await post('/v1/blocks', me.token, { userId: d.id })).status, 201);
    assert.equal((await get('/v1/me/connections?kind=followers', me.token)).body.counts.followers, 0);

    // three plans of my own, so three chats; a message in the second puts it first
    const plans: string[] = [];
    for (const [i, h] of [2, 6, 10].entries()) {
      const r = await post('/v1/activities', me.token, activityBody({ title: `Chat plan ${i}`, city: 'Chatville', startsAt: hours(h), endsAt: hours(h + 1) }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      plans.push(r.body.id);
    }
    const conv = await prisma.conversation.findUnique({ where: { activityId: plans[1] } });
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, me.token, { body: 'hello group' })).status, 201);
    const c1 = await get('/v1/me/conversations?limit=2', me.token);
    assert.equal(c1.body.items.length, 2);
    assert.equal(c1.body.items[0].scopeId, plans[1], 'the chat with the newest message comes first');
    assert.equal(c1.body.items[0].lastMessage.body, 'hello group');
    assert.ok(c1.body.nextCursor);
    const c2 = await get(`/v1/me/conversations?limit=2&cursor=${c1.body.nextCursor}`, me.token);
    assert.equal(c2.body.items.length, 1);
    assert.equal(c2.body.nextCursor, null);
    const chatIds = [...c1.body.items, ...c2.body.items].map((x: { scopeId: string }) => x.scopeId);
    assert.deepEqual([...chatIds].sort(), [...plans].sort());
    assert.equal((await get('/v1/me/conversations?cursor=junk', me.token)).status, 400);

    // soon: only the plan inside the window; overlapping: only the plan at that time; all: both kinds, newest start first
    const soon = await get('/v1/me/activities/soon?hours=4', me.token);
    assert.deepEqual(soon.body.joined.map((x: { id: string }) => x.id), [plans[0]]);
    const clash = await get(`/v1/me/activities/overlapping?from=${encodeURIComponent(hours(5.5))}&to=${encodeURIComponent(hours(6.5))}`, me.token);
    assert.deepEqual(clash.body.joined.map((x: { id: string }) => x.id), [plans[1]]);
    const clashExcluded = await get(`/v1/me/activities/overlapping?from=${encodeURIComponent(hours(5.5))}&to=${encodeURIComponent(hours(6.5))}&exclude=${plans[1]}`, me.token);
    assert.equal(clashExcluded.body.joined.length, 0);
    assert.equal((await get('/v1/me/activities/overlapping', me.token)).status, 400);
    const all = await get('/v1/me/activities/page?tab=all&limit=2', me.token);
    assert.deepEqual(all.body.items.map((x: { id: string; row: string }) => [x.id, x.row]), [[plans[2], 'joined'], [plans[1], 'joined']]);
    assert.ok(all.body.nextCursor);
  });

  it('answers 304 with no body when nothing changed since the last time', async () => {
    const u = await verified('PTag');
    const first = await fetch(base + '/v1/me/favorites', { headers: { authorization: `Bearer ${u.token}` } });
    const tag = first.headers.get('etag');
    assert.ok(tag, 'the answer carries a version tag');
    const again = await fetch(base + '/v1/me/favorites', { headers: { authorization: `Bearer ${u.token}`, 'if-none-match': tag! } });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0);
  });

  it('skips a blocked person at the front of the waiting list and lets in the next one', async () => {
    const host = await verified('GHost');
    const member = await verified('GMember');
    const blocked = await verified('GBlocked');
    const next = await verified('GNext');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 2 }))).body.id;
    const joined = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await post(`/v1/activities/${id}/requests`, blocked.token, {})).body.state, 'waitlisted');
    assert.equal((await post(`/v1/activities/${id}/requests`, next.token, {})).body.position, 2);
    assert.equal((await post('/v1/blocks', host.token, { userId: blocked.id })).status, 201);
    assert.ok((await post(`/v1/activities/${id}/leave`, member.token)).status < 300);
    assert.equal((await get(`/v1/activities/${id}`, next.token)).body.isMember, true, 'the next person in line is let in');
  });

  it('asks attendees to reconfirm a changed plan, and refuses duplicate activities', async () => {
    const host = await verified('RHost');
    const member = await verified('RMember');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 4 }))).body.id;
    // the same plan again, at the same time, is refused
    assert.equal((await post('/v1/activities', host.token, activityBody({ capacity: 4 }))).body.code, 'DUPLICATE_ACTIVITY');
    const r = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${r.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await get(`/v1/activities/${id}`, member.token)).body.needsReconfirm, false);
    // a new venue is a material change: the member is told and asked to confirm
    assert.ok((await call('PATCH', `/v1/activities/${id}`, host.token, { venueName: 'Another Bar' })).status < 300);
    assert.equal((await get(`/v1/activities/${id}`, member.token)).body.needsReconfirm, true);
    assert.equal((await post(`/v1/activities/${id}/reconfirm`, member.token)).status, 201);
    assert.equal((await get(`/v1/activities/${id}`, member.token)).body.needsReconfirm, false);
  });

  it('hands hosting over only when the member explicitly accepts, and attendance is voluntary and your own', async () => {
    const host = await verified('HHost');
    const member = await verified('HMember');
    const other = await verified('HOther');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 4 }))).body.id;
    const r = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${r.body.id}/decision`, host.token, { decision: 'approve' });
    // only an approved member can be offered hosting; nothing changes until they accept
    assert.equal((await post(`/v1/activities/${id}/handover`, host.token, { userId: other.id })).status, 404);
    assert.equal((await post(`/v1/activities/${id}/handover`, member.token, { userId: member.id })).status, 403);
    assert.equal((await post(`/v1/activities/${id}/handover`, host.token, { userId: member.id })).status, 201);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.isHost, true);
    assert.equal((await get(`/v1/activities/${id}`, member.token)).body.handover.toMe, true);
    assert.equal((await post(`/v1/activities/${id}/handover/answer`, other.token, { accept: true })).status, 404);
    assert.equal((await post(`/v1/activities/${id}/handover/answer`, member.token, { accept: true })).status, 201);
    assert.equal((await get(`/v1/activities/${id}`, member.token)).body.isHost, true);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.isHost, false);
    assert.ok((await get('/v1/notifications', host.token)).body.items.some((n: { type: string }) => n.type === 'host_handover_accepted'));
    // the former host may now leave like anyone else
    // attendance: not before it ends, then only for oneself, once approved
    assert.equal((await post(`/v1/activities/${id}/attendance`, member.token, { attended: true })).body.code, 'NOT_FINISHED');
    await prisma.activity.update({ where: { id }, data: { startsAt: new Date(Date.now() - 4 * 3600e3), endsAt: new Date(Date.now() - 3600e3) } });
    assert.equal((await post(`/v1/activities/${id}/attendance`, member.token, { attended: true })).body.attendance, 'attended');
    assert.equal((await post(`/v1/activities/${id}/attendance`, other.token, { attended: true })).status, 404);
    assert.equal((await get(`/v1/activities/${id}`, member.token)).body.myAttendance, 'attended');
  });

  it('takes away the host alert for a request once that request is answered, however it was answered', async () => {
    const host = await verified('AlertHost');
    const eli = await verified('AlertEli');
    const cris = await verified('AlertCris');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 5 }))).body.id;
    const re = await post(`/v1/activities/${id}/requests`, eli.token, {});
    const rc = await post(`/v1/activities/${id}/requests`, cris.token, {});
    const alerts = async () => (await get('/v1/notifications', host.token)).body.items.filter((n: any) => n.type === 'join_request');
    assert.equal((await alerts()).length, 2);
    // answering Cristiano's request (from the list, not from his alert) clears his alert and leaves Eli's
    assert.equal((await post(`/v1/activities/${id}/requests/${rc.body.id}/decision`, host.token, { decision: 'approve' })).status, 201);
    const left = await alerts();
    assert.equal(left.length, 1);
    assert.match(left[0].body, /^AlertEli/);
    // Eli withdrawing also clears his
    assert.ok((await call('DELETE', `/v1/activities/${id}/requests/mine`, eli.token)).status < 300);
    assert.equal((await alerts()).length, 0);
    void re;

    // the same for a trip application
    const t = (await post('/v1/trips', host.token, {
      title: 'Alert trip', destination: 'Lisbon, Portugal', originCity: 'Milan',
      dateStart: new Date(Date.now() + 40 * 864e5).toISOString(), dateEnd: new Date(Date.now() + 46 * 864e5).toISOString(),
      dateFlexibility: 'exact', budgetMin: 500, budgetMax: 900, budgetIncludesTransport: true, tags: [], groupSize: '4-6',
    })).body;
    const body = { intro: 'I love culture and food.', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
    const ae = await post(`/v1/trips/${t.id}/applications`, eli.token, body);
    const ac = await post(`/v1/trips/${t.id}/applications`, cris.token, body);
    const tripAlerts = async () => (await get('/v1/notifications', host.token)).body.items.filter((n: any) => n.type === 'trip_application');
    assert.equal((await tripAlerts()).length, 2);
    await post(`/v1/trips/${t.id}/applications/${ac.body.id}/decision`, host.token, { decision: 'decline' });
    const rest = await tripAlerts();
    assert.equal(rest.length, 1);
    assert.match(rest[0].body, /^AlertEli/);
    void ae;
  });

  it('delivers chat messages live over the WebSocket and pushes to members who are away', async () => {
    const { WebSocket } = await import('ws');
    const waitFor = async (ok: () => boolean) => {
      for (let i = 0; i < 60 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(ok(), 'timed out');
    };
    const host = await verified('LiveHost');
    const member = await verified('LiveMember');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 3 }))).body.id;
    const joined = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });

    // the member opens the app: a live connection, signed in by its first message (never by the address)
    const events: any[] = [];
    const ws = new WebSocket(base.replace('http', 'ws') + '/v1/live');
    let ready = false;
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.type === 'ready') ready = true;
      else events.push(e);
    });
    await new Promise<void>((res) => ws.on('open', () => res()));
    ws.send(JSON.stringify({ type: 'auth', token: member.token }));
    await waitFor(() => ready);

    // the host writes: the member's open app hears it at once, with the alert
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, host.token, { body: 'hello live' })).status, 201);
    await waitFor(() => events.some((e) => e.type === 'message'));
    const live = events.find((e) => e.type === 'message');
    assert.equal(live.conversationId, conv.id);
    assert.equal(live.message.body, 'hello live');
    assert.equal(live.message.sender.id, host.id);
    assert.ok(events.some((e) => e.type === 'notification'));

    // a connection with a bad token is turned away
    const bad = new WebSocket(base.replace('http', 'ws') + '/v1/live');
    await new Promise<void>((res) => bad.on('open', () => res()));
    const closed = new Promise<number>((res) => bad.on('close', (code) => res(code)));
    bad.send(JSON.stringify({ type: 'auth', token: 'not-a-real-token' }));
    assert.equal(await closed, 4003);

    // push: an address is stored per device; a member who is away gets every message pushed (Expo's service is stubbed here)
    assert.equal((await post('/v1/push/subscribe', member.token, { kind: 'expo', token: 'ExponentPushToken[abcdefghijkl]' })).status, 201);
    assert.equal(await prisma.pushSubscription.count({ where: { userId: member.id } }), 1);
    assert.equal((await get('/v1/push/config', member.token)).status, 200);
    ws.close();
    await waitFor(() => ws.readyState === WebSocket.CLOSED);
    await new Promise((r) => setTimeout(r, 200)); // the server notices the close
    const pushed: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).startsWith('https://exp.host/')) {
        pushed.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
      }
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      assert.equal((await post(`/v1/conversations/${conv.id}/messages`, host.token, { body: 'hello push' })).status, 201);
      await waitFor(() => pushed.length > 0);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(pushed[0].to, 'ExponentPushToken[abcdefghijkl]');
    assert.ok(pushed[0].body.includes('hello push'));
    assert.equal(pushed[0].data.url, `/chat/${conv.id}`);
  });

  it('tells only the members of a group when its members or details change, so open chat screens need no polling', async () => {
    const { WebSocket } = await import('ws');
    const waitFor = async (ok: () => boolean) => {
      for (let i = 0; i < 80 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(ok(), 'timed out');
    };
    const connect = async (token: string) => {
      const events: any[] = [];
      const ws = new WebSocket(base.replace('http', 'ws') + '/v1/live');
      let ready = false;
      ws.on('message', (raw) => {
        const e = JSON.parse(raw.toString());
        if (e.type === 'ready') ready = true;
        else events.push(e);
      });
      await new Promise<void>((res) => ws.on('open', () => res()));
      ws.send(JSON.stringify({ type: 'auth', token }));
      await waitFor(() => ready);
      return { ws, events };
    };
    const host = await verified('GroupHost');
    const first = await verified('GroupFirst');
    const second = await verified('GroupSecond');
    const stranger = await verified('GroupStranger');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 4 }))).body.id;
    const r1 = await post(`/v1/activities/${id}/requests`, first.token, {});
    await post(`/v1/activities/${id}/requests/${r1.body.id}/decision`, host.token, { decision: 'approve' });
    const inside = await connect(first.token);
    const outside = await connect(stranger.token);

    // a second person is approved: the people already in the group are told which group changed (and nothing else)
    const r2 = await post(`/v1/activities/${id}/requests`, second.token, {});
    await post(`/v1/activities/${id}/requests/${r2.body.id}/decision`, host.token, { decision: 'approve' });
    await waitFor(() => inside.events.some((e) => e.type === 'group-changed'));
    assert.deepEqual(inside.events.find((e) => e.type === 'group-changed'), { type: 'group-changed', kind: 'activity', id });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(outside.events.some((e) => e.type === 'group-changed'), false, 'a person outside the group hears nothing');
    inside.ws.close();
    outside.ws.close();
  });

  it('pushes to a member whose app is open but not on screen, and not to one who is looking at it', async () => {
    const { WebSocket } = await import('ws');
    const waitFor = async (ok: () => boolean) => {
      for (let i = 0; i < 60 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
      assert.ok(ok(), 'timed out');
    };
    const host = await verified('PresHost');
    const member = await verified('PresMember');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 3 }))).body.id;
    const joined = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    await post('/v1/push/subscribe', member.token, { kind: 'expo', token: 'ExponentPushToken[presencetest01]' });

    const ws = new WebSocket(base.replace('http', 'ws') + '/v1/live');
    let ready = false;
    ws.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'ready') ready = true;
    });
    await new Promise<void>((res) => ws.on('open', () => res()));
    ws.send(JSON.stringify({ type: 'auth', token: member.token }));
    await waitFor(() => ready);

    const pushed: any[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init?: any) => {
      if (String(url).startsWith('https://exp.host/')) {
        pushed.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
      }
      return realFetch(url, init);
    }) as typeof fetch;
    try {
      // open but hidden (another tab, or behind another window): the push still goes out
      ws.send(JSON.stringify({ type: 'presence', visible: false }));
      await new Promise((r) => setTimeout(r, 150));
      await post(`/v1/conversations/${conv.id}/messages`, host.token, { body: 'while hidden' });
      await waitFor(() => pushed.some((p) => p.body.includes('while hidden')));
      // on screen: they see it live, so no push
      ws.send(JSON.stringify({ type: 'presence', visible: true }));
      await new Promise((r) => setTimeout(r, 150));
      await post(`/v1/conversations/${conv.id}/messages`, host.token, { body: 'while looking' });
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(pushed.some((p) => p.body.includes('while looking')), false);
    } finally {
      globalThis.fetch = realFetch;
      ws.close();
    }
  });

  it('only reads a chat alert when the app says the chat is open in front of the person', async () => {
    const host = await verified('ReadHost');
    const member = await verified('ReadMember');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 3 }))).body.id;
    const joined = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    await post(`/v1/conversations/${conv.id}/messages`, host.token, { body: 'ping' });
    const unread = async () => (await get('/v1/notifications', member.token)).body.items.filter((n: { type: string; readAt: string | null }) => n.type === 'chat_message' && !n.readAt).length;
    assert.equal(await unread(), 1);
    // a background load (the app opening, a reload behind another screen) leaves the alert alone
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, member.token)).status, 200);
    assert.equal(await unread(), 1);
    // the chat open in front of the person clears it
    assert.equal((await get(`/v1/conversations/${conv.id}/messages?read=1`, member.token)).status, 200);
    assert.equal(await unread(), 0);
  });

  it('supports favorites and a user-specific activity list', async () => {
    const host = await verified('Host3');
    const u = await verified('Fan');
    const id = (await post('/v1/activities', host.token, activityBody({ title: 'Favourite run', category: 'sports' }))).body.id;
    await post(`/v1/activities/${id}/favorite`, u.token);
    assert.equal((await get('/v1/me/favorites', u.token)).body.items[0].id, id);
    assert.equal((await get('/v1/me/activities', host.token)).body.joined[0].role, 'host');
  });

  it('does not let a cancelled or started activity be saved or shared, but always lets a saved one be removed', async () => {
    const host = await verified('HostClosed');
    const fan = await verified('FanClosed');
    const shareStatus = async (id: string) => (await fetch(`${base}/a/${id}`, { redirect: 'manual' })).status;
    const ahead = (await post('/v1/activities', host.token, activityBody({ title: 'Still ahead' }))).body.id as string;
    assert.equal((await post(`/v1/activities/${ahead}/favorite`, fan.token)).status < 300, true);
    assert.equal(await shareStatus(ahead), 200);

    // cancelled: it cannot be saved, it has no share page, and a copy saved earlier can still be removed
    assert.equal((await post(`/v1/activities/${ahead}/cancel`, host.token)).status, 201);
    const cancelled = (await post('/v1/activities', host.token, activityBody({ title: 'Cancelled soon' }))).body.id as string;
    assert.equal((await post(`/v1/activities/${cancelled}/cancel`, host.token)).status, 201);
    const refused = await post(`/v1/activities/${cancelled}/favorite`, fan.token);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'ACTIVITY_CLOSED');
    assert.equal(await shareStatus(cancelled), 404);
    assert.equal((await call('DELETE', `/v1/activities/${ahead}/favorite`, fan.token)).status, 200);

    // started: the same
    const started = (await post('/v1/activities', host.token, activityBody({ title: 'Already running' }))).body.id as string;
    assert.equal(await shareStatus(started), 200);
    await prisma.activity.update({ where: { id: started }, data: { startsAt: new Date(Date.now() - 600_000), endsAt: new Date(Date.now() + 3_600_000) } });
    assert.equal((await post(`/v1/activities/${started}/favorite`, fan.token)).body.code, 'ACTIVITY_CLOSED');
    assert.equal(await shareStatus(started), 404);
  });
});
