// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-confirmed-plans.db';
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
  for (const f of ['test-p0-confirmed-plans.db', 'test-p0-confirmed-plans.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-confirmed-plans.db', 'test-p0-confirmed-plans.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('confirmed plans, starting-soon reminders, drafts and appeals', () => {
  const tripBody = (over: Record<string, unknown> = {}) => ({
    title: 'Lisbon weekend',
    destination: 'Lisbon, Portugal',
    originCity: 'Milan',
    dateStart: new Date(Date.now() + 40 * 24 * 3600 * 1000).toISOString(),
    dateEnd: new Date(Date.now() + 44 * 24 * 3600 * 1000).toISOString(),
    dateFlexibility: 'plus_minus_3',
    budgetMin: 500,
    budgetMax: 900,
    budgetIncludesTransport: true,
    tags: ['food'],
    groupSize: '2-3',
    ...over,
  });
  const join = async (id: string, who: { token: string }, host: { token: string }) => {
    const r = await post(`/v1/activities/${id}/requests`, who.token, {});
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (r.body.state === 'requested') await post(`/v1/activities/${id}/requests/${r.body.id}/decision`, host.token, { decision: 'approve' });
    return r.body.id as string;
  };
  const notified = async (u: { token: string }, type: string) => (await get('/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === type);

  it('marks an activity confirmed once two people are going, and open again if that drops', async () => {
    const host = await verified('CHost');
    const a = await verified('CMember');
    const b = await verified('CMemberB');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 3 }))).body.id;
    assert.equal((await get(`/v1/activities/${id}`, a.token)).body.status, 'published');
    await join(id, a, host);
    assert.equal((await get(`/v1/activities/${id}`, a.token)).body.status, 'confirmed');
    assert.equal((await notified(a, 'activity_confirmed')).length, 1);
    assert.equal((await notified(host, 'activity_confirmed')).length, 1);
    // a full group is "full", not "confirmed"; when a place frees up it is confirmed again
    await join(id, b, host);
    assert.equal((await get(`/v1/activities/${id}`, a.token)).body.status, 'full');
    await post(`/v1/activities/${id}/leave`, b.token);
    assert.equal((await get(`/v1/activities/${id}`, a.token)).body.status, 'confirmed');
    await post(`/v1/activities/${id}/leave`, a.token);
    assert.equal((await get(`/v1/activities/${id}`, host.token)).body.status, 'published');
    // still found in the feed while confirmed
    await join(id, a, host);
    // (asks for a long page: earlier tests leave many Milan activities in the shared test database, and the feed is oldest first)
    assert.ok((await get('/v1/activities?city=Milan&limit=50', b.token)).body.items.some((x: { id: string }) => x.id === id));
  });

  it('sends one starting-soon reminder, an hour ahead, to people who have been in a while', async () => {
    const { ActivitiesService } = await import('../src/activities/activities.service');
    const svc = app.get(ActivitiesService);
    const host = await verified('RHost');
    const m = await verified('RMember');
    const soon = (await post('/v1/activities', host.token, activityBody({ title: 'Soon coffee', startsAt: hours(0.5), endsAt: hours(2), capacity: 4 }))).body.id;
    const later = (await post('/v1/activities', host.token, activityBody({ title: 'Later coffee', startsAt: hours(5), endsAt: hours(7), capacity: 4, venueName: 'Bar Navigli' }))).body.id;
    await join(soon, m, host);
    await svc.sendStartingSoon();
    assert.equal((await notified(host, 'starting_soon')).length, 0, 'everyone just joined, so nobody needs a reminder yet');
    // everyone has been in a while
    await prisma.activityMembership.updateMany({ where: { activityId: soon }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    await prisma.activityMembership.updateMany({ where: { activityId: later }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    await prisma.activity.update({ where: { id: soon }, data: { remindedAt: null } });
    assert.ok((await svc.sendStartingSoon()) >= 2);
    assert.equal((await notified(host, 'starting_soon')).length, 1);
    const mine = await notified(m, 'starting_soon');
    assert.equal(mine.length, 1);
    assert.match(mine[0].body, /Soon coffee/);
    assert.equal((await notified(host, 'starting_soon')).some((n: { data: { activityId: string } }) => n.data?.activityId === later), false, 'five hours away is too early');
    // never twice
    await svc.sendStartingSoon();
    assert.equal((await notified(m, 'starting_soon')).length, 1);
    // a new time gets a new reminder
    await prisma.activity.update({ where: { id: later }, data: { startsAt: new Date(Date.now() + 40 * 60_000), endsAt: new Date(Date.now() + 3 * 3600_000) } });
    await svc.sendStartingSoon();
    assert.equal((await notified(host, 'starting_soon')).length, 2);
  });

  it('confirms a trip once everyone has agreed the final dates', async () => {
    const org = await verified('CTOrg');
    const mem = await verified('CTMem');
    const t = (await post('/v1/trips', org.token, tripBody())).body;
    const ap = await post(`/v1/trips/${t.id}/applications`, mem.token, { intro: 'I would love to join this trip with you.', confirmBudget: true, confirmDates: true, confirmGuidelines: true });
    await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, org.token, { decision: 'approve' });
    assert.equal((await get(`/v1/trips/${t.id}`, mem.token)).body.status, 'planning');
    await prisma.trip.update({ where: { id: t.id }, data: { datesState: 'proposed' } });
    const r = await post(`/v1/trips/${t.id}/confirm-dates`, org.token);
    assert.ok(r.status < 300, JSON.stringify(r.body));
    assert.equal((await get(`/v1/trips/${t.id}`, mem.token)).body.status, 'planning', 'one of two is not enough');
    await post(`/v1/trips/${t.id}/confirm-dates`, mem.token);
    assert.equal((await get(`/v1/trips/${t.id}`, mem.token)).body.status, 'confirmed');
    // someone leaving brings it below the minimum: open again
    await post(`/v1/trips/${t.id}/leave`, mem.token);
    assert.equal((await get(`/v1/trips/${t.id}`, org.token)).body.status, 'published');
  });

  it('refuses swear words and shouting in titles and descriptions, in both English and Italian', async () => {
    const host = await verified('PHost');
    const r1 = await post('/v1/activities', host.token, activityBody({ title: 'Che cazzo di serata' }));
    assert.equal(r1.status, 400);
    assert.equal(r1.body.code, 'CONTENT_REJECTED');
    assert.equal((await post('/v1/activities', host.token, activityBody({ description: 'THIS IS THE BEST EVENT EVER COME NOW' }))).body.code, 'CONTENT_REJECTED');
    assert.equal((await post('/v1/trips', host.token, tripBody({ title: 'Fucking great trip' }))).body.code, 'CONTENT_REJECTED');
    assert.equal((await post('/v1/activities', host.token, activityBody())).status, 201);
  });

  it('keeps drafts private, allows half-finished forms, and checks everything only when posted', async () => {
    const me = await verified('DOwner');
    const other = await verified('DOther');
    const put = (token: string, body: unknown) => call('PUT', '/v1/me/drafts', token, body);
    const saved = await put(me.token, { kind: 'activity', data: { title: 'Idea for later' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.title, 'Idea for later');
    const again = await put(me.token, { id: saved.body.id, kind: 'activity', data: { title: 'Idea for later', category: 'drinks' } });
    assert.equal(again.body.id, saved.body.id);
    assert.equal((await get('/v1/me/drafts', me.token)).body.items.length, 1);
    assert.equal((await get('/v1/me/drafts', other.token)).body.items.length, 0, 'nobody else sees it');
    assert.equal((await put(other.token, { id: saved.body.id, kind: 'activity', data: { title: 'hijack' } })).status, 404);
    assert.equal((await call('DELETE', `/v1/me/drafts/${saved.body.id}`, other.token)).status, 404);
    // it is not a listing
    assert.equal((await get('/v1/activities?city=Milan', other.token)).body.items.some((x: { title: string }) => x.title === 'Idea for later'), false);

    // posting a half-finished one fails, and the draft stays
    const bad = await post(`/v1/me/drafts/${saved.body.id}/publish`, me.token);
    assert.equal(bad.status, 400);
    assert.equal((await get('/v1/me/drafts', me.token)).body.items.length, 1);
    // a complete one posts, and the draft is gone
    const full = await put(me.token, { id: saved.body.id, kind: 'activity', data: activityBody({ title: 'Drafted aperitivo' }) });
    const done = await post(`/v1/me/drafts/${full.body.id}/publish`, me.token);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.title, 'Drafted aperitivo');
    assert.equal((await get('/v1/me/drafts', me.token)).body.items.length, 0);

    // a trip draft, and the limit
    const t = await put(me.token, { kind: 'trip', data: tripBody() });
    assert.equal((await post(`/v1/me/drafts/${t.body.id}/publish`, me.token)).status, 201);
    for (let i = 0; i < 10; i++) assert.equal((await put(me.token, { kind: 'activity', data: { title: `d${i}` } })).status, 200);
    assert.equal((await put(me.token, { kind: 'activity', data: { title: 'one too many' } })).body.code, 'TOO_MANY_DRAFTS');
    const rome = await put(me.token, { kind: 'trip', data: { destination: 'Rome' } });
    assert.equal(rome.status, 200, 'the limit is per kind');
    assert.equal(rome.body.title, 'Rome', 'a trip draft is named by its destination, not "Untitled"');
  });

  it('lets a declined person ask the host to look again, once', async () => {
    const host = await verified('AHost');
    const guest = await verified('AGuest');
    const id = (await post('/v1/activities', host.token, activityBody({ capacity: 4 }))).body.id;
    const reqId = (await post(`/v1/activities/${id}/requests`, guest.token, {})).body.id;
    assert.equal((await post(`/v1/activities/${id}/appeal`, guest.token, {})).body.code, 'NOT_DECLINED', 'a pending request cannot be appealed');
    await post(`/v1/activities/${id}/requests/${reqId}/decision`, host.token, { decision: 'decline' });
    assert.equal((await get(`/v1/activities/${id}`, guest.token)).body.myRequest.canAppeal, true);
    const r = await post(`/v1/activities/${id}/appeal`, guest.token, { intro: 'I can bring a friend who knows the place.' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.state, 'requested');
    assert.ok((await notified(host, 'join_request')).some((n: { title: string }) => n.title === 'Asked to look again'));
    await post(`/v1/activities/${id}/requests/${reqId}/decision`, host.token, { decision: 'decline' });
    const d = (await get(`/v1/activities/${id}`, guest.token)).body;
    assert.equal(d.myRequest.state, 'declined');
    assert.equal(d.myRequest.canAppeal, false);
    assert.equal((await post(`/v1/activities/${id}/appeal`, guest.token, {})).body.code, 'ALREADY_APPEALED');

    // trips work the same way
    const org = await verified('ATOrg');
    const app = await verified('ATApp');
    const t = (await post('/v1/trips', org.token, tripBody({ groupSize: '4-6' }))).body;
    const ap = await post(`/v1/trips/${t.id}/applications`, app.token, { intro: 'I travel light and plan well.', confirmBudget: true, confirmDates: true, confirmGuidelines: true });
    await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, org.token, { decision: 'decline' });
    assert.equal((await get(`/v1/trips/${t.id}`, app.token)).body.myApplication.canAppeal, true);
    assert.equal((await post(`/v1/trips/${t.id}/appeal`, app.token, {})).body.state, 'pending');
    assert.equal((await post(`/v1/trips/${t.id}/appeal`, app.token, {})).body.code, 'NOT_DECLINED');
  });

  it('appeals a rejected identity check, and the trust team can accept or reject', async () => {
    const u = await signup('APerson');
    await confirmEmail(u);
    assert.equal((await post('/v1/me/appeals', u.token, { kind: 'verification', message: 'My document was genuine.' })).body.code, 'NOTHING_TO_APPEAL');
    await post('/v1/me/verification', u.token, { consent: true });
    const check = (await get('/v1/admin/verifications?status=pending', adminToken)).body.items.find((c: any) => c.user.id === u.id);
    await post(`/v1/admin/verifications/${check.id}/decision`, adminToken, { decision: 'rejected', reason: 'document' });
    assert.equal((await post('/v1/me/appeals', u.token, { kind: 'verification', message: 'short' })).status, 400, 'a few words are not enough');
    const a = await post('/v1/me/appeals', u.token, { kind: 'verification', message: 'My document was genuine, the photo was just dark.' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.state, 'open');
    assert.equal((await post('/v1/me/appeals', u.token, { kind: 'verification', message: 'Asking a second time right away.' })).body.code, 'APPEAL_OPEN');
    const queue = await get('/v1/admin/appeals', adminToken);
    assert.ok(queue.body.items.some((x: { id: string; target: { reason: string } }) => x.id === a.body.id && x.target.reason === 'document'));
    assert.equal((await post(`/v1/admin/appeals/${a.body.id}/decision`, adminToken, { decision: 'uphold', note: 'x' })).status, 400, 'a real note is needed');
    const ok = await post(`/v1/admin/appeals/${a.body.id}/decision`, adminToken, { decision: 'uphold', note: 'We checked the document by hand.' });
    assert.equal(ok.body.state, 'upheld');
    assert.equal((await get('/v1/me', u.token)).body.eligibility, 'verified');
    const mine = (await get('/v1/me/appeals', u.token)).body.items;
    assert.deepEqual([mine[0].state, mine[0].decision], ['upheld', 'We checked the document by hand.']);
    assert.ok((await notified(u, 'appeal_decided')).length >= 1);
    assert.equal((await post(`/v1/admin/appeals/${a.body.id}/decision`, adminToken, { decision: 'reject', note: 'again' })).body.code, 'APPEAL_DECIDED');

    // a rejection that stands: no second appeal for the same decision
    const v = await signup('AStands');
    await confirmEmail(v);
    await post('/v1/me/verification', v.token, { consent: true });
    const c2 = (await get('/v1/admin/verifications?status=pending', adminToken)).body.items.find((c: any) => c.user.id === v.id);
    await post(`/v1/admin/verifications/${c2.id}/decision`, adminToken, { decision: 'rejected', reason: 'document' });
    const a2 = await post('/v1/me/appeals', v.token, { kind: 'verification', message: 'Please look at my document again.' });
    await post(`/v1/admin/appeals/${a2.body.id}/decision`, adminToken, { decision: 'reject', note: 'The document does not match.' });
    assert.equal((await get('/v1/me', v.token)).body.eligibility, 'rejected');
    assert.equal((await post('/v1/me/appeals', v.token, { kind: 'verification', message: 'Trying one more time please.' })).body.code, 'ALREADY_APPEALED');
  });

  it('lets a suspended person appeal without signing in, and a moderator can lift it', async () => {
    const u = await verified('SPerson');
    await post(`/v1/admin/users/${u.id}/suspend`, adminToken, { reason: 'a misunderstanding in chat', days: 7 });
    assert.equal((await post('/v1/auth/login', undefined, { email: u.email, password: 'a-long-password-1' })).status, 403);
    const text = 'It was a joke between friends and I have apologised.';
    assert.equal((await post('/v1/appeals/suspension', undefined, { email: u.email, password: 'wrong-password', message: text })).status, 401);
    const other = await signup('SNotSuspended');
    assert.equal((await post('/v1/appeals/suspension', undefined, { email: other.email, password: 'a-long-password-1', message: text })).body.code, 'NOTHING_TO_APPEAL');
    const a = await post('/v1/appeals/suspension', undefined, { email: u.email, password: 'a-long-password-1', message: text });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await post('/v1/appeals/suspension', undefined, { email: u.email, password: 'a-long-password-1', message: text })).body.code, 'APPEAL_OPEN');
    const ok = await post(`/v1/admin/appeals/${a.body.id}/decision`, adminToken, { decision: 'uphold', note: 'Understood. Please keep chat friendly.' });
    assert.equal(ok.body.state, 'upheld');
    assert.equal((await post('/v1/auth/login', undefined, { email: u.email, password: 'a-long-password-1' })).status, 201);
    assert.ok(emailSvc.outbox.some((m: { to: string; subject: string }) => m.to === u.email && /appeal/i.test(m.subject)), 'the answer also goes by email');
  });

  it('lets a host appeal a listing staff removed, but not one they cancelled themselves', async () => {
    const host = await verified('RemHost');
    const removed = (await post('/v1/activities', host.token, activityBody({ title: 'Removed by staff' }))).body.id;
    const own = (await post('/v1/activities', host.token, activityBody({ title: 'Cancelled by me', venueName: 'Bar Isola', startsAt: hours(6), endsAt: hours(8) }))).body.id;
    await post(`/v1/activities/${own}/cancel`, host.token);
    assert.equal((await get(`/v1/activities/${own}`, host.token)).body.canAppealRemoval, false);
    assert.equal((await post('/v1/me/appeals', host.token, { kind: 'removal', targetType: 'activity', targetId: own, message: 'I cancelled but want it back.' })).body.code, 'NOTHING_TO_APPEAL');
    assert.equal((await post(`/v1/admin/activities/${removed}/remove`, adminToken, { reason: 'looked like a mistake' })).status, 201);
    assert.equal((await get(`/v1/activities/${removed}`, host.token)).body.canAppealRemoval, true);
    const other = await verified('RemOther');
    assert.equal((await post('/v1/me/appeals', other.token, { kind: 'removal', targetType: 'activity', targetId: removed, message: 'Not even my listing at all.' })).body.code, 'NOTHING_TO_APPEAL');
    const a = await post('/v1/me/appeals', host.token, { kind: 'removal', targetType: 'activity', targetId: removed, message: 'This was an ordinary coffee meetup.' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal((await get(`/v1/activities/${removed}`, host.token)).body.canAppealRemoval, false);
    await post(`/v1/admin/appeals/${a.body.id}/decision`, adminToken, { decision: 'uphold', note: 'It was removed by mistake.' });
    assert.equal((await get(`/v1/activities/${removed}`, host.token)).body.status, 'published');
    assert.equal((await get('/v1/admin/appeals?state=upheld', adminToken)).body.items.some((x: { id: string }) => x.id === a.body.id), true);
  });
});
