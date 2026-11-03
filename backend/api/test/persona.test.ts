process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ApiError } from '../src/common/errors';
import { ageFrom, PersonaProvider } from '../src/verification/providers/persona.provider';

/** The Persona provider on its own: no database, no server. Persona's messages are made and signed here, the way Persona does it. */
const SECRET = 'whsec_test_secret_1';
const OLD_SECRET = 'whsec_old_secret_0';
const KEYS = ['PERSONA_API_KEY', 'PERSONA_WEBHOOK_SECRET', 'PERSONA_TEMPLATE_ID', 'PERSONA_TEMPLATE_ID_DOCUMENT', 'PERSONA_VERSION', 'PERSONA_REDIRECT_URI', 'PERSONA_REDACT', 'PERSONA_TEMPLATE_ENFORCES_18'];
const saved: Record<string, string | undefined> = {};
const realFetch = globalThis.fetch;
const p = new PersonaProvider();

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  Object.assign(process.env, { PERSONA_API_KEY: 'persona_sandbox_key', PERSONA_WEBHOOK_SECRET: SECRET, PERSONA_TEMPLATE_ID: 'itmpl_face', PERSONA_TEMPLATE_ID_DOCUMENT: 'itmpl_doc' });
  delete process.env.PERSONA_TEMPLATE_ENFORCES_18;
  delete process.env.PERSONA_REDACT;
});
afterEach(() => {
  for (const k of KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
  globalThis.fetch = realFetch;
});

const sign = (raw: string, secret = SECRET, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const hook = (body: unknown, header?: string) => {
  const raw = JSON.stringify(body);
  return p.parseWebhook(Buffer.from(raw), { 'persona-signature': header ?? sign(raw) });
};

/** A Persona webhook delivery in its real shape (JSON:API, kebab-case keys). */
const event = (name: string, opts: { id?: string; birthdate?: string; fieldsBirthdate?: string; verifications?: Array<[string, string]>; extra?: Record<string, unknown> } = {}) => ({
  data: {
    type: 'event',
    id: 'evt_1',
    attributes: {
      name,
      payload: {
        data: {
          type: 'inquiry',
          id: opts.id ?? 'inq_ABC123',
          attributes: {
            status: 'approved',
            'reference-id': null,
            'name-first': 'Giulia',
            'name-last': 'Rossi',
            ...(opts.fieldsBirthdate ? { fields: { birthdate: { type: 'date', value: opts.fieldsBirthdate }, 'address-street-1': { type: 'string', value: 'Via Roma 1' } } } : {}),
            ...opts.extra,
          },
        },
        included: (opts.verifications ?? [['verification/government-id', 'passed']]).map(([type, status], i) => ({
          type,
          id: `ver_${i}`,
          attributes: { status, 'front-photo-url': 'https://files.example/id.jpg', ...(opts.birthdate && type === 'verification/government-id' ? { birthdate: opts.birthdate } : {}) },
        })),
      },
      'created-at': '2026-10-27T10:00:00.000Z',
    },
  },
});

const yearsAgo = (n: number, days = 0) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe('Persona: the signed message', () => {
  it('accepts a correctly signed approval and keeps only the outcome, never names, dates or photo links', () => {
    const out = hook(event('inquiry.approved', { birthdate: yearsAgo(30) }));
    assert.deepEqual(out, { providerRef: 'inq_ABC123', result: 'approved', adult: true });
    assert.deepEqual(Object.keys(out!).sort(), ['adult', 'providerRef', 'result']);
    assert.doesNotMatch(JSON.stringify(out), /Giulia|Rossi|Roma|files\.example|19|20\d\d-/);
  });

  it('refuses a missing, wrong, altered or stale signature', () => {
    const body = event('inquiry.approved', { birthdate: yearsAgo(30) });
    const raw = JSON.stringify(body);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof ApiError ? (e.getResponse() as { code: string }).code : String(e);
      }
      return 'ACCEPTED';
    };
    assert.equal(code(() => p.parseWebhook(Buffer.from(raw), {})), 'INVALID_SIGNATURE', 'no header');
    assert.equal(code(() => hook(body, sign(raw, 'someone_elses_secret'))), 'INVALID_SIGNATURE', 'wrong secret');
    assert.equal(code(() => p.parseWebhook(Buffer.from(raw.replace('Giulia', 'Mallory')), { 'persona-signature': sign(raw) })), 'INVALID_SIGNATURE', 'body changed after signing');
    assert.equal(code(() => hook(body, sign(raw, SECRET, Math.floor(Date.now() / 1000) - 3600))), 'INVALID_SIGNATURE', 'an hour old: a replay');
    assert.equal(code(() => hook(body, 't=abc,v1=zz')), 'INVALID_SIGNATURE', 'garbage');
    assert.equal(code(() => hook(body)), 'ACCEPTED');
  });

  it('accepts a message signed with either secret while a secret is being rotated', () => {
    const body = event('inquiry.approved', { birthdate: yearsAgo(30) });
    const raw = JSON.stringify(body);
    // Persona sends one pair per active secret, space separated: old first, new second
    const both = `${sign(raw, OLD_SECRET)} ${sign(raw, SECRET)}`;
    assert.equal(hook(body, both)?.result, 'approved', 'the new secret is found even when it is not first');
    process.env.PERSONA_WEBHOOK_SECRET = `${SECRET},${OLD_SECRET}`;
    assert.equal(hook(body, sign(raw, OLD_SECRET))?.result, 'approved', 'both secrets are known during the change');
    process.env.PERSONA_WEBHOOK_SECRET = SECRET;
    assert.throws(() => hook(body, sign(raw, OLD_SECRET)), /signature/i, 'once the old one is dropped it stops working');
  });

  it('reads camelCase and snake_case keys the same way', () => {
    const raw = JSON.stringify(event('inquiry.approved', { birthdate: yearsAgo(30) })).replace(/"front-photo-url"/g, '"frontPhotoUrl"').replace(/"created-at"/g, '"created_at"').replace(/"name-first"/g, '"nameFirst"');
    assert.equal(p.parseWebhook(Buffer.from(raw), { 'persona-signature': sign(raw) })?.result, 'approved');
  });
});

describe('Persona: what each event means', () => {
  it('only counts someone as an adult when it can be shown', () => {
    assert.equal(hook(event('inquiry.approved', { birthdate: yearsAgo(18) }))?.result, 'approved', 'turned 18 today');
    assert.deepEqual(hook(event('inquiry.approved', { birthdate: yearsAgo(18, 1) })), { providerRef: 'inq_ABC123', result: 'declined', adult: false, reason: 'underage' }, 'turns 18 tomorrow');
    assert.equal(hook(event('inquiry.approved', { fieldsBirthdate: yearsAgo(40) }))?.adult, true, 'a birth date in the template fields works too');
    assert.equal(hook(event('inquiry.approved', { fieldsBirthdate: yearsAgo(15) }))?.reason, 'underage');
  });

  it('does not accept an approval with no age information, unless the template itself refuses under-18s', () => {
    const quiet = console.error;
    const logged: string[] = [];
    console.error = (m: string) => void logged.push(String(m));
    try {
      const out = hook(event('inquiry.approved'));
      assert.equal(out?.result, 'declined', 'fails closed');
      assert.notEqual(out?.adult, true);
      assert.ok(logged.some((m) => /birth date/i.test(m)), 'and says why in the server log');
    } finally {
      console.error = quiet;
    }
    process.env.PERSONA_TEMPLATE_ENFORCES_18 = 'true';
    assert.deepEqual(hook(event('inquiry.approved')), { providerRef: 'inq_ABC123', result: 'approved', adult: true });
  });

  it('turns a finished inquiry into an approval only when every check passed', () => {
    const ok = hook(event('inquiry.completed', { birthdate: yearsAgo(25), verifications: [['verification/government-id', 'passed'], ['verification/selfie', 'passed']] }));
    assert.equal(ok?.result, 'approved');
    assert.equal(hook(event('inquiry.completed', { birthdate: yearsAgo(25), verifications: [['verification/government-id', 'passed'], ['verification/selfie', 'failed']] })), null, 'a failed check is not an approval');
    assert.equal(hook(event('inquiry.completed', { birthdate: yearsAgo(25), verifications: [] })), null, 'nothing was checked');
  });

  it('says why a decline happened, in a few plain classes', () => {
    assert.equal(hook(event('inquiry.declined', { verifications: [['verification/government-id', 'passed'], ['verification/selfie', 'failed']] }))?.reason, 'liveness');
    assert.equal(hook(event('inquiry.declined', { verifications: [['verification/government-id', 'failed']] }))?.reason, 'document');
    assert.equal(hook(event('inquiry.failed', { verifications: [['verification/government-id', 'failed']] }))?.result, 'declined');
    assert.equal(hook(event('inquiry.declined', { verifications: [] }))?.reason, 'other');
  });

  it('asks the person to try again when the inquiry expires, and ignores events that decide nothing', () => {
    assert.equal(hook(event('inquiry.expired'))?.result, 'needs_resubmission');
    for (const name of ['inquiry.created', 'inquiry.started', 'inquiry.transitioned', 'inquiry.marked-for-review', 'inquiry.redacted', 'verification.passed']) assert.equal(hook(event(name)), null, name);
  });

  it('refuses a message that is not an inquiry event', () => {
    assert.throws(() => hook({ data: { type: 'event', attributes: { name: 'inquiry.approved', payload: { data: { type: 'account', id: 'act_1' } } } } }), /payload/i);
    assert.throws(() => hook({ nothing: true }), /payload/i);
  });
});

describe('Persona: starting, resuming and erasing a check', () => {
  type Call = { url: string; method: string; headers: Record<string, string>; body: any };
  const stub = (answer: (call: Call) => { status?: number; json?: unknown }) => {
    const calls: Call[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      const call: Call = { url: String(url), method: String(init?.method), headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      const r = answer(call);
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
    }) as typeof fetch;
    return calls;
  };
  const created = { data: { id: 'inq_NEW1', attributes: { status: 'created' } }, meta: { 'one-time-link': 'https://withpersona.com/verify?code=abc' } };

  it('creates an inquiry on the right template and returns the person\'s one-time link', async () => {
    const calls = stub(() => ({ status: 201, json: created }));
    const face = await p.createSession({ id: 'user_1', email: 'a@b.it' }, { checkId: 'chk_1', baseUrl: 'http://x', method: 'face' });
    assert.deepEqual(face, { providerRef: 'inq_NEW1', url: 'https://withpersona.com/verify?code=abc' });
    const c = calls[0];
    assert.equal(c.url, 'https://api.withpersona.com/api/v1/inquiries');
    assert.equal(c.method, 'POST');
    assert.equal(c.headers.Authorization, 'Bearer persona_sandbox_key');
    assert.equal(c.headers['Idempotency-Key'], 'verification-chk_1', 'a retry cannot open a second inquiry');
    assert.ok(c.headers['Persona-Version']);
    assert.equal(c.body.data.attributes['inquiry-template-id'], 'itmpl_face');
    assert.equal(c.body.meta['auto-create-account-reference-id'], 'user_1', 'our own id names the person, not their email');
    assert.doesNotMatch(JSON.stringify(c.body), /a@b\.it/, 'the email address is never sent');

    await p.createSession({ id: 'user_1', email: 'a@b.it' }, { checkId: 'chk_2', baseUrl: 'http://x', method: 'document' });
    assert.equal(calls[1].body.data.attributes['inquiry-template-id'], 'itmpl_doc', 'the document route uses the template with no selfie');
  });

  it('sends the redirect address when one is set, and says so plainly when a route is not set up', async () => {
    const calls = stub(() => ({ status: 201, json: created }));
    process.env.PERSONA_REDIRECT_URI = 'https://herethere.app/verified';
    await p.createSession({ id: 'u', email: 'e' }, { checkId: 'c', baseUrl: '', method: 'face' });
    assert.equal(calls[0].body.data.attributes['redirect-uri'], 'https://herethere.app/verified');
    delete process.env.PERSONA_TEMPLATE_ID_DOCUMENT;
    await assert.rejects(() => p.createSession({ id: 'u', email: 'e' }, { checkId: 'c', baseUrl: '', method: 'document' }), (e: ApiError) => (e.getResponse() as { code: string }).code === 'VERIFICATION_METHOD_UNAVAILABLE');
  });

  it('turns a Persona failure into one plain message, without passing on what Persona said', async () => {
    const quiet = console.error;
    console.error = () => {};
    try {
      stub(() => ({ status: 422, json: { errors: [{ title: 'Invalid', detail: 'secret internal detail about Giulia Rossi' }] } }));
      await assert.rejects(
        () => p.createSession({ id: 'u', email: 'e' }, { checkId: 'c', baseUrl: '', method: 'face' }),
        (e: ApiError) => {
          const r = e.getResponse() as { code: string; message: string };
          return r.code === 'VERIFICATION_UNAVAILABLE' && !/Giulia|secret/.test(r.message);
        },
      );
      // an answer that is not what we expect is refused too: a link that is not https could send someone anywhere
      stub(() => ({ status: 201, json: { data: { id: 'inq_X' }, meta: { 'one-time-link': 'http://evil.example/x' } } }));
      await assert.rejects(() => p.createSession({ id: 'u', email: 'e' }, { checkId: 'c', baseUrl: '', method: 'face' }), /unexpected/i);
      globalThis.fetch = (async () => {
        throw new Error('network down');
      }) as typeof fetch;
      await assert.rejects(() => p.createSession({ id: 'u', email: 'e' }, { checkId: 'c', baseUrl: '', method: 'face' }), (e: ApiError) => (e.getResponse() as { code: string }).code === 'VERIFICATION_UNAVAILABLE');
    } finally {
      console.error = quiet;
    }
  });

  it('makes a fresh link for a person who closed the page, and none for a reference that is not an inquiry', async () => {
    const calls = stub(() => ({ json: { data: { id: 'inq_NEW1' }, meta: { 'one-time-link': 'https://withpersona.com/verify?code=fresh' } } }));
    assert.equal(await p.resumeUrl('inq_NEW1'), 'https://withpersona.com/verify?code=fresh');
    assert.equal(calls[0].url, 'https://api.withpersona.com/api/v1/inquiries/inq_NEW1/generate-one-time-link');
    assert.equal(await p.resumeUrl('pending_123'), undefined);
    assert.equal(calls.length, 1, 'and nothing was asked of Persona for it');
    stub(() => ({ status: 409, json: {} }));
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.equal(await p.resumeUrl('inq_NEW1'), undefined, 'a refusal means no link, not a crash');
    } finally {
      console.error = quiet;
    }
  });

  it('erases the inquiry at Persona once the outcome is held, unless told not to (testing)', async () => {
    const calls = stub(() => ({ json: { data: { id: 'inq_NEW1' } } }));
    await p.eraseSession('inq_NEW1');
    assert.equal(calls[0].method, 'DELETE');
    assert.equal(calls[0].url, 'https://api.withpersona.com/api/v1/inquiries/inq_NEW1');
    await p.eraseSession('../../accounts');
    assert.equal(calls.length, 1, 'a reference that is not an inquiry id is never put in a web address');
    process.env.PERSONA_REDACT = 'false';
    await p.eraseSession('inq_NEW1');
    assert.equal(calls.length, 1, 'redaction can be switched off while testing');
  });

  it('refuses to start when it is not fully set up, and says what is missing', () => {
    delete process.env.PERSONA_API_KEY;
    delete process.env.PERSONA_WEBHOOK_SECRET;
    assert.throws(() => p.assertReady(), /PERSONA_API_KEY, PERSONA_WEBHOOK_SECRET/);
  });
});

describe('Persona: ages', () => {
  it('works out full years, and only from a real date', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    assert.equal(ageFrom('2008-10-27', now), 18);
    assert.equal(ageFrom('2008-10-28', now), 17);
    assert.equal(ageFrom('1990-01-01', now), 36);
    assert.equal(ageFrom('not a date', now), null);
    assert.equal(ageFrom(undefined, now), null);
    assert.equal(ageFrom('1800-01-01', now), null);
    assert.equal(ageFrom('2000-13-45', now), null);
  });
});
