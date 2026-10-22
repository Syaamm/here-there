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
  return { token: r.body.token as string, id: r.body.user.id as string, email };
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
  for (const f of ['test.db', 'test.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('HERE: create, discover, request, approve, chat', () => {
  it('runs the full P0 journey with access revocation', async () => {
    const host = await verified('Host');
    const a = await verified('Alex');
    const b = await verified('Marta');
    const c = await verified('Carl');

    // validation
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(-1), endsAt: hours(1) }))).body.code, 'INVALID_SCHEDULE');
    // HERE is for plans within a day: not sooner than ~10 minutes, not beyond tomorrow
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(0.05), endsAt: hours(2) }))).body.code, 'INVALID_SCHEDULE');
    assert.equal((await post('/v1/activities', host.token, activityBody({ startsAt: hours(72), endsAt: hours(74) }))).body.code, 'INVALID_SCHEDULE');
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

    // host removal revokes access immediately and, with nobody waiting, frees the place
    assert.equal((await call('DELETE', `/v1/activities/${id}/members/${a.id}`, host.token)).status, 200);
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, a.token)).status, 403);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'published');

    // cancel: closes registration, notifies, keeps audit
    const reqB2 = await post(`/v1/activities/${id}/requests`, b.token, {});
    assert.equal(reqB2.status, 201);
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

describe('identity verification: one-time, shared, expiring, minimal', () => {
  const yearMs = 365 * 24 * 3600 * 1000;
  const form = (url: string, outcome: string) =>
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `outcome=${outcome}` });
  const webhook = (payload: object, sign = true, provider = 'sandbox') => {
    const raw = Buffer.from(JSON.stringify(payload));
    return fetch(`${base}/v1/verification/webhook/${provider}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sandbox-signature': sign ? signSandbox(raw) : 'f'.repeat(64) },
      body: raw,
    });
  };
  /** Runs `fn` with the local sandbox provider switched on, then switches back to staff review. */
  async function sandbox<T>(fn: () => Promise<T>) {
    process.env.VERIFICATION_MODE = 'sandbox';
    try {
      return await fn();
    } finally {
      process.env.VERIFICATION_MODE = 'manual';
    }
  }
  async function startSandbox(name: string) {
    const u = await signup(name);
    await confirmEmail(u);
    const s = await post('/v1/me/verification', u.token, { consent: true });
    assert.equal(s.body.eligibility, 'pending');
    assert.match(s.body.url, /\/v1\/verification\/sandbox\/sbx_/);
    return { u, url: s.body.url as string, ref: s.body.url.split('/').pop() as string };
  }

  it('keeps email, adult and identity as three separate statuses', async () => {
    const u = await signup('Statuses');
    let me = (await get('/v1/me', u.token)).body;
    assert.deepEqual([me.emailVerified, me.adultConfirmed, me.adultVerified, me.eligibility, me.phoneVerified], [false, true, false, 'unverified', false]);

    await confirmEmail(u); // email alone unlocks nothing else
    me = (await get('/v1/me', u.token)).body;
    assert.deepEqual([me.emailVerified, me.adultVerified, me.eligibility], [true, false, 'unverified']);
    assert.equal((await post('/v1/activities', u.token, activityBody())).body.code, 'VERIFICATION_REQUIRED');

    const v = await verified('AllThree');
    me = (await get('/v1/me', v.token)).body;
    assert.deepEqual([me.emailVerified, me.adultVerified, me.eligibility, me.phoneVerified], [true, true, 'verified', false]);
    assert.ok(new Date(me.verifiedUntil).getTime() > Date.now() + yearMs - 3600 * 1000, 'valid for about a year');
  });

  it('runs a provider session end to end through a signed webhook, and only once', async () => {
    await sandbox(async () => {
      const { u, url, ref } = await startSandbox('Sbx');
      const page = await fetch(url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /SANDBOX PROVIDER/);

      assert.equal((await form(url.replace(/\/sbx_.*$/, `/${ref}/decide`), 'approve')).status, 201);
      const me = (await get('/v1/me', u.token)).body;
      assert.equal(me.eligibility, 'verified');
      assert.equal(me.adultVerified, true);

      // verified once, never asked again: more start calls open no new provider session
      for (let i = 0; i < 3; i++) assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'verified');
      assert.equal(await prisma.verificationCheck.count({ where: { userId: u.id } }), 1);

      // ...and the same account works for creating AND joining, in both products
      const host = await verified('SbxHost');
      const act = await post('/v1/activities', u.token, activityBody());
      assert.equal(act.status, 201);
      const trip = await post('/v1/trips', host.token, {
        destination: 'Lisbon, Portugal', originCity: 'Milan', budgetMin: 400, budgetMax: 900, budgetIncludesTransport: true,
        dateStart: new Date(Date.now() + 30 * 864e5).toISOString(), dateEnd: new Date(Date.now() + 35 * 864e5).toISOString(), groupSize: '4-6',
      });
      assert.equal(trip.status, 201);
      const apply = await post(`/v1/trips/${trip.body.id}/applications`, u.token, { intro: 'I would love to join this trip.', confirmBudget: true, confirmDates: true, confirmGuidelines: true });
      assert.equal(apply.status, 201);
      assert.equal(await prisma.verificationCheck.count({ where: { userId: u.id } }), 1, 'still a single check');
    });
  });

  it('authenticates provider webhooks by signature, ignores replays and unknown sessions', async () => {
    await sandbox(async () => {
      const { u, ref } = await startSandbox('Hook');
      const ok = { providerRef: ref, status: 'approved', adult: true };
      assert.equal((await webhook(ok, false)).status, 401); // forged
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'pending');
      assert.equal((await webhook({ providerRef: 'sbx_nope', status: 'approved', adult: true })).status, 404);
      assert.equal((await webhook({ providerRef: ref, status: 'bogus' })).status, 400);
      assert.equal((await webhook(ok)).status, 200);
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'verified');
      const again = await (await webhook({ providerRef: ref, status: 'declined', reason: 'document' })).json();
      assert.equal(again.ignored, true); // a late or duplicate message cannot flip a finished check
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'verified');
      assert.equal((await webhook(ok, true, 'veriff')).status, 404); // unknown provider
    });
  });

  it('never verifies someone the provider reports as under 18', async () => {
    await sandbox(async () => {
      const { u, url, ref } = await startSandbox('Minor');
      await form(url.replace(/\/sbx_.*$/, `/${ref}/decide`), 'underage');
      const me = (await get('/v1/me', u.token)).body;
      assert.equal(me.eligibility, 'rejected');
      assert.equal(me.adultVerified, false);
      assert.equal((await get('/v1/me/verification', u.token)).body.lastRejectionReason, 'underage');
      assert.equal((await post('/v1/activities', u.token, activityBody())).body.code, 'VERIFICATION_REQUIRED');
      const audit = await get(`/v1/admin/audit?objectType=user&objectId=${u.id}`, adminToken);
      assert.ok(audit.body.items.some((e: any) => e.action === 'verification.underage_detected'));
    });
  });

  it('keeps only the outcome: personal data in a provider message is never stored', async () => {
    await sandbox(async () => {
      const { u, ref } = await startSandbox('Minimal');
      const pii = { name: 'Mario Rossi', dateOfBirth: '1989-04-17', documentNumber: 'AX1234567', selfie: 'data:image/jpeg;base64,/9j/4AAQ', address: 'Via Roma 1' };
      assert.equal((await webhook({ providerRef: ref, status: 'approved', adult: true, ...pii })).status, 200);
      const check = await prisma.verificationCheck.findFirst({ where: { userId: u.id } });
      const user = await prisma.user.findUnique({ where: { id: u.id } });
      const audit = await get(`/v1/admin/audit?objectType=user&objectId=${u.id}`, adminToken);
      const everything = JSON.stringify([check, { ...user, passwordHash: '' }, audit.body.items, (await get('/v1/me', u.token)).body]);
      for (const secret of ['Mario', 'Rossi', '1989', 'AX1234567', 'base64', 'Via Roma']) assert.ok(!everything.includes(secret), `${secret} must not be stored`);
      assert.deepEqual(Object.keys(check).sort(), ['consentAt', 'createdAt', 'decidedAt', 'eligibility', 'expiresAt', 'id', 'provider', 'providerRef', 'rejectionReason', 'reviewedBy', 'userId']);
    });
  });

  it('requires a new check only when verification expires, and enforces it at once', async () => {
    const host = await verified('ExpHost');
    const member = await verified('ExpMember');
    const id = (await post('/v1/activities', host.token, activityBody())).body.id;
    const conv = await prisma.conversation.findUnique({ where: { activityId: id } });
    const req = await post(`/v1/activities/${id}/requests`, member.token, {});
    await post(`/v1/activities/${id}/requests/${req.body.id}/decision`, host.token, { decision: 'approve' });
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, member.token, { body: 'before expiry' })).status, 201);

    await prisma.user.update({ where: { id: member.id }, data: { verifiedUntil: new Date(Date.now() - 1000) } });
    const me = (await get('/v1/me', member.token)).body; // the very next request already sees it
    assert.equal(me.eligibility, 'expired');
    assert.equal(me.reverifyReason, 'expired');
    for (const r of [await post('/v1/activities', member.token, activityBody()), await get(`/v1/conversations/${conv.id}/messages`, member.token)]) {
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'VERIFICATION_REQUIRED');
      assert.equal(r.body.details.eligibility, 'expired');
    }
    assert.ok((await get('/v1/notifications', member.token)).body.items.some((n: any) => n.type === 'verification_result' && /expired/i.test(n.title)));
    // browsing still works
    assert.equal((await get('/v1/activities?city=milan', member.token)).status, 200);

    // the hourly sweep also lapses people who are not active
    const idle = await verified('Idle');
    await prisma.user.update({ where: { id: idle.id }, data: { verifiedUntil: new Date(Date.now() - 1000) } });
    assert.ok((await verificationSvc.expireDue()) >= 1);
    assert.equal((await prisma.user.findUnique({ where: { id: idle.id } })).eligibility, 'expired');

    // verifying again restores everything with a fresh validity period
    assert.equal((await post('/v1/me/verification', member.token, { consent: true })).body.eligibility, 'pending');
    const check = (await get('/v1/admin/verifications?status=pending', adminToken)).body.items.find((c: any) => c.user.id === member.id);
    await post(`/v1/admin/verifications/${check.id}/decision`, adminToken, { decision: 'verified' });
    const back = (await get('/v1/me', member.token)).body;
    assert.equal(back.eligibility, 'verified');
    assert.ok(new Date(back.verifiedUntil).getTime() > Date.now() + yearMs - 3600 * 1000);
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, member.token, { body: 'back again' })).status, 201);
  });

  it('lets trust staff force re-verification for a security or fraud concern', async () => {
    const target = await verified('Suspect');
    const bad = await post(`/v1/admin/users/${target.id}/require-reverification`, adminToken, { reason: 'weather', note: 'x' });
    assert.equal(bad.status, 400);

    // a moderator is not trust staff
    await prisma.user.create({ data: { email: 'mod@example.com', passwordHash: await bcrypt.hash('mod-password-1', 4), role: 'moderator', adultConfirmed: true, eligibility: 'verified', profile: { create: { displayName: 'Mod' } } } });
    const modToken = (await post('/v1/auth/login', undefined, { email: 'mod@example.com', password: 'mod-password-1' })).body.token;
    assert.equal((await post(`/v1/admin/users/${target.id}/require-reverification`, modToken, { reason: 'fraud_suspected', note: 'looks fake' })).status, 403);

    const r = await post(`/v1/admin/users/${target.id}/require-reverification`, adminToken, { reason: 'fraud_suspected', note: 'ID photo reused on 3 accounts' });
    assert.equal(r.status, 201);
    const me = (await get('/v1/me', target.token)).body;
    assert.equal(me.eligibility, 'reverification_required');
    assert.equal(me.reverifyReason, 'fraud_suspected');
    const blocked = await post('/v1/activities', target.token, activityBody());
    assert.equal(blocked.body.code, 'VERIFICATION_REQUIRED');
    assert.equal(blocked.body.details.eligibility, 'reverification_required');
    const audit = await get(`/v1/admin/audit?objectType=user&objectId=${target.id}`, adminToken);
    assert.ok(audit.body.items.some((e: any) => e.action === 'verification.reverification_required' && e.metadata.reason === 'fraud_suspected'));

    // a check that was already in flight is closed, so it cannot undo the decision
    const pendingUser = await signup('InFlight');
    await confirmEmail(pendingUser);
    await post('/v1/me/verification', pendingUser.token, { consent: true });
    const check = (await get('/v1/admin/verifications?status=pending', adminToken)).body.items.find((c: any) => c.user.id === pendingUser.id);
    await post(`/v1/admin/users/${pendingUser.id}/require-reverification`, adminToken, { reason: 'security', note: 'account takeover reported' });
    assert.equal((await post(`/v1/admin/verifications/${check.id}/decision`, adminToken, { decision: 'verified' })).body.code, 'ALREADY_DECIDED');
    assert.equal((await get('/v1/me', pendingUser.token)).body.eligibility, 'reverification_required');

    // and the user can complete a fresh check
    assert.equal((await post('/v1/me/verification', target.token, { consent: true })).body.eligibility, 'pending');
  });

  it('lets the provider withdraw an approval, which requires a new check', async () => {
    await sandbox(async () => {
      const { u, ref } = await startSandbox('Revoked');
      await webhook({ providerRef: ref, status: 'approved', adult: true });
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'verified');
      assert.equal((await webhook({ providerRef: ref, status: 'revoked' })).status, 200);
      const me = (await get('/v1/me', u.token)).body;
      assert.equal(me.eligibility, 'reverification_required');
      assert.equal(me.reverifyReason, 'provider_required');
      assert.equal((await post('/v1/activities', u.token, activityBody())).body.code, 'VERIFICATION_REQUIRED');
    });
  });

  it('verifies an optional mobile number without gating anything on it', async () => {
    const u = await signup('Phoney');
    assert.equal((await post('/v1/me/phone/send-code', u.token, { phone: '12345' })).body.code, 'VALIDATION_FAILED');
    limiter.reset();
    assert.equal((await post('/v1/me/phone/send-code', u.token, { phone: '+39 333 123 4567' })).status, 201);
    const sms = [...smsSvc.outbox].reverse().find((m: any) => m.to === '+393331234567');
    assert.ok(sms, 'the SMS went to the normalised number');
    const code = /(\d{6})/.exec(sms.text)![1];
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await post('/v1/me/phone/verify', u.token, { code: wrong })).body.code, 'INVALID_CODE');
    assert.equal((await post('/v1/me/phone/verify', u.token, { code })).body.phoneVerified, true);
    const me = (await get('/v1/me', u.token)).body;
    assert.equal(me.phoneVerified, true);
    assert.equal(me.phone, '+39••••67'); // masked, never returned in full
    assert.equal(me.eligibility, 'unverified'); // a verified phone does not stand in for identity verification
    assert.equal((await call('DELETE', '/v1/me/phone', u.token)).body.phoneVerified, false);
    // a code for the email channel cannot confirm a phone, and vice versa
    assert.equal((await post('/v1/me/phone/verify', u.token, { code })).status, 400);
  });

  it('lets anyone explore as a read-only guest without an account', async () => {
    const host = await verified('GuestHost');
    const actId = (await post('/v1/activities', host.token, activityBody())).body.id;
    const conv = await prisma.conversation.findUnique({ where: { activityId: actId } });

    const g = await post('/v1/auth/guest');
    assert.equal(g.status, 201);
    assert.equal(g.body.user.role, 'guest');
    const t = g.body.token as string;

    // explore: allowed
    assert.equal((await get('/v1/activities?city=milan', t)).status, 200);
    assert.equal((await get(`/v1/activities/${actId}`, t)).status, 200);
    assert.equal((await get('/v1/trips', t)).status, 200);
    assert.equal((await get(`/v1/users/${host.id}`, t)).status, 200);
    // anything that writes is refused by the server itself, whatever the app shows
    for (const r of [
      await post('/v1/activities', t, activityBody()),
      await post(`/v1/activities/${actId}/requests`, t, {}),
      await post(`/v1/activities/${actId}/favorite`, t),
      await post('/v1/reports', t, { targetType: 'user', targetId: host.id, category: 'spam' }),
      await post('/v1/blocks', t, { userId: host.id }),
      await post('/v1/me/verification', t, { consent: true }),
      await post('/v1/me/email/send-code', t),
    ]) {
      assert.equal(r.status, 403);
      assert.equal(r.body.code, 'GUEST_READ_ONLY');
    }
    // chat stays closed to guests, and a guest has no usable credentials
    assert.equal((await get(`/v1/conversations/${conv.id}/messages`, t)).status, 403);
    const guestRow = await prisma.user.findUnique({ where: { id: g.body.user.id } });
    assert.equal((await post('/v1/auth/login', undefined, { email: guestRow.email, password: 'anything-at-all-1' })).status, 401);

    // expired guests are deleted, along with everything attached to them
    const { GuestService } = await import('../src/auth/guest.service');
    await prisma.user.update({ where: { id: guestRow.id }, data: { createdAt: new Date(Date.now() - 25 * 3600 * 1000) } });
    assert.ok((await app.get(GuestService).purge()) >= 1);
    assert.equal(await prisma.user.findUnique({ where: { id: guestRow.id } }), null);
    assert.equal((await get('/v1/me', t)).status, 401); // the old token no longer works
  });

  const pendingCheck = async (userId: string) => (await get('/v1/admin/verifications?status=pending', adminToken)).body.items.find((c: any) => c.user.id === userId);
  const rejectNow = async (userId: string, reason?: string) =>
    post(`/v1/admin/verifications/${(await pendingCheck(userId)).id}/decision`, adminToken, { decision: 'rejected', ...(reason ? { reason } : {}) });
  async function moderatorToken() {
    await prisma.user.upsert({
      where: { email: 'mod2@example.com' }, update: {},
      create: { email: 'mod2@example.com', passwordHash: await bcrypt.hash('mod-password-1', 4), role: 'moderator', adultConfirmed: true, eligibility: 'verified', profile: { create: { displayName: 'Mod2' } } },
    });
    return (await post('/v1/auth/login', undefined, { email: 'mod2@example.com', password: 'mod-password-1' })).body.token as string;
  }
  async function trustLeadToken() {
    await prisma.user.upsert({
      where: { email: 'lead@example.com' }, update: {},
      create: { email: 'lead@example.com', passwordHash: await bcrypt.hash('lead-password-1', 4), role: 'trust_lead', adultConfirmed: true, eligibility: 'verified', profile: { create: { displayName: 'Lead' } } },
    });
    return (await post('/v1/auth/login', undefined, { email: 'lead@example.com', password: 'lead-password-1' })).body.token as string;
  }

  it('lets a rejected user try again, and lets a stuck check be cancelled', async () => {
    const u = await signup('Again');
    await confirmEmail(u);
    assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'pending');
    await rejectNow(u.id, 'document');
    assert.equal((await get('/v1/me', u.token)).body.eligibility, 'rejected');
    // a rejection is not the end: the same user simply starts again
    assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'pending');

    // closed the provider page and got stuck? cancel and start over
    assert.equal((await call('DELETE', '/v1/me/verification', u.token)).body.eligibility, 'unverified');
    const cancelled = await prisma.verificationCheck.findFirst({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(cancelled.rejectionReason, 'cancelled');
    assert.equal((await call('DELETE', '/v1/me/verification', u.token)).body.code, 'NOT_PENDING'); // nothing left to cancel
    assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'pending');
  });

  it('lets trust staff approve a wrongly rejected person, or reopen verification', async () => {
    const lead = await trustLeadToken();
    const wrong = await signup('Wronged');
    await confirmEmail(wrong);
    await post('/v1/me/verification', wrong.token, { consent: true });
    await rejectNow(wrong.id, 'document');

    // a rejected check itself cannot be flipped...
    assert.equal((await post(`/v1/admin/users/${wrong.id}/overturn-rejection`, await moderatorToken(), { note: 'photo was fine' })).status, 403); // moderators cannot
    assert.equal((await post(`/v1/admin/users/${wrong.id}/overturn-rejection`, lead, { note: 'x' })).status, 400); // a note is required
    // ...but a reviewer can overturn it as an appeal
    const ok = await post(`/v1/admin/users/${wrong.id}/overturn-rejection`, lead, { note: 'ID was genuine, photo was just dark' });
    assert.equal(ok.body.eligibility, 'verified');
    const me = (await get('/v1/me', wrong.token)).body;
    assert.deepEqual([me.eligibility, me.adultVerified], ['verified', true]);
    assert.equal((await post('/v1/activities', wrong.token, activityBody())).status, 201);
    const audit = await get(`/v1/admin/audit?objectType=user&objectId=${wrong.id}`, adminToken);
    assert.ok(audit.body.items.some((e: any) => e.action === 'verification.rejection_overturned' && e.metadata.previousReason === 'document'));
    assert.equal((await post(`/v1/admin/users/${wrong.id}/overturn-rejection`, lead, { note: 'again' })).body.code, 'NOT_REJECTED');

    // reopening: back to the start, an open check is closed, verified people are not reset
    const stuck = await signup('Stuck');
    await confirmEmail(stuck);
    await post('/v1/me/verification', stuck.token, { consent: true });
    const open = await pendingCheck(stuck.id);
    assert.equal((await post(`/v1/admin/users/${stuck.id}/reset-verification`, lead, { note: 'provider page broke' })).body.eligibility, 'unverified');
    assert.equal((await post(`/v1/admin/verifications/${open.id}/decision`, adminToken, { decision: 'verified' })).body.code, 'ALREADY_DECIDED');
    assert.equal((await post('/v1/me/verification', stuck.token, { consent: true })).body.eligibility, 'pending');
    assert.equal((await post(`/v1/admin/users/${wrong.id}/reset-verification`, lead, { note: 'no need' })).body.code, 'ALREADY_VERIFIED');
  });

  it('locks self-service retries after an under-18 result, until an admin reviews it', async () => {
    await sandbox(async () => {
      const lead = await trustLeadToken();
      const { u, url, ref } = await startSandbox('Young');
      await form(url.replace(/\/sbx_.*$/, `/${ref}/decide`), 'underage');
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'rejected');
      const retry = await post('/v1/me/verification', u.token, { consent: true });
      assert.equal(retry.status, 403);
      assert.equal(retry.body.code, 'VERIFICATION_BLOCKED');
      // trust leads can reopen it, but only an admin can approve an under-18 flag
      assert.equal((await post(`/v1/admin/users/${u.id}/overturn-rejection`, lead, { note: 'ID shows 19, provider misread' })).body.code, 'ADMIN_ONLY');
      assert.equal((await post(`/v1/admin/users/${u.id}/reset-verification`, lead, { note: 'reviewed the case by hand' })).body.eligibility, 'unverified');
      assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'pending');

      const { u: u2, url: url2, ref: ref2 } = await startSandbox('Young2');
      await form(url2.replace(/\/sbx_.*$/, `/${ref2}/decide`), 'underage');
      assert.equal((await post(`/v1/admin/users/${u2.id}/overturn-rejection`, adminToken, { note: 'admin reviewed the ID in person' })).body.eligibility, 'verified');
    });
  });

  it('allows five verification attempts a day, then asks the person to wait', async () => {
    const u = await signup('Spammer');
    await confirmEmail(u);
    for (let i = 0; i < 5; i++) {
      assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'pending');
      await rejectNow(u.id, 'document');
    }
    assert.equal((await post('/v1/me/verification', u.token, { consent: true })).status, 429);
  });

  it('stores one cropped webp profile picture per person and shows it on their activities', async () => {
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 900, height: 500, channels: 3, background: { r: 40, g: 120, b: 90 } } }).png().toBuffer();
    const u = await verified('Pic');
    const put = (token: string, body: Buffer, type = 'image/png') => fetch(`${base}/v1/me/photo`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': type }, body: new Uint8Array(body) });

    // upload: re-encoded as a square webp, and the profile points at it
    const ok = await put(u.token, png);
    assert.equal(ok.status, 200);
    const { photoUrl } = (await ok.json()) as any;
    assert.ok(photoUrl.startsWith(`/v1/users/${u.id}/photo?v=`), photoUrl);
    const img = await fetch(base + photoUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 384, 384]);
    assert.equal((await get('/v1/me', u.token)).body.profile.photoUrl, photoUrl);

    // other people see it on the host of an activity
    const viewer = await verified('Viewer');
    const a = await post('/v1/activities', u.token, activityBody({}));
    assert.equal((await get(`/v1/activities/${a.body.id}`, viewer.token)).body.host.photoUrl, photoUrl);

    // not an image, too big, guests: refused
    assert.equal((await put(u.token, Buffer.from('not an image'))).status, 400);
    assert.equal((await put(u.token, Buffer.alloc(7 * 1024 * 1024, 1))).status, 413);
    const guest = await post('/v1/auth/guest');
    assert.equal((await put(guest.body.token, png)).status, 403);

    // removing it clears the picture
    assert.equal((await call('DELETE', '/v1/me/photo', u.token)).status, 200);
    assert.equal((await fetch(base + photoUrl)).status, 404);
    assert.equal((await get('/v1/me', u.token)).body.profile.photoUrl, null);
  });

  it('refuses development-only verification modes in production', () => {
    const svc = new (verificationSvc.constructor as any)(null, null, null);
    const saved = { env: process.env.NODE_ENV, mode: process.env.VERIFICATION_MODE };
    try {
      process.env.NODE_ENV = 'production';
      for (const mode of ['sandbox', 'auto']) {
        process.env.VERIFICATION_MODE = mode;
        assert.throws(() => svc.onModuleInit(), /development only/);
      }
    } finally {
      process.env.NODE_ENV = saved.env;
      process.env.VERIFICATION_MODE = saved.mode;
    }
  });
});
