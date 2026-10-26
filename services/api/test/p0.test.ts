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
      assert.deepEqual(Object.keys(check).sort(), ['consentAt', 'createdAt', 'decidedAt', 'eligibility', 'expiresAt', 'id', 'method', 'provider', 'providerRef', 'rejectionReason', 'reviewedBy', 'userId']);
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

describe('forgotten and changed passwords', () => {
  const mailTo = (email: string, subject: RegExp) => [...emailSvc.outbox].reverse().find((m: any) => m.to === email && subject.test(m.subject));

  it('emails a code to reset a forgotten password, signs old sessions out, and reveals nothing about who has an account', async () => {
    const u = await signup('Forgetful');
    const oldToken = u.token;
    assert.equal((await get('/v1/me', oldToken)).status, 200);

    // an address with no account gets the very same answer, and no email goes anywhere
    const nobody = await post('/v1/auth/password/forgot', undefined, { email: 'nobody-here@example.com' });
    assert.equal(nobody.status, 201);
    assert.equal(nobody.body.ok, true);
    assert.equal(mailTo('nobody-here@example.com', /./), undefined);

    const asked = await post('/v1/auth/password/forgot', undefined, { email: u.email });
    assert.equal(asked.status, 201);
    assert.equal(asked.body.ok, true);
    const code = /(\d{6})/.exec(mailTo(u.email, /Reset your/)!.text)![1];
    // asking again straight away is refused (one code every 30 s)
    assert.equal((await post('/v1/auth/password/forgot', undefined, { email: u.email })).status, 429);

    const reset = (over: Record<string, unknown>) => post('/v1/auth/password/reset', undefined, { email: u.email, code, newPassword: 'a-brand-new-password-2', ...over });
    assert.equal((await reset({ code: code === '000000' ? '111111' : '000000' })).body.code, 'INVALID_CODE');
    assert.equal((await reset({ newPassword: 'short' })).status, 400);
    assert.equal((await post('/v1/auth/password/reset', undefined, { email: 'nobody-here@example.com', code, newPassword: 'a-brand-new-password-2' })).body.code, 'INVALID_CODE');
    assert.equal((await reset({})).status, 201);
    assert.equal((await reset({})).body.code, 'INVALID_CODE', 'a code works once');
    assert.ok(mailTo(u.email, /password was changed/), 'the owner is told');

    // the old sign-in is gone, the old password no longer works, the new one does
    assert.equal((await get('/v1/me', oldToken)).status, 401);
    assert.equal((await post('/v1/auth/login', undefined, { email: u.email, password: 'a-long-password-1' })).status, 401);
    const back = await post('/v1/auth/login', undefined, { email: u.email, password: 'a-brand-new-password-2' });
    assert.equal(back.status, 201);
    assert.equal((await get('/v1/me', back.body.token)).status, 200);
  });

  it('gives up on a reset code after five wrong tries', async () => {
    const u = await signup('Guessy');
    await post('/v1/auth/password/forgot', undefined, { email: u.email });
    const code = /(\d{6})/.exec(mailTo(u.email, /Reset your/)!.text)![1];
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) assert.equal((await post('/v1/auth/password/reset', undefined, { email: u.email, code: wrong, newPassword: 'a-brand-new-password-2' })).body.code, 'INVALID_CODE');
    // the right code no longer works: it has to be asked for again
    assert.equal((await post('/v1/auth/password/reset', undefined, { email: u.email, code, newPassword: 'a-brand-new-password-2' })).body.code, 'INVALID_CODE');
  });

  it('changes the password while signed in: needs the current one, signs other devices out, keeps this one in', async () => {
    const u = await signup('Changer');
    const other = (await post('/v1/auth/login', undefined, { email: u.email, password: 'a-long-password-1' })).body.token as string;
    assert.equal((await post('/v1/me/password', u.token, { currentPassword: 'not-my-password', newPassword: 'a-brand-new-password-2' })).body.code, 'WRONG_PASSWORD');
    assert.equal((await post('/v1/me/password', u.token, { currentPassword: 'a-long-password-1', newPassword: 'a-long-password-1' })).body.code, 'SAME_PASSWORD');
    assert.equal((await post('/v1/me/password', u.token, { currentPassword: 'a-long-password-1', newPassword: 'short' })).status, 400);
    const changed = await post('/v1/me/password', u.token, { currentPassword: 'a-long-password-1', newPassword: 'a-brand-new-password-2' });
    assert.equal(changed.status, 201, JSON.stringify(changed.body));
    assert.equal((await get('/v1/me', changed.body.token)).status, 200, 'this device stays signed in');
    assert.equal((await get('/v1/me', u.token)).status, 401, 'the old sign-in on this device ends');
    assert.equal((await get('/v1/me', other)).status, 401, 'so does every other device');
    assert.ok(mailTo(u.email, /password was changed/));
    assert.equal((await post('/v1/auth/login', undefined, { email: u.email, password: 'a-brand-new-password-2' })).status, 201);
    assert.equal((await post('/v1/me/password', undefined, { currentPassword: 'x', newPassword: 'a-brand-new-password-3' })).status, 401);
  });
});

describe('your data: export, a new email address, and deleting the account', () => {
  const mailTo = (email: string, subject: RegExp) => [...emailSvc.outbox].reverse().find((m: any) => m.to === email && subject.test(m.subject));

  it('exports everything held about you, and nothing about anyone else', async () => {
    const u = await verified('Exporter');
    const other = await verified('ExpOther');
    const plan = (await post('/v1/activities', u.token, activityBody({ title: 'Export plan', city: 'Exportville' }))).body;
    assert.equal((await post('/v1/follows', other.token, { userId: u.id })).status, 201);
    assert.equal((await post(`/v1/activities/${plan.id}/favorite`, u.token)).status < 300, true);
    const conv = await prisma.conversation.findUnique({ where: { activityId: plan.id } });
    assert.equal((await post(`/v1/conversations/${conv.id}/messages`, u.token, { body: 'hello from the exporter' })).status, 201);

    const ex = await get('/v1/me/export', u.token);
    assert.equal(ex.status, 200, JSON.stringify(ex.body));
    assert.equal(ex.body.format, 'herethere-export-v1');
    assert.equal(ex.body.account.email, u.email);
    assert.equal(ex.body.profile.displayName, 'Exporter');
    assert.deepEqual(ex.body.activities.hosted.map((a: { title: string }) => a.title), ['Export plan']);
    assert.equal(ex.body.favourites[0].title, 'Export plan');
    assert.equal(ex.body.messages.items[0].body, 'hello from the exporter');
    assert.equal(ex.body.followers[0].displayName, 'ExpOther');
    const text = JSON.stringify(ex.body);
    assert.ok(!text.includes('passwordHash') && !text.includes('$2'), 'no password material');
    assert.ok(!text.includes(other.email), 'nobody else has their email address in it');
    // three copies a day
    assert.equal((await get('/v1/me/export', u.token)).status, 200);
    assert.equal((await get('/v1/me/export', u.token)).status, 200);
    assert.equal((await get('/v1/me/export', u.token)).status, 429);
  });

  it('changes the email address only after a code sent to the new address, and warns the old one', async () => {
    const u = await signup('Mover');
    const taken = await signup('Taken');
    const to = `moved${Date.now()}@example.com`;
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: to, password: 'wrong-password-1' })).body.code, 'WRONG_PASSWORD');
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: u.email, password: 'a-long-password-1' })).body.code, 'SAME_EMAIL');
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: taken.email, password: 'a-long-password-1' })).body.code, 'EMAIL_TAKEN');
    assert.equal((await post('/v1/me/email/change', u.token, { newEmail: to, password: 'a-long-password-1' })).status, 201);
    const code = /(\d{6})/.exec(mailTo(to, /Confirm your new/)!.text)![1];
    assert.equal((await get('/v1/me', u.token)).body.email, u.email, 'nothing changes until the code is entered');
    assert.equal((await post('/v1/me/email/change/confirm', u.token, { code: code === '000000' ? '111111' : '000000' })).body.code, 'INVALID_CODE');
    const done = await post('/v1/me/email/change/confirm', u.token, { code });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const me = await get('/v1/me', u.token);
    assert.equal(me.body.email, to);
    assert.equal(me.body.emailVerified, true);
    assert.ok(mailTo(u.email, /email address was changed/), 'the old address is told');
    assert.equal((await post('/v1/auth/login', undefined, { email: to, password: 'a-long-password-1' })).status, 201);
    assert.equal((await post('/v1/auth/login', undefined, { email: u.email, password: 'a-long-password-1' })).status, 401);
    assert.equal((await post('/v1/me/email/change/confirm', u.token, { code })).status, 400, 'a code works once');
  });

  it('deletes an account: leaves plans in order, erases what is personal, keeps reported messages, frees the email', async () => {
    const host = await verified('DelHost');
    const member = await verified('DelMember');
    const other = await verified('DelOther');
    // the leaver hosts a plan with a member in it, and is a member of someone else's plan
    const hostPlan = (await post('/v1/activities', host.token, activityBody({ title: 'Doomed plan', city: 'Delville', capacity: 3 }))).body;
    const joined = await post(`/v1/activities/${hostPlan.id}/requests`, member.token, {});
    await post(`/v1/activities/${hostPlan.id}/requests/${joined.body.id}/decision`, host.token, { decision: 'approve' });
    const otherPlan = (await post('/v1/activities', other.token, activityBody({ title: 'Someone elses plan', city: 'Delville', startsAt: hours(6), endsAt: hours(8), capacity: 3 }))).body;
    const asked = await post(`/v1/activities/${otherPlan.id}/requests`, host.token, {});
    await post(`/v1/activities/${otherPlan.id}/requests/${asked.body.id}/decision`, other.token, { decision: 'approve' });
    assert.equal((await get(`/v1/activities/${otherPlan.id}`, other.token)).body.going, 2);
    // chats, a favourite, follows, and one message that someone reported
    const c1 = await prisma.conversation.findUnique({ where: { activityId: hostPlan.id } });
    const c2 = await prisma.conversation.findUnique({ where: { activityId: otherPlan.id } });
    await post(`/v1/conversations/${c1.id}/messages`, host.token, { body: 'a private thought' });
    const kept = (await post(`/v1/conversations/${c2.id}/messages`, host.token, { body: 'something reported' })).body;
    assert.equal((await post('/v1/reports', other.token, { targetType: 'message', targetId: kept.id, category: 'harassment' })).status, 201);
    await post(`/v1/activities/${otherPlan.id}/favorite`, host.token);
    await post('/v1/follows', host.token, { userId: member.id });
    await post('/v1/follows', member.token, { userId: host.id });

    // refused without the right password or the word DELETE
    assert.equal((await post('/v1/me/delete', host.token, { password: 'wrong-password-1', confirm: 'DELETE' })).body.code, 'WRONG_PASSWORD');
    assert.equal((await post('/v1/me/delete', host.token, { password: 'a-long-password-1' })).status, 400);
    assert.equal((await post('/v1/me/delete', host.token, { password: 'a-long-password-1', confirm: 'delete' })).status, 400);
    const gone = await post('/v1/me/delete', host.token, { password: 'a-long-password-1', confirm: 'DELETE' });
    assert.equal(gone.status, 201, JSON.stringify(gone.body));

    // the sign-in, the password and the old address no longer lead anywhere
    assert.equal((await get('/v1/me', host.token)).status, 401);
    assert.equal((await post('/v1/auth/login', undefined, { email: host.email, password: 'a-long-password-1' })).status, 401);
    assert.ok(mailTo(host.email, /account was deleted/));
    // the plan they hosted is cancelled and the member told; they are out of the other plan, which is open again
    assert.equal((await get(`/v1/activities/${hostPlan.id}`, member.token)).body.status, 'cancelled');
    assert.ok((await get('/v1/notifications', member.token)).body.items.some((n: { type: string }) => n.type === 'activity_cancelled'));
    const after = (await get(`/v1/activities/${otherPlan.id}`, other.token)).body;
    assert.equal(after.going, 1);
    assert.ok(!after.participants.some((p: { id: string }) => p.id === host.id));
    // what was personal is gone; the bare row stays so other people's history still hangs together
    const row = await prisma.user.findUnique({ where: { id: host.id }, include: { profile: true } });
    assert.equal(row.state, 'deleted');
    assert.match(row.email, /^deleted-.*@deleted\.invalid$/);
    assert.equal(row.profile.displayName, 'Deleted user');
    assert.equal(row.phoneNumber, null);
    assert.equal(await prisma.follow.count({ where: { OR: [{ followerId: host.id }, { followingId: host.id }] } }), 0);
    assert.equal(await prisma.favorite.count({ where: { userId: host.id } }), 0);
    assert.equal(await prisma.notification.count({ where: { userId: host.id } }), 0);
    assert.equal(await prisma.message.count({ where: { senderId: host.id, body: 'a private thought' } }), 0, 'their messages are erased');
    assert.equal(await prisma.message.count({ where: { id: kept.id } }), 1, 'a reported message stays for the moderators');
    assert.ok(await prisma.auditEvent.findFirst({ where: { actorId: host.id, action: 'account.deleted' } }));
    // the address can be used for a new account
    const again = await post('/v1/auth/register', undefined, { email: host.email, password: 'a-long-password-1', displayName: 'Back Again', adultConfirmed: true });
    assert.equal(again.status, 201, JSON.stringify(again.body));
  });

  it('does not let a staff account delete itself from the app', async () => {
    const s = await signup('StaffMember');
    await prisma.user.update({ where: { id: s.id }, data: { role: 'moderator' } });
    assert.equal((await post('/v1/me/delete', s.token, { password: 'a-long-password-1', confirm: 'DELETE' })).body.code, 'STAFF_ACCOUNT');
  });
});

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
    assert.equal((await get('/v1/me/export', b.token)).body.account.phoneNumber, '+393450001111');
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
    const bad = await (await reg('Banned', 'device-cccccccccccccccccccccccc')).json();
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

describe('retention: old data is purged on schedule', () => {
  const ago = (d: number) => new Date(Date.now() - d * 864e5);

  it('deletes what has outlived its period and keeps everything else, including reported messages', async () => {
    const { RetentionService } = await import('../src/retention/retention.service');
    const u = await signup('Retainer');
    const plan = (endedDaysAgo: number, title: string) =>
      prisma.activity.create({ data: { hostId: u.id, title, category: 'coffee', city: 'Oldtown', cityKey: 'oldtown', venueName: 'Somewhere', startsAt: ago(endedDaysAgo + 1), endsAt: ago(endedDaysAgo), capacity: 3, status: 'completed' } });
    const chat = async (activityId: string, body: string, sentDaysAgo: number) => {
      const conv = (await prisma.conversation.findUnique({ where: { activityId } })) ?? (await prisma.conversation.create({ data: { scopeType: 'activity', activityId } }));
      return prisma.message.create({ data: { conversationId: conv.id, senderId: u.id, body, createdAt: ago(sentDaysAgo) } });
    };
    const oldPlan = await plan(200, 'Old plan');
    const recentPlan = await plan(5, 'Recent plan');
    const oldMsg = await chat(oldPlan.id, 'plain old message', 199);
    const reportedMsg = await chat(oldPlan.id, 'reported old message', 199);
    const recentMsg = await chat(recentPlan.id, 'recent message', 4);
    await prisma.report.create({ data: { reporterId: u.id, targetType: 'message', targetId: reportedMsg.id, category: 'harassment' } });

    const note = (daysAgo: number, read: boolean, title: string) => prisma.notification.create({ data: { userId: u.id, type: 'x', title, body: 'b', createdAt: ago(daysAgo), readAt: read ? ago(daysAgo) : null } });
    await note(100, true, 'old read');
    await note(10, true, 'recent read');
    await note(300, false, 'unread but within a year');
    await note(400, false, 'unread and over a year');

    const rep = (status: string, closedDaysAgo: number | null, details: string) =>
      prisma.report.create({ data: { reporterId: u.id, targetType: 'user', targetId: u.id, category: 'spam', details, status, resolvedAt: closedDaysAgo === null ? null : ago(closedDaysAgo), createdAt: ago((closedDaysAgo ?? 800) + 1) } });
    await rep('resolved', 800, 'closed long ago');
    await rep('dismissed', 10, 'closed recently');
    await rep('open', null, 'still open and old');

    await prisma.auditEvent.create({ data: { actorId: u.id, action: 'old.thing', objectType: 'x', objectId: 'x', createdAt: ago(800) } });
    await prisma.auditEvent.create({ data: { actorId: u.id, action: 'recent.thing', objectType: 'x', objectId: 'x', createdAt: ago(5) } });
    await prisma.contactCode.create({ data: { userId: u.id, channel: 'email', codeHash: 'h', expiresAt: ago(30) } });
    await prisma.contactCode.create({ data: { userId: u.id, channel: 'email', codeHash: 'h2', expiresAt: new Date(Date.now() + 600000) } });
    // identity checks: an old result goes, but the newest check of the person always stays
    await prisma.verificationCheck.create({ data: { userId: u.id, providerRef: 'old1', eligibility: 'rejected', decidedAt: ago(500), createdAt: ago(501) } });
    const latestCheck = await prisma.verificationCheck.create({ data: { userId: u.id, providerRef: 'old2', eligibility: 'verified', decidedAt: ago(400), createdAt: ago(401) } });

    const counts = await app.get(RetentionService).runOnce();
    assert.equal(counts.messages, 1);
    assert.equal(await prisma.message.count({ where: { id: oldMsg.id } }), 0, 'an old, unreported message is gone');
    assert.equal(await prisma.message.count({ where: { id: reportedMsg.id } }), 1, 'a reported message stays');
    assert.equal(await prisma.message.count({ where: { id: recentMsg.id } }), 1, 'a recent chat is untouched');
    const titles = (await prisma.notification.findMany({ where: { userId: u.id, type: 'x' } })).map((n: { title: string }) => n.title).sort();
    assert.deepEqual(titles, ['recent read', 'unread but within a year']);
    const details = (await prisma.report.findMany({ where: { reporterId: u.id, targetType: 'user' } })).map((r: { details: string }) => r.details).sort();
    assert.deepEqual(details, ['closed recently', 'still open and old']);
    assert.equal(await prisma.auditEvent.count({ where: { action: 'old.thing' } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { action: 'recent.thing' } }), 1);
    assert.equal(await prisma.contactCode.count({ where: { userId: u.id, channel: 'email', codeHash: 'h' } }), 0);
    assert.equal(await prisma.contactCode.count({ where: { userId: u.id, channel: 'email', codeHash: 'h2' } }), 1);
    assert.equal(await prisma.verificationCheck.count({ where: { userId: u.id } }), 1);
    assert.equal((await prisma.verificationCheck.findFirst({ where: { userId: u.id } })).id, latestCheck.id);
    assert.ok(await prisma.auditEvent.findFirst({ where: { action: 'retention.purged' } }), 'the clean-up is itself recorded');

    // running it again finds nothing more to do
    const again = await app.get(RetentionService).runOnce();
    assert.deepEqual((Object.values(again) as number[]).filter((n) => n > 0), []);
  });

  it('publishes what is kept and for how long, in plain words, without signing in', async () => {
    const r = await get('/v1/retention');
    assert.equal(r.status, 200);
    const chat = r.body.items.find((x: { what: string }) => x.what === 'Group chat messages');
    assert.match(chat.kept, /3 months after the plan or trip ends/);
    assert.ok(r.body.items.find((x: { what: string }) => /audit/i.test(x.what)).kept.includes('2 years'));
    assert.ok(r.body.items.some((x: { what: string }) => /account details/i.test(x.what)));
  });
});

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

describe('reliability: host notes, disputes, moderators, and who sees the level', () => {
  const ago = (hours: number) => new Date(Date.now() - hours * 3600 * 1000);
  // a plan with exact times, made directly so it can be in the past
  const plan = async (host: { id: string }, members: { id: string; state?: string; leftAt?: Date }[], opts: { title?: string; startHoursAgo: number; endHoursAgo: number; status?: string; cancelledAt?: Date }) => {
    const a = await prisma.activity.create({
      data: {
        hostId: host.id, title: opts.title ?? 'Past plan', category: 'coffee', city: 'Pastville', cityKey: 'pastville', venueName: 'Somewhere',
        startsAt: ago(opts.startHoursAgo), endsAt: ago(opts.endHoursAgo), capacity: 6, status: opts.status ?? 'completed', cancelledAt: opts.cancelledAt ?? null,
      },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: host.id, role: 'host', state: 'approved' } });
    for (const m of members) await prisma.activityMembership.create({ data: { activityId: a.id, userId: m.id, role: 'attendee', state: m.state ?? 'approved', leftAt: m.leftAt ?? null } });
    return a;
  };
  // the person's own screen is deliberately minimal, so the detail is read from the staff view
  const LABEL: Record<string, string> = { new: 'New', reliable: 'Reliable', very_reliable: 'Very reliable', needs_care: 'Needs care' };
  const mine = async (u: { id: string }) => {
    const b = (await get(`/v1/admin/users/${u.id}/reliability`, adminToken)).body;
    return {
      level: b.level as string,
      counts: { kept: b.summary.kept, noShows: b.summary.noShows, lateCancels: b.summary.lateCancels, upheldReports: b.summary.upheldReports },
      changes: b.changes.map((c: { from: string | null; to: string; because: string }) => ({ from: c.from ? LABEL[c.from] : null, to: LABEL[c.to], because: c.because })),
      events: b.events as { text: string }[],
    };
  };

  it('lets a host say who did not come, tells the member, and counts nothing until it is confirmed', async () => {
    const host = await verified('RelHost');
    const member = await verified('RelMember');
    const other = await verified('RelOther');
    const a = await plan(host, [member, other], { startHoursAgo: 3, endHoursAgo: 1 }); // ended an hour ago: inside the 48 hours

    const list = await get(`/v1/activities/${a.id}/no-shows`, host.token);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.canMark, true);
    assert.deepEqual(list.body.items.map((i: { userId: string }) => i.userId).sort(), [member.id, other.id].sort());
    assert.equal((await get(`/v1/activities/${a.id}/no-shows`, member.token)).status, 404, 'only the host sees it');

    assert.equal((await post(`/v1/activities/${a.id}/no-shows`, host.token, { userId: host.id })).body.code, 'INVALID_TARGET');
    const stranger = await verified('RelStranger');
    assert.equal((await post(`/v1/activities/${a.id}/no-shows`, host.token, { userId: stranger.id })).status, 404);
    const marked = await post(`/v1/activities/${a.id}/no-shows`, host.token, { userId: member.id });
    assert.equal(marked.status, 201, JSON.stringify(marked.body));
    assert.equal(marked.body.state, 'marked');
    assert.equal((await post(`/v1/activities/${a.id}/no-shows`, host.token, { userId: member.id })).body.id, marked.body.id, 'marking twice is the same note');
    assert.ok((await get('/v1/notifications', member.token)).body.items.some((n: { type: string }) => n.type === 'attendance_marked'));

    // a note that is only a note counts for nothing, and the plan is not counted as kept either
    const before = await mine(member);
    assert.equal(before.counts.noShows, 0);
    assert.equal(before.level, 'new');
    const myNotes = (await get('/v1/me/no-shows', member.token)).body.items;
    assert.equal(myNotes[0].state, 'marked');
    assert.equal(myNotes[0].canDispute, true);

    // dispute
    assert.equal((await post(`/v1/no-shows/${marked.body.id}/dispute`, member.token, { note: 'no' })).status, 400);
    assert.equal((await post(`/v1/no-shows/${marked.body.id}/dispute`, other.token, { note: 'It was not me at all' })).status, 404, 'only the person it is about');
    assert.equal((await post(`/v1/no-shows/${marked.body.id}/dispute`, member.token, { note: 'I was there from the start' })).body.state, 'disputed');
    assert.equal((await post(`/v1/no-shows/${marked.body.id}/dispute`, member.token, { note: 'Again, to be sure' })).body.code, 'NOT_DISPUTABLE');
    assert.equal((await call('DELETE', `/v1/activities/${a.id}/no-shows/${member.id}`, host.token)).body.code, 'MARK_LOCKED', 'the host cannot take back a disputed note');

    // a moderator sees it and overturns it
    const queue = await get('/v1/admin/no-shows?state=disputed', adminToken);
    const row = queue.body.items.find((i: { id: string }) => i.id === marked.body.id);
    assert.equal(row.disputeNote, 'I was there from the start');
    assert.equal(row.member.id, member.id);
    assert.equal((await post(`/v1/admin/no-shows/${marked.body.id}/decision`, adminToken, { decision: 'overturn', note: 'check-in photos agree' })).body.state, 'overturned');
    const after = await mine(member);
    assert.equal(after.counts.noShows, 0);
    assert.ok((await get('/v1/notifications', member.token)).body.items.some((n: { type: string }) => n.type === 'attendance_decided'));
    assert.ok((await get('/v1/notifications', host.token)).body.items.some((n: { type: string }) => n.type === 'attendance_decided'));
  });

  it('only allows notes while the plan is on and for 48 hours after, and lets the host take a plain note back', async () => {
    const host = await verified('WinHost');
    const member = await verified('WinMember');
    const notStarted = await prisma.activity.create({ data: { hostId: host.id, title: 'Later', category: 'coffee', city: 'Pastville', cityKey: 'pastville', venueName: 'S', startsAt: new Date(Date.now() + 3600e3), endsAt: new Date(Date.now() + 7200e3), capacity: 4 } });
    await prisma.activityMembership.create({ data: { activityId: notStarted.id, userId: member.id, role: 'attendee', state: 'approved' } });
    assert.equal((await post(`/v1/activities/${notStarted.id}/no-shows`, host.token, { userId: member.id })).body.code, 'MARK_NOT_OPEN');

    const tooLate = await plan(host, [member], { title: 'Long ago', startHoursAgo: 80, endHoursAgo: 60 }); // ended 60 hours ago
    assert.equal((await get(`/v1/activities/${tooLate.id}/no-shows`, host.token)).body.canMark, false);
    assert.equal((await post(`/v1/activities/${tooLate.id}/no-shows`, host.token, { userId: member.id })).body.code, 'MARK_WINDOW_CLOSED');

    const ok = await plan(host, [member], { title: 'Just ended', startHoursAgo: 4, endHoursAgo: 2 });
    await post(`/v1/activities/${ok.id}/no-shows`, host.token, { userId: member.id });
    assert.equal((await call('DELETE', `/v1/activities/${ok.id}/no-shows/${member.id}`, host.token)).status, 200);
    assert.equal(await prisma.attendanceMark.count({ where: { targetId: ok.id } }), 0, 'a plain note can be taken back');
  });

  it('counts a note once the member had 7 days and did not dispute, or a moderator upheld it', async () => {
    const host = await verified('ConfHost');
    const quiet = await verified('ConfQuiet');
    const upheld = await verified('ConfUpheld');
    const p1 = await plan(host, [quiet], { title: 'Old one', startHoursAgo: 24 * 12, endHoursAgo: 24 * 12 - 2 });
    await prisma.attendanceMark.create({ data: { kind: 'activity', targetId: p1.id, userId: quiet.id, markedById: host.id, title: 'Old one', planEndsAt: p1.endsAt, markedAt: ago(24 * 9) } });
    assert.equal((await mine(quiet)).counts.noShows, 1, 'nobody disputed it within 7 days');

    const p2 = await plan(host, [upheld], { title: 'Disputed one', startHoursAgo: 24 * 3, endHoursAgo: 24 * 3 - 2 });
    const m2 = await prisma.attendanceMark.create({ data: { kind: 'activity', targetId: p2.id, userId: upheld.id, markedById: host.id, title: 'Disputed one', planEndsAt: p2.endsAt, markedAt: ago(24), state: 'disputed', disputeNote: 'I came' } });
    assert.equal((await mine(upheld)).counts.noShows, 0, 'still being looked at');
    assert.equal((await post(`/v1/admin/no-shows/${m2.id}/decision`, adminToken, { decision: 'uphold', note: 'the host photos show you were absent' })).body.state, 'upheld');
    assert.equal((await mine(upheld)).counts.noShows, 1);
    // staff can see why, and fix a mistake later
    const why = await get(`/v1/admin/users/${upheld.id}/reliability`, adminToken);
    assert.equal(why.body.summary.noShows, 1);
    assert.ok(why.body.events.some((e: { text: string }) => e.text.includes('Confirmed no-show: Disputed one')));
    assert.equal(why.body.marks[0].decisionNote, 'the host photos show you were absent');
    assert.equal((await post(`/v1/admin/no-shows/${m2.id}/decision`, adminToken, { decision: 'overturn', note: 'new evidence' })).body.state, 'overturned');
    assert.equal((await mine(upheld)).counts.noShows, 0);
  });

  it('works the level out from kept plans, late exits, late host cancellations and upheld reports, and keeps a history', async () => {
    const host = await verified('LvlHost');
    const u = await verified('LvlPerson');
    assert.equal((await mine(u)).level, 'new');
    // three finished plans on three different days: Reliable
    for (let i = 0; i < 3; i++) await plan(host, [u], { title: `Plan ${i}`, startHoursAgo: 24 * (5 + i) + 2, endHoursAgo: 24 * (5 + i) });
    const rel = await mine(u);
    assert.equal(rel.counts.kept, 3);
    assert.equal(rel.level, 'reliable');
    assert.ok(rel.changes.some((c: { from: string; to: string; because: string }) => c.from === 'New' && c.to === 'Reliable' && /Kept:/.test(c.because)), 'the change and its reason are recorded');
    assert.ok(rel.events.some((e: { text: string }) => e.text.startsWith('Kept: Plan')));

    // leaving 1 hour before the start is late; leaving 6 hours before is not
    const start = 24 * 2 + 6;
    const late = await plan(host, [{ id: u.id, state: 'withdrawn', leftAt: ago(start - 1) }], { title: 'Left late', startHoursAgo: start, endHoursAgo: start - 2, status: 'published' });
    await plan(host, [{ id: u.id, state: 'withdrawn', leftAt: ago(start + 6) }], { title: 'Left early', startHoursAgo: start, endHoursAgo: start - 2, status: 'published' });
    void late;
    assert.equal((await mine(u)).counts.lateCancels, 1);

    // reports count only once a moderator resolved them
    const rep = (status: string) => prisma.report.create({ data: { reporterId: host.id, targetType: 'user', targetId: u.id, category: 'spam', status, resolvedAt: status === 'resolved' || status === 'dismissed' ? new Date() : null } });
    await rep('open');
    await rep('dismissed');
    assert.equal((await mine(u)).counts.upheldReports, 0);
    await rep('resolved');
    assert.equal((await mine(u)).counts.upheldReports, 1);

    // a host who cancels with 30 minutes to go, with a guest booked
    const hostPlan = await plan(u, [host], { title: 'Hosted then cancelled', startHoursAgo: 30, endHoursAgo: 28, status: 'cancelled', cancelledAt: ago(30.5) });
    void hostPlan;
    assert.equal((await mine(u)).counts.lateCancels, 2);
  });

  it('explains how levels work in plain words, written from the real rule numbers, without signing in', async () => {
    const { RELIABLE_AT, VERY_RELIABLE_AT, DISPUTE_DAYS, LATE_ACTIVITY_H } = await import('../src/reliability/reliability');
    const r = await get('/v1/reliability/info');
    assert.equal(r.status, 200);
    for (const item of r.body.items) assert.ok(item.what && item.how && item.why, 'every card has a heading, a line and a reason');
    const how = (what: string) => r.body.items.find((i: { what: string }) => i.what === what).how as string;
    assert.ok(how('Starting out').includes(`${RELIABLE_AT} kept plans`) && how('Starting out').includes(`${VERY_RELIABLE_AT}`));
    assert.ok(how('If a host says you did not come').includes(`${DISPUTE_DAYS} days`));
    assert.ok(how('What lowers it').includes(`last ${LATE_ACTIVITY_H} hours`));
    assert.ok(how('How long it counts').includes('2 years'));
    assert.match(how('What it is not'), /not a safety guarantee/);
  });

  it('ranks activities in three tiers: buddies first, then people you follow, then everyone else (followers who you do not follow back add nothing)', async () => {
    const viewer = await verified('TierViewer');
    const buddy = await verified('TierBuddy');
    const followed = await verified('TierFollowed');
    const follower = await verified('TierFollower');
    const stranger = await verified('TierStranger');
    // buddy: follow each other. followed: only the viewer follows. follower: only they follow the viewer.
    await post('/v1/follows', viewer.token, { userId: buddy.id });
    await post('/v1/follows', buddy.token, { userId: viewer.id });
    await post('/v1/follows', viewer.token, { userId: followed.id });
    await post('/v1/follows', follower.token, { userId: viewer.id });
    const city = 'Tierville';
    const make = async (who: { token: string }, title: string) => (await post('/v1/activities', who.token, activityBody({ city, title, category: 'sports', startsAt: hours(3), endsAt: hours(4) }))).body.id;
    const ids = { stranger: await make(stranger, 'By a stranger'), follower: await make(follower, 'By a follower'), followed: await make(followed, 'By someone I follow'), buddy: await make(buddy, 'By a buddy') };

    const r = await get(`/v1/activities?city=${city}&from=${encodeURIComponent(hours(0))}&to=${encodeURIComponent(hours(30))}&sort=relevance`, viewer.token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const order = r.body.items.map((x: { id: string }) => x.id);
    assert.equal(order[0], ids.buddy, 'buddies first');
    assert.equal(order[1], ids.followed, 'then people you follow');
    assert.deepEqual(order.slice(2).sort(), [ids.follower, ids.stranger].sort(), 'then everyone else, a follower no better than a stranger');
    const by = (id: string) => r.body.items.find((x: { id: string }) => x.id === id);
    assert.deepEqual([by(ids.buddy).buddiesGoing, by(ids.buddy).followingGoing], [1, 0]);
    assert.deepEqual([by(ids.followed).buddiesGoing, by(ids.followed).followingGoing], [0, 1]);
    assert.deepEqual([by(ids.follower).buddiesGoing, by(ids.follower).followingGoing], [0, 0]);
    assert.deepEqual([by(ids.stranger).buddiesGoing, by(ids.stranger).followingGoing], [0, 0]);
    // a buddy who is going (not hosting) counts too
    const joined = await post(`/v1/activities/${ids.stranger}/requests`, buddy.token, {});
    await post(`/v1/activities/${ids.stranger}/requests/${joined.body.id}/decision`, stranger.token, { decision: 'approve' });
    const again = await get(`/v1/activities?city=${city}&from=${encodeURIComponent(hours(0))}&to=${encodeURIComponent(hours(30))}&sort=relevance`, viewer.token);
    assert.equal(again.body.items.find((x: { id: string }) => x.id === ids.stranger).buddiesGoing, 1);
  });

  it('keeps what the person sees simple: the level and one line, with the detail only in their data download and for staff', async () => {
    const host = await verified('SimpleHost');
    const u = await verified('SimplePerson');
    for (let i = 0; i < 3; i++) await plan(host, [u], { title: `Simple ${i}`, startHoursAgo: 24 * (5 + i) + 2, endHoursAgo: 24 * (5 + i) });
    const own = await get('/v1/me/reliability', u.token);
    assert.equal(own.status, 200);
    assert.deepEqual(Object.keys(own.body).sort(), ['label', 'level', 'line'], 'no counts, events, history or rules');
    assert.equal(own.body.level, 'reliable');
    assert.ok(own.body.line.length > 0 && own.body.line.length < 80, 'one short line');
    // the person can still get everything about themselves by downloading their data
    const download = (await get('/v1/me/export', u.token)).body;
    assert.equal(download.reliability.level, 'Reliable');
    assert.equal(download.reliability.counts.keptPlans, 3);
    assert.ok(download.reliability.events.some((e: { what: string }) => e.what.startsWith('Kept: Simple')));
    // and staff see the weights too
    assert.ok((await get(`/v1/admin/users/${u.id}/reliability`, adminToken)).body.events.every((e: { weight: number }) => typeof e.weight === 'number'));
    // the alerts are short too
    const a = await plan(host, [u], { title: 'Short alert', startHoursAgo: 3, endHoursAgo: 1 });
    await post(`/v1/activities/${a.id}/no-shows`, host.token, { userId: u.id });
    const alert = (await get('/v1/notifications', u.token)).body.items.find((n: { type: string }) => n.type === 'attendance_marked');
    assert.equal(alert.body, 'Short alert: you can dispute this.');
  });

  it('shows the level only to verified members, and on request cards and the host card', async () => {
    const host = await verified('ShowHost');
    const applicant = await verified('ShowApplicant');
    const unverified = await signup('ShowNobody');
    // three kept plans make the applicant Reliable
    for (let i = 0; i < 3; i++) await plan(host, [applicant], { title: `Kept ${i}`, startHoursAgo: 24 * (5 + i) + 2, endHoursAgo: 24 * (5 + i) });
    const id = (await post('/v1/activities', host.token, activityBody({ title: 'For the cards', city: 'Cardville' }))).body.id;
    assert.equal((await post(`/v1/activities/${id}/requests`, applicant.token, {})).status, 201);

    const asVerified = await get(`/v1/users/${applicant.id}`, host.token);
    assert.deepEqual(asVerified.body.reliability, { level: 'reliable', label: 'Reliable' });
    const asUnverified = await get(`/v1/users/${applicant.id}`, unverified.token);
    assert.equal(asUnverified.body.reliability, null, 'people who are not verified see no levels');
    assert.equal((await get(`/v1/users/${applicant.id}`, adminToken)).status, 200);

    // the host sees the applicant's level on the request card, and verified viewers see the host's level on the plan
    const cards = await get(`/v1/activities/${id}/requests`, host.token);
    assert.equal(cards.body.items[0].applicant.reliability.label, 'Reliable');
    const detail = await get(`/v1/activities/${id}`, applicant.token);
    assert.equal(detail.body.hostReliability.level, 'reliable', 'the host kept their own earlier plans');
    assert.equal((await get(`/v1/activities/${id}`, unverified.token)).body.hostReliability, null);

    // "Needs care" is shown to verified members too (the person decided it should be)
    const careless = await verified('ShowCareless');
    for (let i = 0; i < 2; i++) {
      const p = await plan(host, [careless], { title: `Missed ${i}`, startHoursAgo: 24 * (15 + i) + 2, endHoursAgo: 24 * (15 + i) });
      await prisma.attendanceMark.create({ data: { kind: 'activity', targetId: p.id, userId: careless.id, markedById: host.id, title: `Missed ${i}`, planEndsAt: p.endsAt, markedAt: ago(24 * 14) } });
    }
    assert.equal((await get(`/v1/users/${careless.id}`, applicant.token)).body.reliability.level, 'needs_care');
  });

  it('lets an organizer note a trip no-show as well, and ages the notes out with the retention job', async () => {
    const org = await verified('TripOrg');
    const mem = await verified('TripMem');
    const t = await prisma.trip.create({
      data: { hostId: org.id, title: 'Past trip', destination: 'Lisbon, Portugal', destinationKey: 'lisbon, portugal', originCity: 'Milan', dateStart: ago(24 * 5), dateEnd: ago(24 * 1), budgetMin: 100, budgetMax: 200, status: 'completed' },
    });
    await prisma.tripMembership.create({ data: { tripId: t.id, userId: org.id, role: 'organizer', state: 'approved' } });
    await prisma.tripMembership.create({ data: { tripId: t.id, userId: mem.id, role: 'member', state: 'approved' } });
    const list = await get(`/v1/trips/${t.id}/no-shows`, org.token);
    assert.equal(list.body.canMark, true);
    const m = await post(`/v1/trips/${t.id}/no-shows`, org.token, { userId: mem.id });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    assert.equal((await get(`/v1/trips/${t.id}/no-shows`, mem.token)).status, 404);

    const { RetentionService } = await import('../src/retention/retention.service');
    const oldPlan = await prisma.attendanceMark.create({ data: { kind: 'trip', targetId: 'gone', userId: mem.id, markedById: org.id, title: 'Ancient', planEndsAt: ago(24 * 800), markedAt: ago(24 * 790) } });
    await app.get(RetentionService).runOnce();
    assert.equal(await prisma.attendanceMark.count({ where: { id: oldPlan.id } }), 0, 'notes older than two years are deleted');
    assert.equal(await prisma.attendanceMark.count({ where: { id: m.body.id } }), 1);
  });
});
