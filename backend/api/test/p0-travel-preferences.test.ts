// THERE sign-up answers (travel wishlist, travel window, companions): stored, private, exported, erased on deletion.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = require('./test-db').testDatabaseUrl('p0-travel-preferences');
process.env.VERIFICATION_MODE = 'manual';
process.env.REGISTER_LIMIT_PER_HOUR = '10000';
process.env.BCRYPT_ROUNDS = '4';
process.env.ARGON2_MEMORY_KIB = '8';
process.env.ARGON2_PASSES = '1';
process.env.TRUST_PROXY = '1';
process.env.ACCESS_TOKEN_MINUTES = '600'; // a slow test run must not outlive the real 15-minute sign-in

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as bcrypt from 'bcryptjs';
import { dropTestDatabase, resetTestDatabase } from './test-db';

const root = path.resolve(__dirname, '..', '..');
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

before(async () => {
  await resetTestDatabase('p0-travel-preferences');
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { EmailService } = await import('../src/common/email.service');
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  prisma = app.get(PrismaService);
  emailSvc = app.get(EmailService);
});

after(async () => {
  await app?.close();
  await dropTestDatabase('p0-travel-preferences');
});

async function exportOf(u: { token: string }) {
  const link = await post('/v1/me/export/zip-link', u.token, { lang: 'en' });
  assert.equal(link.status, 201, JSON.stringify(link.body));
  const res = await fetch(link.body.url.replace(/^https?:\/\/[^/]+/, base));
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  return JSON.parse(strFromU8(files['my-data.json']));
}

describe('travel preferences from the THERE sign-up', () => {
  it('are optional, saved, private, exported and erased on deletion', async () => {
    const u = await signup('Wanderer');
    const viewer = await signup('Viewer');
    await confirmEmail(u);
    await confirmEmail(viewer);

    // a new account has none of them, and nothing was required
    const fresh = (await get('/v1/me', u.token)).body.profile;
    assert.deepEqual(fresh.travelWishlist, []);
    assert.equal(fresh.travelWindow, null);
    assert.equal(fresh.travelCompanions, null);

    // wrong values are refused
    assert.equal((await call('PATCH', '/v1/me/profile', u.token, { travelWishlist: ['moon'] })).status, 400);
    assert.equal((await call('PATCH', '/v1/me/profile', u.token, { travelWindow: 'tomorrow' })).status, 400);
    assert.equal((await call('PATCH', '/v1/me/profile', u.token, { travelCompanions: 'crowd' })).status, 400);

    // saved and returned to the owner; an update of something else keeps them
    const r = await call('PATCH', '/v1/me/profile', u.token, { travelWishlist: ['mountains', 'beaches', 'beaches'], travelWindow: 'one_to_three', travelCompanions: 'small_group' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.profile.travelWishlist, ['mountains', 'beaches']);
    assert.equal(r.body.profile.travelWindow, 'one_to_three');
    assert.equal(r.body.profile.travelCompanions, 'small_group');
    await call('PATCH', '/v1/me/profile', u.token, { bio: 'hello' });
    assert.equal((await get('/v1/me', u.token)).body.profile.travelWindow, 'one_to_three');

    // private: other people never see them
    const pub = await get(`/v1/users/${u.id}`, viewer.token);
    assert.equal(pub.status, 200, JSON.stringify(pub.body));
    for (const k of ['travelWishlist', 'travelWindow', 'travelCompanions']) assert.ok(!(k in pub.body), `${k} not on the public profile`);

    // in the data download
    const ex = await exportOf(u);
    assert.deepEqual(ex.profile.travelWishlist, ['mountains', 'beaches']);
    assert.equal(ex.profile.travelWindow, 'one_to_three');
    assert.equal(ex.profile.travelCompanions, 'small_group');

    // can be cleared
    const c = await call('PATCH', '/v1/me/profile', u.token, { travelWishlist: [], travelWindow: null, travelCompanions: null });
    assert.deepEqual(c.body.profile.travelWishlist, []);
    assert.equal(c.body.profile.travelWindow, null);

    // erased on deletion
    await call('PATCH', '/v1/me/profile', u.token, { travelWishlist: ['cities'], travelWindow: 'flexible', travelCompanions: 'open' });
    const gone = await post('/v1/me/delete', u.token, { password: 'a-long-password-1', confirm: 'DELETE' });
    assert.equal(gone.status, 201, JSON.stringify(gone.body));
    const row = await prisma.profile.findUnique({ where: { userId: u.id } });
    assert.equal(row.travelWishlist, '');
    assert.equal(row.travelWindow, null);
    assert.equal(row.travelCompanions, null);
  });
});
