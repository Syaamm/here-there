import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '15'; // this file checks the real lifetime
  h = await startHarness('sessions');
});
after(async () => {
  await h?.stop();
});

const login = async (email: string) => (await h.post('/v1/auth/login', undefined, { email, password: 'a-long-password-1' })).body;

describe('sign-ins that can be ended', () => {
  it('a sign-in is an access token plus a refresh token, and the refresh token swaps for a new pair', async () => {
    const u = await h.verified('Refresher');
    const first = await login(u.email);
    assert.ok(first.token && first.refreshToken?.startsWith('rt_'));
    assert.equal(first.expiresIn, 15 * 60, 'the access token is short-lived');
    const next = await h.post('/v1/auth/refresh', undefined, { refreshToken: first.refreshToken });
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.notEqual(next.body.refreshToken, first.refreshToken, 'each refresh hands out a new refresh token');
    assert.equal((await h.get('/v1/me', next.body.token)).status, 200);
  });

  it('a refresh token that was already used, shown again later, ends that whole sign-in (it was copied)', async () => {
    const u = await h.verified('Copied');
    const first = await login(u.email);
    const second = (await h.post('/v1/auth/refresh', undefined, { refreshToken: first.refreshToken })).body;
    // the first token is a used one; after the short grace period, showing it again means someone else has it
    await h.prisma.session.updateMany({ where: { userId: u.id }, data: { lastUsedAt: new Date(Date.now() - 60_000) } });
    const replay = await h.post('/v1/auth/refresh', undefined, { refreshToken: first.refreshToken });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'REFRESH_TOKEN_REUSED');
    const after = await h.post('/v1/auth/refresh', undefined, { refreshToken: second.refreshToken });
    assert.equal(after.status, 401, 'the newest refresh token of that sign-in is gone too');
  });

  it('two refreshes a moment apart (the app asked twice) are not treated as theft', async () => {
    const u = await h.verified('Twice');
    const first = await login(u.email);
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: first.refreshToken })).status, 201);
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: first.refreshToken })).status, 201, 'inside the grace period');
  });

  it('log out of this device ends that sign-in only', async () => {
    const u = await h.verified('TwoPhones');
    const phone = await login(u.email);
    const tablet = await login(u.email);
    assert.equal((await h.post('/v1/auth/logout', phone.token, { refreshToken: phone.refreshToken })).status, 201);
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: phone.refreshToken })).status, 401, 'the phone cannot refresh any more');
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: tablet.refreshToken })).status, 201, 'the tablet is untouched');
    const list = (await h.get('/v1/me/sessions', tablet.token)).body.items;
    assert.ok(list.some((s: any) => s.current), 'the list says which one is this device');
  });

  it('log out everywhere stops every access token at once and every refresh token', async () => {
    const u = await h.verified('LostPhone');
    const phone = await login(u.email);
    const laptop = await login(u.email);
    assert.equal((await h.get('/v1/me', phone.token)).status, 200);
    assert.equal((await h.post('/v1/me/sessions/logout-all', laptop.token, {})).status, 201);
    assert.equal((await h.get('/v1/me', phone.token)).status, 401, 'a copied access token dies immediately, not in 15 minutes');
    assert.equal((await h.get('/v1/me', laptop.token)).status, 401);
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: phone.refreshToken })).status, 401);
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: laptop.refreshToken })).status, 401);
    const again = await login(u.email);
    assert.equal((await h.get('/v1/me', again.token)).status, 200, 'signing in again works as usual');
  });

  it('changing the password ends every other sign-in, and this device gets a fresh one', async () => {
    const u = await h.verified('ChangesPassword');
    const other = await login(u.email);
    const here = await login(u.email);
    const changed = await h.post('/v1/me/password', here.token, { currentPassword: 'a-long-password-1', newPassword: 'another-long-password-2' });
    assert.equal(changed.status, 201, JSON.stringify(changed.body));
    assert.ok(changed.body.token && changed.body.refreshToken);
    assert.equal((await h.get('/v1/me', other.token)).status, 401);
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: other.refreshToken })).status, 401);
    assert.equal((await h.get('/v1/me', changed.body.token)).status, 200);
  });

  it('a refresh token that was never issued, or is not a refresh token, is refused', async () => {
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: 'rt_' + 'x'.repeat(40) })).body.code, 'INVALID_REFRESH_TOKEN');
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: 'not-a-refresh-token' })).body.code, 'INVALID_REFRESH_TOKEN');
  });

  it('a suspended account cannot refresh', async () => {
    const u = await h.verified('Suspended');
    const s = await login(u.email);
    await h.prisma.user.update({ where: { id: u.id }, data: { state: 'suspended' } });
    assert.equal((await h.post('/v1/auth/refresh', undefined, { refreshToken: s.refreshToken })).status, 401);
  });

  it('the clean-up removes expired sign-ins', async () => {
    const u = await h.verified('Expired');
    await h.prisma.session.create({ data: { userId: u.id, refreshHash: 'h-expired', expiresAt: new Date(Date.now() - 1000) } });
    const { JobsService } = await import('../src/common/jobs.service');
    assert.equal(await h.prisma.session.count({ where: { refreshHash: 'h-expired' } }), 1);
    const done = await h.app.get(JobsService).purge();
    assert.ok(done.sessions >= 1);
    assert.equal(await h.prisma.session.count({ where: { refreshHash: 'h-expired' } }), 0);
  });
});

describe('signing up and signing in do not reveal who is a member', () => {
  it('signing up with a new address and with a taken one gives the same kind of answer', async () => {
    const taken = await h.verified('AlreadyHere');
    const fresh = await h.post('/v1/auth/register', undefined, { email: 'brand-new@example.com', password: 'a-long-password-1', displayName: 'Brand New', adultConfirmed: true });
    const dupe = await h.post('/v1/auth/register', undefined, { email: taken.email, password: 'a-long-password-1', displayName: 'Impostor', adultConfirmed: true });
    assert.equal(fresh.status, 201);
    assert.equal(dupe.status, 201, 'no "already exists" error');
    assert.deepEqual(Object.keys(fresh.body).filter((k) => k !== 'devCode').sort(), Object.keys(dupe.body).sort());
    assert.equal(fresh.body.pending, true);
    assert.equal(dupe.body.pending, true);
    assert.equal(dupe.body.token, undefined, 'a taken address never gets a sign-in');
    assert.equal(await h.prisma.user.count({ where: { email: taken.email } }), 1, 'the existing account was not touched');
  });

  it('the person who owns the taken address is told by email; the code confirms only the real sign-up', async () => {
    const owner = await h.verified('Owner');
    const before = (await h.prisma.contactCode.count({ where: { userId: owner.id } })) as number;
    const dupe = await h.post('/v1/auth/register', undefined, { email: owner.email, password: 'a-long-password-1', displayName: 'Impostor', adultConfirmed: true });
    assert.equal(await h.prisma.contactCode.count({ where: { userId: owner.id } }), before, 'no code was made for the existing account');
    const guess = await h.post('/v1/auth/register/confirm', undefined, { email: owner.email, code: '123456', ticket: dupe.body.ticket });
    assert.equal(guess.status, 400);
    assert.equal(guess.body.code, 'INVALID_CODE');
    const nobody = await h.post('/v1/auth/register/confirm', undefined, { email: 'nobody@example.com', code: '123456', ticket: dupe.body.ticket });
    assert.deepEqual(nobody.body, guess.body, 'an unknown address gets the very same refusal');
  });

  it('a person who signs up twice cannot be taken over by someone who knows only their address', async () => {
    const email = 'squat-target@example.com';
    const real = await h.post('/v1/auth/register', undefined, { email, password: 'a-long-password-1', displayName: 'Real Person', adultConfirmed: true });
    const second = await h.post('/v1/auth/register', undefined, { email, password: 'someone-elses-pass-9', displayName: 'Squatter', adultConfirmed: true });
    assert.notEqual(second.body.ticket, real.body.ticket);
    const mail = [...h.emailSvc.outbox].reverse().find((m: any) => m.to === email && /\d{6}/.test(m.text));
    const code = /(\d{6})/.exec(mail.text)![1];
    const stolen = await h.post('/v1/auth/register/confirm', undefined, { email, code, ticket: second.body.ticket });
    assert.equal(stolen.status, 400, 'even with the right code, the second sign-up ticket matches nothing');
    assert.equal((await h.post('/v1/auth/register/confirm', undefined, { email, code, ticket: real.body.ticket })).status, 201, 'the real person confirms with their own ticket');
  });

  it('signing in with a wrong password and with an unknown address gives the same answer', async () => {
    const u = await h.verified('RealMember');
    const wrong = await h.post('/v1/auth/login', undefined, { email: u.email, password: 'definitely-not-it-1' });
    const unknown = await h.post('/v1/auth/login', undefined, { email: 'no-such-member@example.com', password: 'definitely-not-it-1' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(unknown.body, wrong.body);
  });
});

describe('standard security headers', () => {
  it('the API sends them, and the share page keeps its own content policy', async () => {
    const r = await fetch(h.base + '/v1/me');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('strict-transport-security') ?? '', /max-age=/);
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.ok(r.headers.get('content-security-policy'), 'a content policy on API answers');
    assert.equal(r.headers.get('x-powered-by'), null);
    const photoHeaders = await fetch(h.base + '/v1/openapi.json');
    assert.equal(photoHeaders.headers.get('cross-origin-resource-policy'), 'cross-origin', 'pictures and the API can still be loaded by the app');
  });
});
