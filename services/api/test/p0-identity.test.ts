// Split out of the original p0.test.ts (30 Oct 2026): one file per area, each with its own database, so the files
// run side by side and a failure points at its area. The set-up below is the same in every file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./test-p0-identity.db';
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
  for (const f of ['test-p0-identity.db', 'test-p0-identity.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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
  for (const f of ['test-p0-identity.db', 'test-p0-identity.db-journal']) rmSync(path.join(prismaDir, f), { force: true });
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

  // ---- Persona (a real vendor): its API is stood in for here; the app, the database and the webhook are the real ones
  const PERSONA_ENV = { PERSONA_API_KEY: 'persona_sandbox_key', PERSONA_WEBHOOK_SECRET: 'whsec_it_secret', PERSONA_TEMPLATE_ID: 'itmpl_face', PERSONA_TEMPLATE_ID_DOCUMENT: 'itmpl_doc', VERIFICATION_MODE: 'persona' } as Record<string, string>;
  type PCall = { url: string; method: string; body: any };
  async function persona<T>(fn: (calls: PCall[]) => Promise<T>) {
    const keys = [...Object.keys(PERSONA_ENV), 'PERSONA_TEMPLATE_ENFORCES_18', 'PERSONA_REDACT'];
    const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    delete process.env.PERSONA_TEMPLATE_ENFORCES_18;
    delete process.env.PERSONA_REDACT;
    Object.assign(process.env, PERSONA_ENV);
    const real = globalThis.fetch;
    const calls: PCall[] = [];
    let n = 0;
    const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status });
    globalThis.fetch = (async (url: any, init?: RequestInit) => {
      const u = String(url);
      if (!u.startsWith('https://api.withpersona.com')) return real(url, init);
      calls.push({ url: u, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (init?.method === 'POST' && u.endsWith('/inquiries')) return reply(201, { data: { id: `inq_ITEST${++n}`, attributes: { status: 'created' } }, meta: { 'one-time-link': `https://withpersona.com/verify?code=first${n}` } });
      if (init?.method === 'POST' && u.endsWith('/generate-one-time-link')) return reply(200, { data: {}, meta: { 'one-time-link': 'https://withpersona.com/verify?code=fresh' } });
      if (init?.method === 'DELETE') return reply(200, { data: {} });
      return reply(404, {});
    }) as typeof fetch;
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = real;
      for (const [k, v] of Object.entries(before)) v === undefined ? delete process.env[k] : (process.env[k] = v);
      process.env.VERIFICATION_MODE = 'manual';
    }
  }
  const personaEvent = (inquiryId: string, name: string, birthdate?: string) => ({
    data: { type: 'event', id: 'evt_it', attributes: { name, payload: { data: { type: 'inquiry', id: inquiryId, attributes: { status: 'approved', 'name-first': 'Giulia' } }, included: [{ type: 'verification/government-id', id: 'ver_1', attributes: { status: 'passed', ...(birthdate ? { birthdate } : {}) } }] } } },
  });
  const personaHook = (payload: object, secret = PERSONA_ENV.PERSONA_WEBHOOK_SECRET) => {
    const raw = JSON.stringify(payload);
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    return fetch(`${base}/v1/verification/webhook/persona`, { method: 'POST', headers: { 'content-type': 'application/json', 'persona-signature': `t=${t},v1=${v1}` }, body: raw });
  };
  const bornYearsAgo = (years: number) => new Date(Date.now() - years * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  it('verifies a person through Persona: a one-time link, a signed result, then their personal data erased at Persona', async () => {
    await persona(async (calls) => {
      const u = await signup('PersonaAdult');
      await confirmEmail(u);
      const s = await post('/v1/me/verification', u.token, { consent: true });
      assert.equal(s.status, 201, JSON.stringify(s.body));
      assert.equal(s.body.eligibility, 'pending');
      assert.match(s.body.url, /^https:\/\/withpersona\.com\/verify\?code=first/);
      const created = calls.find((c) => c.method === 'POST' && c.url.endsWith('/inquiries'))!;
      assert.equal(created.body.data.attributes['inquiry-template-id'], 'itmpl_face');
      assert.equal(created.body.meta['auto-create-account-reference-id'], u.id);
      assert.doesNotMatch(JSON.stringify(created.body), new RegExp(u.email.replace('.', '\\.')), 'the email address is never sent to Persona');
      const check = await prisma.verificationCheck.findFirst({ where: { userId: u.id } });
      assert.equal(check.provider, 'persona');
      assert.match(check.providerRef, /^inq_ITEST/);

      // the person closed the page: they get a fresh link for the same check
      const again = await get('/v1/me/verification', u.token);
      assert.equal(again.body.resumeUrl, 'https://withpersona.com/verify?code=fresh');

      // not signed by Persona: refused, and the person stays pending
      assert.equal((await personaHook(personaEvent(check.providerRef, 'inquiry.approved', bornYearsAgo(30)), 'a_forged_secret')).status, 401);
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'pending');

      // an event that decides nothing is acknowledged and changes nothing
      assert.equal((await personaHook(personaEvent(check.providerRef, 'inquiry.started'))).ok, true);
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'pending');

      // the signed approval
      const ok = await personaHook(personaEvent(check.providerRef, 'inquiry.approved', bornYearsAgo(30)));
      assert.equal(ok.ok, true);
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'verified');
      const stored = await prisma.verificationCheck.findFirst({ where: { userId: u.id } });
      assert.equal(JSON.stringify(stored).includes('Giulia'), false, 'no name is stored');
      await new Promise((r) => setTimeout(r, 200));
      assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/inquiries/${check.providerRef}`)), 'the inquiry was redacted at Persona');

      // a repeat of the same message changes nothing
      assert.equal((await personaHook(personaEvent(check.providerRef, 'inquiry.approved', bornYearsAgo(30)))).ok, true);
      assert.equal((await get('/v1/me', u.token)).body.eligibility, 'verified');
    });
  });

  it('offers the route with no selfie, and never marks someone as an adult without proof', async () => {
    await persona(async (calls) => {
      // document only: the template with no selfie
      const d = await signup('PersonaDoc');
      await confirmEmail(d);
      const sd = await post('/v1/me/verification', d.token, { consent: true, method: 'document' });
      assert.equal(sd.status, 201, JSON.stringify(sd.body));
      assert.equal(calls.filter((c) => c.url.endsWith('/inquiries')).at(-1)!.body.data.attributes['inquiry-template-id'], 'itmpl_doc');

      // a person under 18 is not verified, and cannot simply try again
      const m = await signup('PersonaMinor');
      await confirmEmail(m);
      await post('/v1/me/verification', m.token, { consent: true });
      const mc = await prisma.verificationCheck.findFirst({ where: { userId: m.id } });
      await personaHook(personaEvent(mc.providerRef, 'inquiry.approved', bornYearsAgo(16)));
      assert.equal((await get('/v1/me', m.token)).body.eligibility, 'rejected');
      assert.equal((await prisma.verificationCheck.findFirst({ where: { userId: m.id } })).rejectionReason, 'underage');
      assert.equal((await post('/v1/me/verification', m.token, { consent: true })).body.code, 'VERIFICATION_BLOCKED');

      // an approval that carries no age information is not accepted (the template must collect it, or refuse under-18s itself)
      const n = await signup('PersonaNoAge');
      await confirmEmail(n);
      await post('/v1/me/verification', n.token, { consent: true });
      const nc = await prisma.verificationCheck.findFirst({ where: { userId: n.id } });
      const quiet = console.error;
      console.error = () => {};
      try {
        await personaHook(personaEvent(nc.providerRef, 'inquiry.approved'));
      } finally {
        console.error = quiet;
      }
      assert.equal((await get('/v1/me', n.token)).body.eligibility, 'rejected');
    });
  });
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

  it('lets a demo server (DEMO_MODE=true) use the simulated check and show codes, even in production, but not otherwise', async () => {
    const { EmailService } = await import('../src/common/email.service');
    const { SmsService } = await import('../src/common/sms.service');
    const svc = new (verificationSvc.constructor as any)(null, null, null);
    const keys = ['NODE_ENV', 'VERIFICATION_MODE', 'DEMO_MODE', 'EMAIL_DEV_ECHO'] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      process.env.NODE_ENV = 'production';
      process.env.VERIFICATION_MODE = 'sandbox';
      process.env.EMAIL_DEV_ECHO = 'false';
      delete process.env.DEMO_MODE;
      assert.throws(() => svc.onModuleInit(), /development only/);
      assert.equal(new EmailService().devEcho, false);
      assert.equal(new SmsService().devEcho, false);
      process.env.EMAIL_DEV_ECHO = 'true';
      assert.throws(() => new EmailService(), /must not be enabled in production/);

      process.env.DEMO_MODE = 'true';
      assert.doesNotThrow(() => svc.onModuleInit());
      assert.doesNotThrow(() => new EmailService());
      assert.equal(new EmailService().devEcho, true);
      assert.equal(new SmsService().devEcho, true);
      delete process.env.VERIFICATION_MODE;
      assert.equal(svc.mode, 'sandbox', 'a demo checks itself on the simulated page unless told otherwise');
      svc.onModuleDestroy();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
