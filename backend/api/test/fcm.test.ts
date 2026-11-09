import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { resetFcm, sendFcm } from '../src/common/fcm';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];
let answer: (url: string) => Response;

beforeEach(() => {
  resetFcm();
  calls = [];
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'demo-project', client_email: 'push@demo-project.iam.gserviceaccount.com', private_key: privateKey });
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return answer(String(url));
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  resetFcm();
});

const token = () => new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
const msg = { title: 'Hi', body: 'There', url: '/chat/1' };

describe('phone push through Firebase (FCM)', () => {
  it('is skipped, not failed, when Firebase is not set up', async () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    resetFcm();
    assert.equal(await sendFcm('device-token-1', msg), 'skipped');
    assert.equal(calls.length, 0);
  });

  it('signs in once, sends the message with its tap address, and reuses the access token', async () => {
    answer = (url) => (url.includes('oauth2') ? token() : new Response('{}', { status: 200 }));
    assert.equal(await sendFcm('device-token-1', msg), 'sent');
    assert.equal(await sendFcm('device-token-2', msg), 'sent');
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1);
    const sends = calls.filter((c) => c.url.includes('fcm.googleapis.com'));
    assert.equal(sends.length, 2);
    assert.match(sends[0].url, /projects\/demo-project\/messages:send$/);
    const body = JSON.parse(String(sends[0].init?.body));
    assert.equal(body.message.token, 'device-token-1');
    assert.equal(body.message.notification.title, 'Hi');
    assert.equal(body.message.data.url, '/chat/1');
    assert.equal((sends[0].init?.headers as Record<string, string>).authorization, 'Bearer tok');
  });

  it('a chat push carries its thread: Android replaces the older one from that chat, iPhone stacks them; other pushes do not', async () => {
    answer = (url) => (url.includes('oauth2') ? token() : new Response('{}', { status: 200 }));
    await sendFcm('device-token-1', { ...msg, thread: 'chat-1' });
    await sendFcm('device-token-1', msg);
    const [chat, plain] = calls.filter((c) => c.url.includes('fcm.googleapis.com')).map((c) => JSON.parse(String(c.init?.body)).message);
    assert.equal(chat.android.notification.tag, 'chat-1');
    assert.equal(chat.android.notification.channel_id, 'alerts');
    assert.equal(chat.apns.payload.aps['thread-id'], 'chat-1');
    assert.deepEqual(chat.data, { url: '/chat/1', thread: 'chat-1' });
    assert.equal(plain.android.notification.tag, undefined);
    assert.equal(plain.apns.payload.aps['thread-id'], undefined);
  });

  it('says gone for a dead device token, retry for a server fault, and done for a refused message', async () => {
    answer = (url) => (url.includes('oauth2') ? token() : new Response(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 }));
    assert.equal(await sendFcm('dead-device-token', msg), 'gone');
    answer = (url) => (url.includes('oauth2') ? token() : new Response('{}', { status: 503 }));
    assert.equal(await sendFcm('device-token-1', msg), 'retry');
    answer = (url) => (url.includes('oauth2') ? token() : new Response('{}', { status: 400 }));
    assert.equal(await sendFcm('device-token-1', msg), 'sent');
  });

  it('asks for a new access token after Google refuses the old one', async () => {
    let first = true;
    answer = (url) => (url.includes('oauth2') ? token() : first ? ((first = false), new Response('{}', { status: 401 })) : new Response('{}', { status: 200 }));
    assert.equal(await sendFcm('device-token-1', msg), 'retry');
    assert.equal(await sendFcm('device-token-1', msg), 'sent');
    assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 2);
  });
});
