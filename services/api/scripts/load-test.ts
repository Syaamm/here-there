/**
 * Load test: thousands of signed-in phones, each with a live connection, chatting inside group chats while also polling the way
 * the app does. It measures what a person would feel: how long a send takes, how long until the OTHER members receive it over the
 * live connection, how many messages are lost, and the errors (429, 5xx, dropped connections).
 *
 * SAFETY: it refuses any address that is not this computer unless you pass --allow-remote, and it needs data from `npm run load:seed`
 * (run against a throw-away database, never live). Chat rows and alerts are created for real: use a database you can throw away.
 *
 * Start the API under test with settings that let one computer act as many people (test servers only):
 *   REGISTER_LIMIT_PER_HOUR=100000 ACCESS_TOKEN_MINUTES=600 TRUST_PROXY=1 DATABASE_URL=<the throw-away database> npm start
 *
 * Usage (from services/api, after npm run build):
 *   npm run load:test -- [--base http://localhost:3000] [--users 300] [--seconds 60] [--msgs-per-min 6]
 *                        [--mode optimised|legacy] [--manifest load-manifest.json] [--allow-remote]
 * `--mode legacy` makes every phone re-read the chat page for every live message (how the app behaved before the 2026-11-02
 * change), so you can compare before and after on the same data.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');
const USERS = Number(arg('users', '300'));
const SECONDS = Number(arg('seconds', '60'));
const MSGS_PER_MIN = Math.min(Number(arg('msgs-per-min', '6')), 25); // the server allows 30 a minute per person
const MODE = arg('mode', 'optimised') as 'optimised' | 'legacy';
const MANIFEST = arg('manifest', 'load-manifest.json');

const host = new URL(BASE).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host) && !process.argv.includes('--allow-remote')) {
  console.error(`Refusing ${BASE}: a load test against another computer needs --allow-remote, and must never be the live site.`);
  process.exit(1);
}

type Manifest = { password: string; groups: { conversationId: string; members: { email: string; userId: string }[] }[] };
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;

// ------------------------------------------------------------------ measuring
const timings = new Map<string, number[]>(); // label -> milliseconds
const statuses = new Map<string, Map<number, number>>(); // label -> status -> count
const note = (label: string, ms: number, status: number) => {
  (timings.get(label) ?? timings.set(label, []).get(label)!).push(ms);
  const s = statuses.get(label) ?? statuses.set(label, new Map()).get(label)!;
  s.set(status, (s.get(status) ?? 0) + 1);
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function call(label: string, method: string, path: string, token?: string, body?: unknown) {
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-device-id': 'load-test' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    note(label, performance.now() - t0, res.status);
    return { status: res.status, body: text ? (JSON.parse(text) as any) : null };
  } catch {
    note(label, performance.now() - t0, 0); // 0 = the connection itself failed
    return { status: 0, body: null };
  }
}

// ------------------------------------------------------------------ virtual phones
type Phone = { email: string; userId: string; conversationId: string; token: string; ws?: WebSocket; ready: boolean };
let sent = 0;
let sendFailed = 0;
let delivered = 0; // live events that reached another member
let expected = 0; // how many of those there should have been
let wsDrops = 0;
const deliveryMs: number[] = [];
const perGroupSize = new Map<string, number>();

const pool = async <T>(items: T[], n: number, fn: (x: T) => Promise<void>) => {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
};

function connect(p: Phone) {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/v1/live');
    p.ws = ws;
    const giveUp = setTimeout(() => resolve(), 15_000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: p.token })));
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      if (e.type === 'ready') {
        p.ready = true;
        ws.send(JSON.stringify({ type: 'presence', visible: true }));
        if (MODE === 'optimised') ws.send(JSON.stringify({ type: 'chat', id: p.conversationId })); // the chat is open in front, as the app now tells the server
        clearTimeout(giveUp);
        resolve();
        return;
      }
      if (e.type !== 'message' || e.conversationId !== p.conversationId) return;
      const m = /^LT\|(\d+(?:\.\d+)?)\|(\S+)\|/.exec(e.message.body);
      if (!m || e.message.sender.id === p.userId) return;
      delivered++;
      deliveryMs.push(Date.now() - Number(m[1]));
      // what the app does with the message
      if (MODE === 'legacy') void call('GET messages (legacy refetch)', 'GET', `/v1/conversations/${p.conversationId}/messages?read=1`, p.token);
      // optimised: the message goes on screen as it is; the server knows the chat is open, so there is no alert to read
    });
    ws.on('close', () => { if (running) wsDrops++; p.ready = false; });
    ws.on('error', () => { /* counted on close */ });
  });
}

let running = false;
async function behave(p: Phone, until: number) {
  const gap = 60_000 / MSGS_PER_MIN;
  const members = perGroupSize.get(p.conversationId) ?? 1;
  // a wait never runs past the end of the test; what is due after the end is simply not done
  const later = (ms: number, fn: () => Promise<void>) =>
    new Promise<void>((r) => setTimeout(() => (Date.now() < until ? void fn().finally(r) : r()), Math.min(ms, Math.max(0, until - Date.now()))));
  // one loop sends messages at a random pace; two background polls do what the app does while a screen is open
  const chat = (async () => {
    await later(Math.random() * gap, async () => undefined);
    while (Date.now() < until) {
      const t = Date.now();
      const r = await call('POST message', 'POST', `/v1/conversations/${p.conversationId}/messages`, p.token, { body: `LT|${t}|${p.userId.slice(-6)}| hello from the load test ${sent}` });
      if (r.status === 201) { sent++; expected += members - 1; } else sendFailed++;
      await later(gap * (0.5 + Math.random()), async () => undefined);
    }
  })();
  const polls = (async () => {
    while (Date.now() < until) {
      await later(30_000 + Math.random() * 30_000, async () => {
        await call('GET feed', 'GET', '/v1/activities?lat=45.4642&lng=9.19&limit=20', p.token);
        await call('GET notifications', 'GET', '/v1/notifications?limit=20', p.token);
      });
    }
  })();
  await Promise.all([chat, polls]);
}

// ------------------------------------------------------------------ run
async function main() {
  const everyone = manifest.groups.flatMap((g) => g.members.map((m) => ({ ...m, conversationId: g.conversationId })));
  for (const g of manifest.groups) perGroupSize.set(g.conversationId, g.members.length);
  // only whole groups, so a message always has its members online to receive it
  const wholeGroups = manifest.groups.slice(0, Math.max(1, Math.floor(USERS / (manifest.groups[0]?.members.length ?? 10))));
  const chosen = new Set(wholeGroups.map((g) => g.conversationId));
  const phones: Phone[] = everyone.filter((u) => chosen.has(u.conversationId)).map((u) => ({ ...u, token: '', ready: false }));
  console.log(`Load test: ${phones.length} phones in ${wholeGroups.length} groups, ${SECONDS}s, ${MSGS_PER_MIN} messages/min each, mode ${MODE}, ${BASE}`);

  console.log('1/3 signing in ...');
  const t0 = Date.now();
  await pool(phones, 20, async (p) => {
    const r = await call('POST login', 'POST', '/v1/auth/login', undefined, { email: p.email, password: manifest.password });
    p.token = r.body?.token ?? r.body?.accessToken ?? '';
  });
  const signedIn = phones.filter((p) => p.token);
  console.log(`    ${signedIn.length}/${phones.length} signed in in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!signedIn.length) { console.error('Nobody could sign in. Is the API running on the seeded database?'); process.exit(1); }

  console.log('2/3 opening live connections ...');
  await pool(signedIn, 50, connect);
  console.log(`    ${signedIn.filter((p) => p.ready).length}/${signedIn.length} connected`);

  console.log(`3/3 chatting for ${SECONDS}s ...`);
  running = true;
  const start = Date.now();
  const until = start + SECONDS * 1000;
  const tick = setInterval(() => process.stdout.write(`\r    ${Math.round((Date.now() - start) / 1000)}s  sent ${sent}  delivered ${delivered}/${expected}  failed ${sendFailed}   `), 1000);
  await Promise.all(signedIn.filter((p) => p.ready).map((p) => behave(p, until)));
  await new Promise((r) => setTimeout(r, 3000)); // let the last messages and reads arrive
  running = false;
  clearInterval(tick);
  const elapsed = (Date.now() - start) / 1000;
  signedIn.forEach((p) => p.ws?.close());

  // ---- report
  const rows = [...timings.entries()].map(([label, xs]) => ({
    request: label, count: xs.length, 'per second': +(xs.length / elapsed).toFixed(1), 'p50 ms': Math.round(pct(xs, 50)), 'p95 ms': Math.round(pct(xs, 95)), 'p99 ms': Math.round(pct(xs, 99)),
    statuses: [...(statuses.get(label) ?? [])].map(([s, n]) => `${s}x${n}`).join(' '),
  }));
  console.log('\n');
  console.table(rows);
  const lost = Math.max(0, expected - delivered);
  const summary = {
    mode: MODE, phones: signedIn.length, seconds: Math.round(elapsed), messagesSent: sent, sendFailed,
    liveDelivered: delivered, liveExpected: expected, lost, lostPercent: expected ? +((lost / expected) * 100).toFixed(2) : 0,
    deliveryP50ms: Math.round(pct(deliveryMs, 50)), deliveryP95ms: Math.round(pct(deliveryMs, 95)), deliveryP99ms: Math.round(pct(deliveryMs, 99)),
    connectionDrops: wsDrops, requestsPerSecond: +(rows.reduce((a, r) => a + r.count, 0) / elapsed).toFixed(1),
  };
  console.log('Live delivery (a message reaching the OTHER members over the live connection):');
  console.table([summary]);
  const bad = rows.filter((r) => /(^| )(429|5\d\d|0)x/.test(r.statuses));
  const verdict = summary.lostPercent > 1 || summary.deliveryP95ms > 2000 || summary.connectionDrops > signedIn.length * 0.02 ? 'NOT OK' : 'OK';
  console.log(`Verdict: ${verdict}  (OK = under 1% lost, 95% delivered within 2 s, under 2% of connections dropped).${bad.length ? ' Errors seen on: ' + bad.map((r) => r.request).join(', ') : ''}`);
  const file = `load-result-${MODE}-${phones.length}.json`;
  writeFileSync(file, JSON.stringify({ summary, rows, at: new Date().toISOString() }, null, 2));
  console.log(`Saved ${file}`);
  process.exit(0);
}

void main();
