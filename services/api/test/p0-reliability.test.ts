// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-reliability.db';
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
  for (const f of ['test-p0-reliability.db', 'test-p0-reliability.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-reliability.db', 'test-p0-reliability.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
    const download = (await exportOf(u)).body;
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
