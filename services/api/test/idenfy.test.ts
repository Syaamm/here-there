process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ApiError } from '../src/common/errors';
import { IdenfyProvider } from '../src/verification/providers/idenfy.provider';

/** The iDenfy provider on its own: no database, no server. iDenfy's messages are made and signed here, the way iDenfy does it. */
const SECRET = 'idenfy_signing_key_1';
const OLD_SECRET = 'idenfy_signing_key_0';
const KEYS = ['IDENFY_API_KEY', 'IDENFY_API_SECRET', 'IDENFY_WEBHOOK_SECRET', 'IDENFY_REDIRECT_URI', 'IDENFY_REDACT', 'IDENFY_ENFORCES_18', 'IDENFY_BASE_URL'];
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
let p = new IdenfyProvider();

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { IDENFY_API_KEY: 'key_1', IDENFY_API_SECRET: 'secret_1', IDENFY_WEBHOOK_SECRET: SECRET });
  delete process.env.IDENFY_ENFORCES_18;
  delete process.env.IDENFY_REDACT;
  delete process.env.IDENFY_REDIRECT_URI;
  p = new IdenfyProvider(); // a fresh one: its lookup memory starts empty
});
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  globalThis.fetch = realFetch;
});

const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');
const SCAN = '328c6766-934e-11ed-bb9b-025ad99a18e7';

/** A result in the shape of iDenfy's webhook (see the JSON schema in the dashboard). */
const result = (overall: string, o: { final?: boolean; dob?: string | null; fraudTags?: string[]; mismatchTags?: string[]; autoFace?: string; manualFace?: string; scanRef?: string } = {}) => ({
  final: o.final ?? true,
  status: { overall, suspicionReasons: [], denyReasons: [], fraudTags: o.fraudTags ?? [], mismatchTags: o.mismatchTags ?? [], autoFace: o.autoFace ?? 'FACE_MATCH', manualFace: o.manualFace ?? 'FACE_MATCH', autoDocument: 'DOC_VALIDATED', manualDocument: 'DOC_VALIDATED' },
  data: { docFirstName: 'GIULIA', docLastName: 'ROSSI', docNumber: 'AX1234567', docDob: o.dob === undefined ? '1990-05-17' : o.dob },
  scanRef: o.scanRef ?? SCAN,
  clientId: 'user-1',
});
const hook = (body: unknown, opts: { header?: string; event?: string; secret?: string } = {}) => {
  const raw = JSON.stringify(body);
  return p.parseWebhook(Buffer.from(raw), { 'idenfy-signature': opts.header ?? sign(raw, opts.secret), 'idenfy-event-type': opts.event ?? 'IDENTIFICATION_AUTO_FINISHED' });
};
const years = (n: number) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - n); return d.toISOString().slice(0, 10); };

describe('iDenfy: signing', () => {
  it('accepts a message signed with the signing key', () => {
    assert.deepEqual(hook(result('APPROVED')), { providerRef: SCAN, result: 'approved', adult: true });
  });
  it('refuses a wrong signature, a missing one and a malformed one, with 401', () => {
    for (const header of [sign('{}', 'someone-elses-key'), '', 'not-hex']) {
      assert.throws(() => hook(result('APPROVED'), { header }), (e: unknown) => e instanceof ApiError && e.getStatus() === 401);
    }
    assert.throws(() => p.parseWebhook(Buffer.from('{}'), {}), (e: unknown) => e instanceof ApiError && e.getStatus() === 401);
  });
  it('refuses a body changed after signing', () => {
    const raw = JSON.stringify(result('DENIED'));
    assert.throws(() => p.parseWebhook(Buffer.from(raw.replace('DENIED', 'APPROVED')), { 'idenfy-signature': sign(raw) }), (e: unknown) => e instanceof ApiError && e.getStatus() === 401);
  });
  it('accepts the old and the new key while a key is being rotated', () => {
    process.env.IDENFY_WEBHOOK_SECRET = `${SECRET}, ${OLD_SECRET}`;
    assert.equal(hook(result('APPROVED'), { secret: OLD_SECRET })?.result, 'approved');
    assert.equal(hook(result('APPROVED'), { secret: SECRET })?.result, 'approved');
  });
  it('refuses everything when no signing key is set', () => {
    process.env.IDENFY_WEBHOOK_SECRET = '';
    assert.throws(() => hook(result('APPROVED')), (e: unknown) => e instanceof ApiError && e.getStatus() === 401);
  });
  it('answers 400 to a signed body that is not JSON or not a result', () => {
    const raw = 'not json';
    assert.throws(() => p.parseWebhook(Buffer.from(raw), { 'idenfy-signature': sign(raw) }), (e: unknown) => e instanceof ApiError && e.getStatus() === 400);
    assert.throws(() => hook({ hello: 'world' }), (e: unknown) => e instanceof ApiError && e.getStatus() === 400);
  });
});

describe('iDenfy: outcomes and the 18+ rule', () => {
  it('approves an adult, from the birth date', () => {
    assert.deepEqual(hook(result('APPROVED', { dob: years(30) })), { providerRef: SCAN, result: 'approved', adult: true });
    assert.equal(hook(result('APPROVED', { dob: years(18) }))?.result, 'approved');
  });
  it('declines an approved person who is under 18 as underage, however iDenfy marked them', () => {
    assert.deepEqual(hook(result('APPROVED', { dob: years(15) })), { providerRef: SCAN, result: 'declined', adult: false, reason: 'underage' });
    assert.equal(hook(result('APPROVED', { mismatchTags: ['UNDER_AGE'] }))?.reason, 'underage');
  });
  it('does not accept an approval with no birth date, unless the account is set to refuse under-18s', () => {
    assert.deepEqual(hook(result('APPROVED', { dob: null })), { providerRef: SCAN, result: 'declined', reason: 'other' });
    process.env.IDENFY_ENFORCES_18 = 'true';
    assert.deepEqual(hook(result('APPROVED', { dob: null })), { providerRef: SCAN, result: 'approved', adult: true });
  });
  it('waits for a preliminary result (final false): manual review is still to come', () => {
    assert.equal(hook(result('APPROVED', { final: false })), null);
    assert.equal(hook(result('DENIED', { final: false })), null);
  });
  it('declines a denied person and says why, in a class', () => {
    assert.equal(hook(result('DENIED'))?.reason, 'document');
    assert.equal(hook(result('DENIED', { autoFace: 'FACE_MISMATCH' }))?.reason, 'liveness');
    assert.equal(hook(result('DENIED', { manualFace: 'FAKE_FACE' }))?.reason, 'liveness');
    assert.equal(hook(result('DENIED', { fraudTags: ['DUPLICATE_FACE'] }))?.reason, 'fraud');
    assert.equal(hook(result('DENIED', { mismatchTags: ['UNDER_AGE'], dob: years(14) }))?.reason, 'underage');
  });
  it('declines a suspected one (it is flagged, not accepted)', () => {
    assert.deepEqual(hook(result('SUSPECTED', { fraudTags: ['DOC_PRINT_SPOOFED'] })), { providerRef: SCAN, result: 'declined', reason: 'fraud' });
  });
  it('asks for a new try when the session expired', () => {
    assert.deepEqual(hook(result('EXPIRED'), { event: 'IDENTIFICATION_EXPIRED' }), { providerRef: SCAN, result: 'needs_resubmission' });
  });
  it('ignores a cancelled session and states that decide nothing yet', () => {
    assert.equal(hook({ scanRef: SCAN }, { event: 'IDENTIFICATION_CANCELLED' }), null);
    for (const s of ['ACTIVE', 'REVIEWING', 'ARCHIVED', 'DELETED']) assert.equal(hook(result(s)), null);
  });
  it('returns only the reference and the outcome: no name, birth date or document number', () => {
    const out = JSON.stringify(hook(result('APPROVED')));
    for (const secret of ['GIULIA', 'ROSSI', 'AX1234567', '1990-05-17']) assert.ok(!out.includes(secret));
  });
});

/** iDenfy's API, played back: records every call so the tests can look at what we sent. */
function fakeApi(replies: Record<string, { status?: number; body?: unknown }>) {
  const calls: Array<{ path: string; auth: string; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, auth: String((init?.headers as Record<string, string>)?.Authorization), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = replies[path] ?? { status: 404 };
    const status = r.status ?? 200;
    return new Response(status === 200 && r.body === undefined ? '' : JSON.stringify(r.body ?? {}), { status });
  }) as typeof fetch;
  return calls;
}
const user = { id: 'user-1', email: 'a@b.it' };

describe('iDenfy: starting, looking up and erasing', () => {
  it('starts a face check: document + selfie, age limit 18, our user id as the client id, basic auth', async () => {
    const calls = fakeApi({ '/api/v2/token': { body: { scanRef: SCAN, authToken: 'token-abc-123456' } } });
    const s = await p.createSession(user, { checkId: 'check-1', baseUrl: 'https://api.example', method: 'face' });
    assert.deepEqual(s, { providerRef: SCAN, url: 'https://ivs.idenfy.com/api/v2/redirect?authToken=token-abc-123456' });
    assert.equal(calls[0].body.tokenType, 'IDENTIFICATION');
    assert.equal(calls[0].body.ageLimit, 18);
    assert.equal(calls[0].body.clientId, 'user-1');
    assert.equal(calls[0].body.externalRef, 'check-1');
    assert.equal(calls[0].auth, `Basic ${Buffer.from('key_1:secret_1').toString('base64')}`);
    for (const k of ['firstName', 'lastName', 'dateOfBirth']) assert.ok(!(k in calls[0].body)); // no personal data goes out
  });
  it('starts a document check with no selfie: tokenType DOCUMENT', async () => {
    const calls = fakeApi({ '/api/v2/token': { body: { scanRef: SCAN, authToken: 'token-abc-123456' } } });
    await p.createSession(user, { checkId: 'check-2', baseUrl: '', method: 'document' });
    assert.equal(calls[0].body.tokenType, 'DOCUMENT');
  });
  it('sends the redirect address only when it is an https one', async () => {
    const calls = fakeApi({ '/api/v2/token': { body: { scanRef: SCAN, authToken: 'token-abc-123456' } } });
    process.env.IDENFY_REDIRECT_URI = 'http://insecure.example';
    await p.createSession(user, { checkId: 'c', baseUrl: '', method: 'face' });
    assert.ok(!('successUrl' in calls[0].body));
    process.env.IDENFY_REDIRECT_URI = 'https://app.example/verify';
    await p.createSession(user, { checkId: 'c', baseUrl: '', method: 'face' });
    assert.equal(calls[1].body.successUrl, 'https://app.example/verify');
  });
  it('answers 502 when iDenfy refuses, is down, or gives an odd answer', async () => {
    fakeApi({ '/api/v2/token': { status: 401 } });
    await assert.rejects(p.createSession(user, { checkId: 'c', baseUrl: '', method: 'face' }), (e: unknown) => e instanceof ApiError && e.getStatus() === 502);
    fakeApi({ '/api/v2/token': { body: { hello: 1 } } });
    await assert.rejects(p.createSession(user, { checkId: 'c', baseUrl: '', method: 'face' }), (e: unknown) => e instanceof ApiError && e.getStatus() === 502);
    globalThis.fetch = (async () => { throw new Error('down'); }) as typeof fetch;
    await assert.rejects(p.createSession(user, { checkId: 'c', baseUrl: '', method: 'face' }), (e: unknown) => e instanceof ApiError && e.getStatus() === 502);
  });
  it('refuses to start when it is not fully set up, and says what is missing', () => {
    delete process.env.IDENFY_API_SECRET;
    assert.throws(() => p.assertReady(), /IDENFY_API_SECRET/);
  });
  it('looks a result up when the webhook never came, with the same rules', async () => {
    const calls = fakeApi({ '/api/v2/status': { body: { status: 'APPROVED', scanRef: SCAN, fraudTags: [], mismatchTags: [], autoFace: 'FACE_MATCH', manualFace: 'FACE_MATCH' } }, '/api/v2/data': { body: { docDob: years(25), scanRef: SCAN } } });
    assert.deepEqual(await p.lookup(SCAN), { providerRef: SCAN, result: 'approved', adult: true });
    assert.deepEqual(calls.map((c) => c.path), ['/api/v2/status', '/api/v2/data']);
  });
  it('declines a looked-up under-18 and keeps waiting while undecided', async () => {
    fakeApi({ '/api/v2/status': { body: { status: 'APPROVED', mismatchTags: [], fraudTags: [] } }, '/api/v2/data': { body: { docDob: years(16) } } });
    assert.equal((await p.lookup(SCAN))?.reason, 'underage');
    p = new IdenfyProvider();
    fakeApi({ '/api/v2/status': { body: { status: 'ACTIVE' } } });
    assert.equal(await p.lookup(SCAN), null);
  });
  it('does not ask iDenfy about the same check more than once in 30 seconds', async () => {
    const calls = fakeApi({ '/api/v2/status': { body: { status: 'ACTIVE' } } });
    await p.lookup(SCAN);
    await p.lookup(SCAN);
    assert.equal(calls.length, 1);
  });
  it('deletes the personal data once the outcome is held, unless told not to (testing)', async () => {
    const calls = fakeApi({ '/api/v2/delete': {} });
    await p.eraseSession(SCAN);
    assert.deepEqual(calls.map((c) => [c.path, c.body]), [['/api/v2/delete', { scanRef: SCAN }]]);
    process.env.IDENFY_REDACT = 'false';
    await p.eraseSession(SCAN);
    assert.equal(calls.length, 1);
  });
});
