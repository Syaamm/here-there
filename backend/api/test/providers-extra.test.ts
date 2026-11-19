process.env.NODE_ENV = 'test';
process.env.VERIFF_API_KEY = 'veriff-public-key';
process.env.VERIFF_API_SECRET = 'veriff-shared-secret';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import { SMS_SENDERS } from '../src/common/sms-providers';
import { VeriffProvider } from '../src/verification/providers/veriff.provider';

const realFetch = globalThis.fetch;
let calls: { url: string; init: any }[] = [];
const mockFetch = (answer: unknown = {}, status = 200) => {
  calls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
};
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.VERIFF_ENFORCES_18;
});

const sign = (raw: Buffer | string) => createHmac('sha256', 'veriff-shared-secret').update(raw).digest('hex');
const hook = (body: unknown) => {
  const raw = Buffer.from(JSON.stringify(body));
  return { raw, headers: { 'x-hmac-signature': sign(raw) } as Record<string, string> };
};
const years = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().slice(0, 10);
};
const decision = (status: string, dob?: string, extra: Record<string, unknown> = {}) => ({ status: 'success', verification: { id: 'a1b2c3d4-0000-4000-8000-000000000001', status, person: { dateOfBirth: dob ?? null }, ...extra } });

describe('Veriff', () => {
  const veriff = new VeriffProvider();

  it('opens a session with the API key and gives back the hosted link', async () => {
    mockFetch({ status: 'success', verification: { id: 'a1b2c3d4-0000-4000-8000-000000000001', url: 'https://magic.veriff.me/v/abc' } });
    const out = await veriff.createSession({ id: 'user1', email: 'x@y.z' });
    assert.equal(out.providerRef, 'a1b2c3d4-0000-4000-8000-000000000001');
    assert.equal(out.url, 'https://magic.veriff.me/v/abc');
    assert.equal(calls[0].url, 'https://stationapi.veriff.com/v1/sessions');
    assert.equal(calls[0].init.headers['X-AUTH-CLIENT'], 'veriff-public-key');
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.verification.vendorData, 'user1');
    assert.ok(!JSON.stringify(sent).includes('x@y.z'), 'no email or name is sent to the provider');
  });

  it('refuses a webhook with a wrong or missing signature', () => {
    const { raw } = hook(decision('approved', years(30)));
    assert.throws(() => veriff.parseWebhook(raw, { 'x-hmac-signature': 'a'.repeat(64) }), /signature/i);
    assert.throws(() => veriff.parseWebhook(raw, {}), /signature/i);
  });

  it('approves an adult, declines an under-18 and never accepts an approval that cannot show age', () => {
    const adult = hook(decision('approved', years(30)));
    assert.deepEqual(veriff.parseWebhook(adult.raw, adult.headers), { providerRef: 'a1b2c3d4-0000-4000-8000-000000000001', result: 'approved', adult: true });

    const minor = hook(decision('approved', years(16)));
    assert.equal(veriff.parseWebhook(minor.raw, minor.headers)?.result, 'declined');
    assert.equal(veriff.parseWebhook(minor.raw, minor.headers)?.reason, 'underage');

    const unknownAge = hook(decision('approved'));
    assert.equal(veriff.parseWebhook(unknownAge.raw, unknownAge.headers)?.result, 'declined'); // no birth date, account not set to refuse minors
    process.env.VERIFF_ENFORCES_18 = 'true';
    assert.equal(veriff.parseWebhook(unknownAge.raw, unknownAge.headers)?.result, 'approved');
  });

  it('maps the other decisions, and ignores event notices and undecided sessions', () => {
    const declined = hook(decision('declined', years(30), { reason: 'Presented document is expired' }));
    assert.deepEqual(veriff.parseWebhook(declined.raw, declined.headers)?.reason, 'document');
    const spoof = hook(decision('declined', years(30), { reason: 'Face could not be matched to the selfie' }));
    assert.equal(veriff.parseWebhook(spoof.raw, spoof.headers)?.reason, 'liveness');
    const again = hook(decision('resubmission_requested'));
    assert.equal(veriff.parseWebhook(again.raw, again.headers)?.result, 'needs_resubmission');
    const review = hook(decision('review'));
    assert.equal(veriff.parseWebhook(review.raw, review.headers), null);
    const started = hook({ id: 'a1b2c3d4-0000-4000-8000-000000000001', action: 'started', code: 7001 });
    assert.equal(veriff.parseWebhook(started.raw, started.headers), null);
  });

  it('looks a decision up, and deletes the session, signing the session id', async () => {
    const id = 'a1b2c3d4-0000-4000-8000-000000000001';
    mockFetch(decision('approved', years(30)).verification ? { status: 'success', verification: { id, status: 'approved', person: { dateOfBirth: years(30) } } } : {});
    assert.equal((await veriff.lookup(id))?.result, 'approved');
    assert.equal(calls[0].url, `https://stationapi.veriff.com/v1/sessions/${id}/decision`);
    assert.equal(calls[0].init.headers['X-HMAC-SIGNATURE'], sign(id));
    mockFetch({});
    await veriff.eraseSession(id);
    assert.equal(calls[0].init.method, 'DELETE');
    assert.equal(calls[0].init.headers['X-HMAC-SIGNATURE'], sign(id));
  });
});

describe('SMS providers', () => {
  it('MSG91 sends the code through the saved template', async () => {
    mockFetch({ type: 'success' });
    await SMS_SENDERS.msg91('+919876543210', 'Your LAMIS code is 482913. It expires in 15 minutes.', { authKey: 'k', templateId: 'tpl1', otpVariable: 'OTP' });
    assert.equal(calls[0].url, 'https://control.msg91.com/api/v5/flow/');
    assert.equal(calls[0].init.headers.authkey, 'k');
    assert.deepEqual(JSON.parse(calls[0].init.body), { template_id: 'tpl1', short_url: '0', recipients: [{ mobiles: '919876543210', OTP: '482913' }] });
    mockFetch({ type: 'error' });
    await assert.rejects(SMS_SENDERS.msg91('+919876543210', 'code 111111', { authKey: 'k', templateId: 't' }), /MSG91/);
  });

  it('Vonage, Plivo and Sinch send the message in their own format', async () => {
    mockFetch({ messages: [{ status: '0' }] });
    await SMS_SENDERS.vonage('+447700900123', 'hello', { apiKey: 'ak', apiSecret: 'as', from: 'LAMIS' });
    assert.equal(calls[0].url, 'https://rest.nexmo.com/sms/json');
    assert.deepEqual(JSON.parse(calls[0].init.body), { api_key: 'ak', api_secret: 'as', to: '447700900123', from: 'LAMIS', text: 'hello' });
    mockFetch({ messages: [{ status: '4' }] });
    await assert.rejects(SMS_SENDERS.vonage('+447700900123', 'hello', { apiKey: 'ak', apiSecret: 'bad', from: 'LAMIS' }), /Vonage/);

    mockFetch({});
    await SMS_SENDERS.plivo('+14155550100', 'hello', { authId: 'MAID', authToken: 'tok', from: '+14155550000' });
    assert.equal(calls[0].url, 'https://api.plivo.com/v1/Account/MAID/Message/');
    assert.equal(calls[0].init.headers.Authorization, 'Basic ' + Buffer.from('MAID:tok').toString('base64'));
    assert.deepEqual(JSON.parse(calls[0].init.body), { src: '14155550000', dst: '14155550100', text: 'hello' });

    mockFetch({});
    await SMS_SENDERS.sinch('+4670000000', 'hello', { servicePlanId: 'plan1', apiToken: 'tok', from: '+4671111111', region: 'eu' });
    assert.equal(calls[0].url, 'https://eu.sms.api.sinch.com/xms/v1/plan1/batches');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(calls[0].init.body), { from: '+4671111111', to: ['+4670000000'], body: 'hello' });
  });

  it('Telnyx and Infobip send the message in their own format', async () => {
    mockFetch({});
    await SMS_SENDERS.telnyx('+14155550100', 'hello', { apiKey: 'KEY', from: '+14155550000' });
    assert.equal(calls[0].url, 'https://api.telnyx.com/v2/messages');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer KEY');
    assert.deepEqual(JSON.parse(calls[0].init.body), { from: '+14155550000', to: '+14155550100', text: 'hello' });

    mockFetch({});
    await SMS_SENDERS.infobip('+447700900123', 'hello', { baseUrl: 'https://abc123.api.infobip.com/', apiKey: 'KEY', from: 'LAMIS' });
    assert.equal(calls[0].url, 'https://abc123.api.infobip.com/sms/2/text/advanced');
    assert.equal(calls[0].init.headers.Authorization, 'App KEY');
    assert.deepEqual(JSON.parse(calls[0].init.body), { messages: [{ from: 'LAMIS', destinations: [{ to: '447700900123' }], text: 'hello' }] });
    // the key is never sent to an address that is not a plain host name
    await assert.rejects(SMS_SENDERS.infobip('+447700900123', 'hi', { baseUrl: 'evil.com:99@x', apiKey: 'KEY', from: 'L' }), /base URL/);
  });

  it('a provider that refuses is an error that never carries the key', async () => {
    mockFetch({ error: 'bad key sk_live_SECRET' }, 401);
    await assert.rejects(SMS_SENDERS.plivo('+14155550100', 'hi', { authId: 'MAID', authToken: 'sk_live_SECRET', from: '1' }), (e: Error) => /401/.test(e.message) && !e.message.includes('SECRET'));
  });
});
