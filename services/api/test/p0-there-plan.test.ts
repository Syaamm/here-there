// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-there-plan.db';
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
  for (const f of ['test-p0-there-plan.db', 'test-p0-there-plan.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-there-plan.db', 'test-p0-there-plan.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

describe('THERE: shared plan, dates confirmation, completed trips, link safety and travel matching', () => {
  const tripBody = (over: Record<string, unknown> = {}) => ({
    title: 'Porto week',
    destination: 'Porto, Portugal',
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
  const notified = async (u: { token: string }, type: string) => (await get('/v1/notifications', u.token)).body.items.filter((n: { type: string }) => n.type === type);
  const apply = { intro: 'I travel light and plan well.', confirmBudget: true, confirmDates: true, confirmGuidelines: true };
  const groupOf = async (org: { token: string }, member: { token: string }, over: Record<string, unknown> = {}) => {
    const t = (await post('/v1/trips', org.token, tripBody(over))).body;
    const ap = await post(`/v1/trips/${t.id}/applications`, member.token, apply);
    await post(`/v1/trips/${t.id}/applications/${ap.body.id}/decision`, org.token, { decision: 'approve' });
    return t as { id: string; dateStart: string };
  };

  it('keeps a shared itinerary and budget notes for the group only', async () => {
    const org = await verified('PlanOrg');
    const mem = await verified('PlanMem');
    const out = await verified('PlanOut');
    const t = await groupOf(org, mem);
    const day = new Date(+new Date(t.dateStart) + 24 * 3600 * 1000).toISOString();
    assert.equal((await get(`/v1/trips/${t.id}/plan`, out.token)).status, 403, 'outsiders cannot see the plan');
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, out.token, { kind: 'itinerary', title: 'Sneaky' })).status, 403);

    const a = await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Ribeira walk', day, note: 'Meet at the bridge' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    await post(`/v1/trips/${t.id}/plan/items`, org.token, { kind: 'itinerary', title: 'Ideas for the last evening' });
    const b1 = await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'budget', title: 'Hostel, 4 nights', amount: 220 });
    await post(`/v1/trips/${t.id}/plan/items`, org.token, { kind: 'budget', title: 'Food', amount: 150 });
    const plan = (await get(`/v1/trips/${t.id}/plan`, mem.token)).body;
    assert.equal(plan.itinerary.days.length, 1);
    assert.equal(plan.itinerary.days[0].items[0].title, 'Ribeira walk');
    assert.equal(plan.itinerary.ideas.total, 1, 'lines without a day come separately, with their count');
    assert.equal(plan.budget.perPersonTotal, 370);
    assert.equal(plan.budget.comparison, 'under');
    assert.match(plan.budget.note, /never collects or holds money/);
    assert.equal(plan.itinerary.days[0].items[0].canEdit, true);
    assert.equal(plan.itinerary.ideas.items[0].canEdit, false, 'someone else line');

    // validation: no days on budget notes, no amounts on itinerary lines, days inside the trip, plain-text rules
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'budget', title: 'Taxi', day })).status, 400);
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Museum', amount: 5 })).status, 400);
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Far away', day: new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString() })).body.code, 'DAY_OUT_OF_RANGE');
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'budget', title: 'Send me money first', amount: 10 })).body.code, 'CONTENT_REJECTED');

    // who can change what: the author and the organizer, nobody else
    const first = plan.itinerary.days[0].items[0].id;
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${b1.body.id}`, org.token, { amount: 200 })).status, 200, 'the organizer can change any line');
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${first}`, mem.token, { note: 'Meet at the station' })).status, 200);
    const orgLine = plan.itinerary.ideas.items[0].id;
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${orgLine}`, mem.token, { title: 'Mine now' })).body.code, 'NOT_YOUR_LINE');
    assert.equal((await call('DELETE', `/v1/trips/${t.id}/plan/items/${orgLine}`, mem.token)).status, 403);
    assert.equal((await call('DELETE', `/v1/trips/${t.id}/plan/items/${orgLine}`, org.token)).status, 200);
    assert.equal((await get(`/v1/trips/${t.id}/plan`, org.token)).body.budget.perPersonTotal, 350);

    // times: optional, only on itinerary lines, 24-hour; inside a day, lines with no time come first, then the clock
    const addLine = (body: Record<string, unknown>) => post(`/v1/trips/${t.id}/plan/items`, mem.token, body);
    assert.equal((await addLine({ kind: 'itinerary', title: 'Late dinner', day, time: '19:00' })).status, 201);
    const breakfast = await addLine({ kind: 'itinerary', title: 'Breakfast', day, time: '09:30' });
    assert.equal(breakfast.status, 201);
    assert.equal((await addLine({ kind: 'itinerary', title: 'Bad time', day, time: '25:99' })).status, 400);
    assert.equal((await addLine({ kind: 'budget', title: 'Timed cost', amount: 5, time: '10:00' })).status, 400, 'budget notes have no time');
    const timed = (await get(`/v1/trips/${t.id}/plan`, org.token)).body;
    assert.deepEqual(timed.itinerary.days[0].items.map((i: { title: string }) => i.title), ['Ribeira walk', 'Breakfast', 'Late dinner']);
    assert.deepEqual(timed.itinerary.days[0].items.map((i: { time: string | null }) => i.time), [null, '09:30', '19:00']);
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${breakfast.body.id}`, mem.token, { time: '20:15' })).status, 200);
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${breakfast.body.id}`, mem.token, { time: 'late' })).status, 400);
    assert.deepEqual((await get(`/v1/trips/${t.id}/plan`, org.token)).body.itinerary.days[0].items.map((i: { title: string }) => i.title), ['Ribeira walk', 'Late dinner', 'Breakfast'], 'a changed time moves the line');
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${breakfast.body.id}`, mem.token, { time: null })).status, 200);
    assert.equal((await get(`/v1/trips/${t.id}/plan`, org.token)).body.itinerary.days[0].items.find((i: { title: string }) => i.title === 'Breakfast').time, null, 'a time can be taken off again');
    // a cost does not need a price: it is noted with none, counts for nothing in the total, and a price can be added or taken off later
    const before = (await get(`/v1/trips/${t.id}/plan`, org.token)).body.budget.perPersonTotal;
    const unpriced = await addLine({ kind: 'budget', title: 'Souvenirs, price to decide' });
    assert.equal(unpriced.status, 201, JSON.stringify(unpriced.body));
    let withNone = (await get(`/v1/trips/${t.id}/plan`, org.token)).body.budget;
    assert.equal(withNone.items.find((i: { title: string }) => i.title.startsWith('Souvenirs')).amount, null);
    assert.equal(withNone.perPersonTotal, before, 'no price, nothing added to the total');
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${unpriced.body.id}`, mem.token, { amount: 40 })).status, 200);
    assert.equal((await get(`/v1/trips/${t.id}/plan`, org.token)).body.budget.perPersonTotal, before + 40);
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${unpriced.body.id}`, mem.token, { amount: null })).status, 200);
    withNone = (await get(`/v1/trips/${t.id}/plan`, org.token)).body.budget;
    assert.equal(withNone.perPersonTotal, before, 'taking the price off puts the total back');
    // the plan says what the trip budget covers, so the notes are read against the right thing
    assert.equal(typeof timed.budget.includesTransport, 'boolean');
    assert.equal(timed.budget.statedMin < timed.budget.statedMax, true);

    // a member who left no longer sees it
    await post(`/v1/trips/${t.id}/leave`, mem.token);
    assert.equal((await get(`/v1/trips/${t.id}/plan`, mem.token)).status, 403);
  });

  it('shows who has confirmed the final dates', async () => {
    const org = await verified('DcOrg');
    const mem = await verified('DcMem');
    const t = await groupOf(org, mem);
    assert.equal((await get(`/v1/trips/${t.id}`, mem.token)).body.participants.every((p: any) => p.datesConfirmed === undefined), true, 'nothing to confirm yet');
    await prisma.trip.update({ where: { id: t.id }, data: { datesState: 'proposed' } });
    await prisma.tripMembership.updateMany({ where: { tripId: t.id }, data: { datesConfirmed: false } });
    await prisma.tripMembership.updateMany({ where: { tripId: t.id, userId: org.id }, data: { datesConfirmed: true } });
    const before = (await get(`/v1/trips/${t.id}`, mem.token)).body.participants;
    assert.deepEqual(before.map((p: any) => [p.role, p.datesConfirmed]).sort(), [['member', false], ['organizer', true]].sort());
    await post(`/v1/trips/${t.id}/confirm-dates`, mem.token);
    assert.equal((await get(`/v1/trips/${t.id}`, mem.token)).body.participants.every((p: any) => p.datesConfirmed === true), true);
  });

  it('reads every list that can grow a page at a time: requests, applications, blocks, reports, appeals, notes and drafts', async () => {
    type Row = { id?: string; userId?: string; state?: string };
    // every page of a list, as one array; each page is checked to be no longer than asked
    const walk = async (url: string, token: string, limit: number) => {
      const seen: Row[] = [];
      let cursor = '';
      for (let n = 0; n < 12; n++) {
        const r = (await get(`${url}${url.includes('?') ? '&' : '?'}limit=${limit}${cursor}`, token)).body;
        assert.ok(r.items.length <= limit, 'a page is never longer than asked');
        seen.push(...r.items);
        if (!r.nextCursor) break;
        cursor = `&cursor=${r.nextCursor}`;
      }
      return seen;
    };
    const key = (x: Row) => x.id ?? x.userId;

    // HERE: the host's requests, the ones waiting first, a page at a time
    const host = await verified('PgHost');
    const people = [];
    for (let i = 1; i <= 5; i++) people.push(await verified(`PgGuest${i}`));
    const actId = (await post('/v1/activities', host.token, activityBody({ capacity: 20 }))).body.id;
    const reqIds: string[] = [];
    for (const p of people) reqIds.push((await post(`/v1/activities/${actId}/requests`, p.token, {})).body.id);
    await post(`/v1/activities/${actId}/requests/${reqIds[0]}/decision`, host.token, { decision: 'approve' });
    await post(`/v1/activities/${actId}/requests/${reqIds[1]}/decision`, host.token, { decision: 'approve' });
    await post(`/v1/activities/${actId}/requests/${reqIds[2]}/decision`, host.token, { decision: 'decline' });
    const reqUrl = `/v1/activities/${actId}/requests`;
    const whole = (await get(`${reqUrl}?limit=50`, host.token)).body;
    assert.deepEqual(whole.items.map((i: Row) => i.state), ['requested', 'requested', 'approved', 'approved', 'declined'], 'waiting first, then approved, then declined');
    assert.equal(whole.pending, 2);
    assert.equal(whole.nextCursor, null);
    const r1 = (await get(`${reqUrl}?limit=3`, host.token)).body;
    assert.deepEqual(r1.items.map((i: Row) => i.state), ['requested', 'requested', 'approved']);
    assert.ok(r1.nextCursor, 'there is more');
    assert.equal(r1.pending, 2, 'the waiting count covers every page');
    const r2 = (await get(`${reqUrl}?limit=3&cursor=${r1.nextCursor}`, host.token)).body;
    assert.deepEqual(r2.items.map((i: Row) => i.state), ['approved', 'declined'], 'the next page carries on inside the group it stopped in');
    assert.equal(r2.nextCursor, null);
    const everyReq = await walk(reqUrl, host.token, 2);
    assert.equal(new Set(everyReq.map(key)).size, 5, 'every request once, none twice');
    assert.equal((await get(`${reqUrl}?cursor=nonsense`, host.token)).status, 400);
    assert.equal((await get(`${reqUrl}?limit=2`, people[0].token)).status, 403, 'only the host can read them');

    // THERE: the organizer's applications
    const org = await verified('PgOrg');
    const first = await verified('PgFirst');
    const t = await groupOf(org, first);
    for (let i = 1; i <= 3; i++) {
      const u = await verified(`PgApplicant${i}`);
      assert.equal((await post(`/v1/trips/${t.id}/applications`, u.token, apply)).status, 201);
    }
    const appUrl = `/v1/trips/${t.id}/applications`;
    const wholeApps = (await get(`${appUrl}?limit=50`, org.token)).body;
    assert.deepEqual(wholeApps.items.map((i: Row) => i.state), ['pending', 'pending', 'pending', 'approved']);
    assert.equal(wholeApps.pending, 3);
    const a1 = (await get(`${appUrl}?limit=2`, org.token)).body;
    assert.deepEqual(a1.items.map((i: Row) => i.state), ['pending', 'pending']);
    const a2 = (await get(`${appUrl}?limit=2&cursor=${a1.nextCursor}`, org.token)).body;
    assert.deepEqual(a2.items.map((i: Row) => i.state), ['pending', 'approved']);
    assert.equal(a2.nextCursor, null);

    // people I blocked
    for (const p of people) assert.equal((await post('/v1/blocks', host.token, { userId: p.id })).status, 201);
    const blocked = await walk('/v1/blocks', host.token, 2);
    assert.deepEqual(new Set(blocked.map(key)), new Set(people.map((p) => p.id)), 'all five, once each');
    assert.equal(blocked.length, 5);

    // reports I made, appeals, and no-show notes: newest first
    const ago = (n: number) => new Date(Date.now() - n * 60_000);
    const madeReports: string[] = [];
    const madeAppeals: string[] = [];
    const madeNotes: string[] = [];
    for (let i = 0; i < 4; i++) {
      madeReports.push((await prisma.report.create({ data: { reporterId: host.id, targetType: 'user', targetId: people[0].id, category: 'spam', createdAt: ago(i) } })).id);
      madeAppeals.push((await prisma.appeal.create({ data: { userId: host.id, kind: 'verification', message: 'Please look again at this decision.', createdAt: ago(i) } })).id);
      madeNotes.push((await prisma.attendanceMark.create({ data: { kind: 'activity', targetId: `pg-plan-${i}`, userId: host.id, markedById: people[0].id, title: `Plan ${i}`, planEndsAt: ago(i), markedAt: ago(i) } })).id);
    }
    for (const [url, ids] of [['/v1/me/reports', madeReports], ['/v1/me/appeals', madeAppeals], ['/v1/me/no-shows', madeNotes]] as const) {
      const firstPage = (await get(`${url}?limit=3`, host.token)).body;
      assert.equal(firstPage.items.length, 3, url);
      assert.ok(firstPage.nextCursor, `${url} has a second page`);
      const everyRow = await walk(url, host.token, 3);
      assert.deepEqual(everyRow.map(key), ids, `${url}: newest first, every row once`);
    }

    // drafts
    for (let i = 1; i <= 4; i++) assert.equal((await call('PUT', '/v1/me/drafts', host.token, { kind: 'activity', data: { title: `Draft ${i}` } })).status, 200);
    const drafts = await walk('/v1/me/drafts', host.token, 3);
    assert.equal(new Set(drafts.map(key)).size, 4);
    assert.equal((await get('/v1/me/drafts?limit=3', host.token)).body.items.length, 3);
  });

  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36';
  const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
  const APP_STORE = 'https://apps.apple.com/it/app/here-there/id1234567890';
  const PLAY_STORE = 'https://play.google.com/store/apps/details?id=io.herethere.app';
  const page = async (url: string, ua = DESKTOP) => {
    const r = await fetch(base + url, { headers: { 'user-agent': ua }, redirect: 'manual' });
    return { status: r.status, html: await r.text(), headers: r.headers };
  };
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
  };

  it('describes a public activity with only the title, the day and the city, and sends each kind of device the right way', async () => {
    const host = await verified('ShareHost');
    const created = await post('/v1/activities', host.token, activityBody({ title: 'Sunset aperitivo', venueName: 'Secret Rooftop Bar', city: 'Milan' }));
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.id as string;

    await withEnv({ APP_STORE_URL: APP_STORE, PLAY_STORE_URL: PLAY_STORE }, async () => {
      const desk = await page(`/a/${id}`);
      assert.equal(desk.status, 200);
      assert.match(desk.html, /Sunset aperitivo/);
      assert.match(desk.html, /Milan/);
      assert.doesNotMatch(desk.html, /Secret Rooftop Bar/, 'no venue for someone who is not signed in');
      assert.doesNotMatch(desk.html, /<script/i, 'the page runs no scripts');
      assert.ok(desk.html.includes(APP_STORE) && desk.html.includes(PLAY_STORE), 'a computer is shown both stores');
      assert.doesNotMatch(desk.html, /http-equiv="refresh"/, 'a computer is not sent anywhere');
      assert.match(desk.headers.get('content-security-policy') ?? '', /default-src 'none'/);
      assert.equal(desk.headers.get('x-robots-tag'), 'noindex');

      const ios = await page(`/a/${id}`, IPHONE);
      assert.ok(ios.html.includes(`http-equiv="refresh" content="2;url=${APP_STORE}"`), 'an iPhone goes on to the App Store');
      assert.ok(ios.html.includes(`herethere://a/${id}`), 'and can still open the app by hand');
      assert.ok(!ios.html.includes(PLAY_STORE) || !ios.html.includes('refresh" content="2;url=' + PLAY_STORE));

      const droid = await page(`/a/${id}`, ANDROID);
      assert.ok(droid.html.includes(`http-equiv="refresh" content="2;url=${PLAY_STORE}"`), 'an Android phone goes on to Google Play');
      assert.ok(droid.html.includes(`intent://a/${id}#Intent;scheme=herethere;package=io.herethere.app;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE)};end`), 'with a button that opens the app, and Google Play if it is not there');
    });

    // before the app is in the stores there is nothing to send people to, and the page says so
    await withEnv({ APP_STORE_URL: undefined, PLAY_STORE_URL: undefined }, async () => {
      const ios = await page(`/a/${id}`, IPHONE);
      assert.equal(ios.status, 200);
      assert.doesNotMatch(ios.html, /http-equiv="refresh"/);
      assert.match(ios.html, /coming soon/i);
    });
    // a store address that is not https is ignored
    await withEnv({ APP_STORE_URL: 'javascript:alert(1)', PLAY_STORE_URL: undefined }, async () => {
      assert.doesNotMatch((await page(`/a/${id}`, IPHONE)).html, /javascript:/);
    });
  });

  it('shows a trip with its destination and dates, and treats everything not public as a plan that does not exist', async () => {
    const org = await verified('ShareOrg');
    const mem = await verified('ShareMem');
    const t = await groupOf(org, mem, { title: 'Lisbon in the autumn' });
    const tripPage = await page(`/t/${t.id}`);
    assert.equal(tripPage.status, 200);
    assert.match(tripPage.html, /Lisbon in the autumn/);
    assert.match(tripPage.html, /Trip on THERE/);
    assert.doesNotMatch(tripPage.html, /PlanMem|ShareMem|ShareOrg/, 'no names of people');

    const host = await verified('ShareHidden');
    const act = async (over: Record<string, unknown>) => (await post('/v1/activities', host.token, activityBody({ title: 'Hidden plan', ...over }))).body.id as string;
    const cancelled = await act({ title: 'Hidden plan A', startsAt: hours(5), endsAt: hours(6) });
    await prisma.activity.update({ where: { id: cancelled }, data: { status: 'cancelled' } });
    const inviteOnly = await act({ title: 'Hidden plan B', startsAt: hours(8), endsAt: hours(9) });
    await prisma.activity.update({ where: { id: inviteOnly }, data: { visibility: 'invite_only' } });
    const done = await act({ title: 'Hidden plan C', startsAt: hours(11), endsAt: hours(12) });
    await prisma.activity.update({ where: { id: done }, data: { status: 'completed' } });
    for (const id of [cancelled, inviteOnly, done, 'does-not-exist']) {
      const r = await page(`/a/${id}`);
      assert.equal(r.status, 404, id);
      assert.doesNotMatch(r.html, /Hidden plan/, 'its title is not given away');
    }
    await prisma.trip.update({ where: { id: t.id }, data: { status: 'cancelled' } });
    const gone = await page(`/t/${t.id}`);
    assert.equal(gone.status, 404);
    assert.doesNotMatch(gone.html, /Lisbon in the autumn/);
  });

  it('writes a title as plain text, never as markup', async () => {
    const host = await verified('ShareEscape');
    const id = (await post('/v1/activities', host.token, activityBody({ title: 'Safe title' }))).body.id as string;
    await prisma.activity.update({ where: { id }, data: { title: '<img src=x onerror=alert(1)> & "quotes"' } });
    const r = await page(`/a/${id}`);
    assert.doesNotMatch(r.html, /<img src=x/);
    assert.match(r.html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;quotes&quot;/);
  });

  it('publishes the two files that make phones open the app straight from the link, once they are set up', async () => {
    await withEnv({ APPLE_TEAM_ID: undefined, ANDROID_CERT_SHA256: undefined }, async () => {
      assert.equal((await page('/.well-known/apple-app-site-association')).status, 404, 'not published before the Apple team id is known');
      assert.equal((await page('/.well-known/assetlinks.json')).status, 404);
    });
    await withEnv({ APPLE_TEAM_ID: 'ABCDE12345', ANDROID_CERT_SHA256: 'AA:BB:CC, DD:EE:FF' }, async () => {
      const apple = await page('/.well-known/apple-app-site-association');
      assert.equal(apple.status, 200);
      assert.match(apple.headers.get('content-type') ?? '', /application\/json/);
      const a = JSON.parse(apple.html);
      assert.deepEqual(a.applinks.details[0].appIDs, ['ABCDE12345.io.herethere.app']);
      assert.deepEqual(a.applinks.details[0].components, [{ '/': '/a/*' }, { '/': '/t/*' }]);
      const droid = await page('/.well-known/assetlinks.json');
      assert.equal(droid.status, 200);
      const d = JSON.parse(droid.html);
      assert.equal(d[0].target.package_name, 'io.herethere.app');
      assert.deepEqual(d[0].target.sha256_cert_fingerprints, ['AA:BB:CC', 'DD:EE:FF']);
    });
  });

  it('reads a chat\'s history a page at a time, newest first, so every earlier message can be reached', async () => {
    const host = await verified('HistHost');
    const guest = await verified('HistGuest');
    const actId = (await post('/v1/activities', host.token, activityBody())).body.id;
    const req = await post(`/v1/activities/${actId}/requests`, guest.token, {});
    await post(`/v1/activities/${actId}/requests/${req.body.id}/decision`, host.token, { decision: 'approve' });
    const conv = await prisma.conversation.findUnique({ where: { activityId: actId } });
    for (let i = 1; i <= 9; i++) {
      const r = await post(`/v1/conversations/${conv.id}/messages`, i % 2 ? host.token : guest.token, { body: `Hello number ${i}` });
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    // two messages sent in the very same moment: a page boundary between them must not lose either
    const rows = await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    await prisma.message.update({ where: { id: rows[5].id }, data: { createdAt: rows[4].createdAt } });
    const expected = (await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).map((m: { id: string }) => m.id);

    const url = `/v1/conversations/${conv.id}/messages`;
    const first = (await get(`${url}?limit=3`, host.token)).body;
    assert.equal(first.items.length, 3, 'the latest page only');
    assert.deepEqual(first.items.map((m: { id: string }) => m.id), expected.slice(-3), 'the newest three, oldest of them first');
    assert.ok(first.nextCursor, 'there are earlier messages');

    // scroll up page by page and put each earlier page above what is already there
    let shown: string[] = first.items.map((m: { id: string }) => m.id);
    let cursor: string | null = first.nextCursor;
    for (let n = 0; cursor && n < 10; n++) {
      const page = (await get(`${url}?limit=3&cursor=${cursor}`, host.token)).body;
      assert.ok(page.items.length <= 3);
      shown = [...page.items.map((m: { id: string }) => m.id), ...shown];
      cursor = page.nextCursor;
    }
    assert.deepEqual(shown, expected, 'every message once, in order, none skipped');
    assert.equal(cursor, null, 'the last page says there is no more');

    assert.equal((await get(`${url}?cursor=nonsense`, host.token)).status, 400);
    // an earlier page is still only for the group
    const outsider = await verified('HistOutsider');
    assert.equal((await get(`${url}?limit=3&cursor=${first.nextCursor}`, outsider.token)).status, 403);
  });

  it('sends only a first few ideas and budget notes with the plan, and the rest a page at a time', async () => {
    const org = await verified('PagePlanOrg');
    const mem = await verified('PagePlanMem');
    const out = await verified('PagePlanOut');
    const t = await groupOf(org, mem);
    for (let i = 1; i <= 7; i++) assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'budget', title: `Cost ${i}`, amount: 10 })).status, 201);
    for (let i = 1; i <= 5; i++) assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: `Idea ${i}` })).status, 201);
    const plan = (await get(`/v1/trips/${t.id}/plan`, mem.token)).body;
    assert.equal(plan.budget.items.length, 3, 'only the first few notes come with the plan');
    assert.equal(plan.budget.total, 7);
    assert.equal(plan.budget.perPersonTotal, 70, 'the total still counts every note');
    assert.equal(plan.itinerary.ideas.items.length, 3);
    assert.equal(plan.itinerary.ideas.total, 5);
    const seen: string[] = [];
    let cursor = '';
    for (let n = 0; n < 5; n++) {
      const page = (await get(`/v1/trips/${t.id}/plan/items?kind=budget&limit=3${cursor}`, mem.token)).body;
      seen.push(...page.items.map((i: { title: string }) => i.title));
      if (!page.nextCursor) break;
      cursor = `&cursor=${page.nextCursor}`;
    }
    assert.deepEqual(seen, ['Cost 1', 'Cost 2', 'Cost 3', 'Cost 4', 'Cost 5', 'Cost 6', 'Cost 7'], 'every note, once, in the order added');
    assert.equal((await get(`/v1/trips/${t.id}/plan/items?kind=ideas&limit=10`, mem.token)).body.items.length, 5);
    assert.equal((await get(`/v1/trips/${t.id}/plan/items?kind=nonsense`, mem.token)).status, 400);
    assert.equal((await get(`/v1/trips/${t.id}/plan/items?kind=budget`, out.token)).status, 403, 'outsiders cannot read it');
  });

  it('once a trip has started, only today and the days to come can have their itinerary changed', async () => {
    const org = await verified('PastOrg');
    const mem = await verified('PastMem');
    const t = await groupOf(org, mem);
    const DAYMS = 24 * 3600 * 1000;
    const noon = (offset: number) => new Date(new Date(Date.now() + offset * DAYMS).toISOString().slice(0, 10) + 'T12:00:00Z');
    // before the trip starts every day is open
    const early = await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Early plan', day: new Date(+new Date(t.dateStart) + DAYMS).toISOString() });
    assert.equal(early.status, 201);
    // the trip is now on its third day
    await prisma.trip.update({ where: { id: t.id }, data: { dateStart: new Date(Date.now() - 3 * DAYMS), dateEnd: new Date(Date.now() + 3 * DAYMS) } });
    await prisma.tripItem.update({ where: { id: early.body.id }, data: { day: noon(-2) } });
    const plan = (await get(`/v1/trips/${t.id}/plan`, mem.token)).body;
    const past = plan.itinerary.days.find((d: { day: string }) => d.day === noon(-2).toISOString().slice(0, 10));
    assert.equal(past.locked, true, 'a day that has passed is marked locked');
    assert.equal(past.items[0].canEdit, false, 'and its lines cannot be edited');
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${early.body.id}`, mem.token, { title: 'Changed' })).body.code, 'DAY_PASSED');
    assert.equal((await call('DELETE', `/v1/trips/${t.id}/plan/items/${early.body.id}`, mem.token)).body.code, 'DAY_PASSED');
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Too late', day: noon(-2).toISOString() })).body.code, 'DAY_PASSED');
    // today, the days after it, and an idea with no day stay open
    const today = await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Today plan', day: noon(0).toISOString() });
    assert.equal(today.status, 201, JSON.stringify(today.body));
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'Tomorrow plan', day: noon(1).toISOString() })).status, 201);
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'itinerary', title: 'An idea' })).status, 201);
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${today.body.id}`, mem.token, { note: 'Bring water' })).status, 200);
    // nothing can be moved onto a day that has passed
    assert.equal((await call('PATCH', `/v1/trips/${t.id}/plan/items/${today.body.id}`, mem.token, { day: noon(-2).toISOString() })).body.code, 'DAY_PASSED');
    // budget notes are not tied to a day
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'budget', title: 'Taxi', amount: 20 })).status, 201);
  });

  it('records a trip as completed once its last day has passed', async () => {
    const { TripsService } = await import('../src/trips/trips.service');
    const org = await verified('DoneOrg');
    const mem = await verified('DoneMem');
    const t = await groupOf(org, mem);
    await prisma.trip.update({ where: { id: t.id }, data: { dateStart: new Date(Date.now() - 6 * 24 * 3600 * 1000), dateEnd: new Date(Date.now() - 2 * 24 * 3600 * 1000) } });
    assert.equal((await get(`/v1/trips/${t.id}`, mem.token)).body.status, 'completed', 'shown as completed at once');
    assert.ok((await app.get(TripsService).completeFinished()) >= 1);
    assert.equal((await prisma.trip.findUnique({ where: { id: t.id } })).status, 'completed');
    // a trip that is still on keeps its status, and one that ends today is not over yet
    const live = await groupOf(org, await verified('DoneMem2'), { title: 'Still on' });
    await prisma.trip.update({ where: { id: live.id }, data: { dateStart: new Date(Date.now() - 24 * 3600 * 1000), dateEnd: new Date(Date.now() + 3 * 3600 * 1000) } });
    await app.get(TripsService).completeFinished();
    assert.notEqual((await prisma.trip.findUnique({ where: { id: live.id } })).status, 'completed');
    // a finished trip takes no new plan lines
    assert.equal((await post(`/v1/trips/${t.id}/plan/items`, mem.token, { kind: 'budget', title: 'Souvenirs', amount: 5 })).body.code, 'TRIP_CLOSED');
    // nobody can confirm dates or start a poll for a trip that is over
    await prisma.trip.update({ where: { id: t.id }, data: { datesState: 'proposed' } });
    await prisma.tripMembership.updateMany({ where: { tripId: t.id, userId: mem.id }, data: { datesConfirmed: false } });
    assert.equal((await post(`/v1/trips/${t.id}/confirm-dates`, mem.token)).body.code, 'TRIP_CLOSED');
    const doneConv = (await get(`/v1/trips/${t.id}`, mem.token)).body.conversationId;
    assert.equal((await post(`/v1/conversations/${doneConv}/polls`, org.token, { title: 'Where next?' })).body.code, 'TRIP_CLOSED');
  });

  it('refuses suspicious links and requests for money in the trip chat, and allows one ordinary link', async () => {
    const org = await verified('LinkOrg');
    const mem = await verified('LinkMem');
    const t = await groupOf(org, mem);
    const conv = (await get(`/v1/trips/${t.id}`, mem.token)).body.conversationId;
    const say = (body: string) => post(`/v1/conversations/${conv}/messages`, mem.token, { body });
    assert.equal((await say('Menu: https://www.trattoria-rossi.it/menu')).status, 201);
    assert.match((await say('book at https://bit.ly/abc123')).body.message, /Shortened/);
    assert.equal((await say('open http://192.168.1.4/login')).body.code, 'CONTENT_REJECTED');
    assert.equal((await say('log in at https://secure-paypal-login.net')).body.code, 'CONTENT_REJECTED');
    assert.equal((await say('please transfer the deposit to my account')).body.code, 'CONTENT_REJECTED');
    assert.equal((await say('my iban is IT60 X054 2811 1010 0000 0123 456')).body.code, 'CONTENT_REJECTED');
    assert.equal((await say('Dinner is 25 euro each, we split at the table')).status, 201);
  });

  it('matches travelers only when both say yes, and keeps the answers private', async () => {
    const a = await verified('MatchA');
    const b = await verified('MatchB');
    const c = await verified('MatchC');
    const d = await verified('MatchD');
    const lone = await signup('MatchUnverified');
    const dates = (from: number, to: number) => ({ dateStart: new Date(Date.now() + from * 24 * 3600 * 1000).toISOString(), dateEnd: new Date(Date.now() + to * 24 * 3600 * 1000).toISOString() });
    const put = (u: { token: string }, body: unknown) => call('PUT', '/v1/me/travel-match', u.token, body);

    assert.equal((await put(lone, { destination: 'Seville', ...dates(30, 35) })).status, 403, 'verified adults only');
    assert.equal((await put(a, { destination: 'Seville', ...dates(-3, 2) })).body.code, 'INVALID_DATES');
    assert.equal((await put(a, { destination: 'Seville, Spain', ...dates(30, 36) })).status, 200);
    assert.equal((await put(b, { destination: 'seville', ...dates(33, 40) })).status, 200, 'overlapping dates and the same place');
    assert.equal((await put(c, { destination: 'Seville', ...dates(60, 65) })).status, 200, 'same place, different dates');
    assert.equal((await put(d, { destination: 'Oslo', ...dates(30, 36) })).status, 200, 'same dates, different place');

    const seenByA = (await get('/v1/me/travel-match', a.token)).body;
    assert.deepEqual(seenByA.suggestions.map((s: any) => s.displayName), ['MatchB']);
    assert.equal(seenByA.suggestions[0].overlapDays >= 3, true);
    assert.equal(seenByA.suggestions[0].email, undefined, 'no contact details are ever shown');

    // a yes reveals nothing: the same answer comes back whether or not they said yes
    const first = await post(`/v1/me/travel-match/people/${b.id}`, a.token, { choice: 'yes' });
    assert.deepEqual(first.body, { matched: false });
    assert.equal((await get('/v1/me/travel-match', a.token)).body.suggestions.length, 0, 'answered people are not shown again');
    assert.equal((await get('/v1/me/travel-match', b.token)).body.suggestions.map((s: any) => s.displayName).join(), 'MatchA');
    assert.equal((await post(`/v1/me/travel-match/people/${c.id}`, a.token, { choice: 'yes' })).status, 404, 'cannot answer about someone who is not a match');
    // no chat exists yet
    assert.equal(await prisma.conversation.count({ where: { scopeType: 'match' } }), 0);

    const second = await post(`/v1/me/travel-match/people/${a.id}`, b.token, { choice: 'yes' });
    assert.equal(second.body.matched, true, JSON.stringify(second.body));
    const conv = second.body.conversationId;
    assert.ok((await notified(a, 'travel_match')).length === 1 && (await notified(b, 'travel_match')).length === 1);

    // only the two can chat
    assert.equal((await post(`/v1/conversations/${conv}/messages`, a.token, { body: 'Hi! Seville in spring?' })).status, 201);
    assert.equal((await get(`/v1/conversations/${conv}/messages`, b.token)).body.items.length, 1);
    assert.equal((await get(`/v1/conversations/${conv}/messages`, c.token)).status, 403);
    assert.equal((await post(`/v1/conversations/${conv}/messages`, c.token, { body: 'let me in' })).status, 403);
    const info = (await get(`/v1/conversations/${conv}/info`, b.token)).body;
    assert.deepEqual([info.scope, info.title, info.members.length], ['match', 'MatchA', 2]);
    assert.ok((await get('/v1/me/conversations', b.token)).body.items.some((x: any) => x.scope === 'match' && x.title === 'MatchA'));
    // chat rules still apply
    assert.equal((await post(`/v1/conversations/${conv}/messages`, a.token, { body: 'send me money please' })).body.code, 'CONTENT_REJECTED');

    // ending closes it for both
    assert.equal((await post(`/v1/me/travel-match/chats/${conv}/end`, a.token)).status, 201);
    assert.equal((await post(`/v1/conversations/${conv}/messages`, b.token, { body: 'still there?' })).body.code, 'CONVERSATION_CLOSED');
    assert.equal((await get('/v1/me/conversations', b.token)).body.items.some((x: any) => x.scope === 'match'), false);
    assert.equal((await post(`/v1/me/travel-match/people/${b.id}`, a.token, { choice: 'yes' })).body.matched, false, 'an ended chat is not reopened');

    // pass hides someone, opting out removes you from everyone's list, blocking ends a chat
    assert.equal((await put(c, { destination: 'Seville', ...dates(33, 36) })).status, 200);
    assert.equal((await put(a, { destination: 'Seville', ...dates(33, 36) })).status, 200, 'new dates start a fresh round');
    assert.deepEqual((await get('/v1/me/travel-match', a.token)).body.suggestions.map((s: any) => s.displayName).sort(), ['MatchC']);
    assert.equal((await post(`/v1/me/travel-match/people/${c.id}`, a.token, { choice: 'pass' })).body.matched, false);
    assert.equal((await get('/v1/me/travel-match', a.token)).body.suggestions.length, 0);
    assert.equal((await call('DELETE', '/v1/me/travel-match', c.token)).status, 200);
    assert.equal((await get('/v1/me/travel-match', c.token)).body.pref, null);
    assert.equal((await get('/v1/me/travel-match', b.token)).body.suggestions.some((s: any) => s.displayName === 'MatchC'), false);

    const e = await verified('MatchE');
    await put(e, { destination: 'Seville', ...dates(33, 36) });
    await put(b, { destination: 'Seville', ...dates(33, 36) });
    await post(`/v1/me/travel-match/people/${b.id}`, e.token, { choice: 'yes' });
    const m2 = await post(`/v1/me/travel-match/people/${e.id}`, b.token, { choice: 'yes' });
    assert.equal(m2.body.matched, true);
    assert.equal((await post('/v1/blocks', b.token, { userId: e.id })).status < 300, true);
    assert.equal((await get(`/v1/conversations/${m2.body.conversationId}/messages`, e.token)).status, 403, 'a block closes the chat');
  });
});
