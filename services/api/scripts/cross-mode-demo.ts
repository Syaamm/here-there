/**
 * Local demo for HERE alerts arriving while you are in THERE.
 *
 *   npm run build && npm run demo:crossmode            (step 1: sets the scene)
 *   npm run demo:crossmode -- ping                     (step 2: sends the alert, with the app open in THERE)
 *
 * Your account (default verific@demo.local, or pass --email=you@example.com) hosts a HERE activity. Step 2 makes Nina ask
 * to join it THROUGH THE RUNNING API, the same way the app does, so the live connection and push work as in real life.
 * The API must be running (npm start) on API_URL (default http://localhost:3000).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { productOf } from '../src/notifications/notifications.service';

const prisma = new PrismaClient();
const API = process.env.API_URL ?? 'http://localhost:3000';
const PASSWORD = 'demo-password-1';
const TITLE = 'Cross-mode test: aperitivo';
const args = process.argv.slice(2);
const emailArg = args.find((a) => a.startsWith('--email='))?.slice(8) ?? 'verific@demo.local';
const step = args.find((a) => !a.startsWith('--')) ?? 'setup';

async function nina() {
  const email = 'crossmode-nina@demo.local';
  const found = await prisma.user.findUnique({ where: { email } });
  if (found) return found;
  return prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
      adultConfirmed: true,
      emailVerifiedAt: new Date(),
      adultVerifiedAt: new Date(),
      verifiedUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      eligibility: 'verified',
      profile: { create: { displayName: 'Nina', homeCity: 'Milan', languages: 'English,Italian', interests: 'coffee,drinks' } },
    },
  });
}

async function activityOf(hostId: string) {
  return prisma.activity.findFirst({ where: { hostId, title: TITLE, startsAt: { gt: new Date() }, status: { in: ['published', 'full'] } } });
}

async function api<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

/** Older alerts were saved before alerts knew their product: give them one, so the split inbox is right from the start. */
async function backfill() {
  const rows = await prisma.notification.findMany({ where: { product: null }, select: { id: true, type: true, data: true } });
  let n = 0;
  for (const r of rows) {
    let data: Record<string, unknown> | null = null;
    try {
      data = r.data ? JSON.parse(r.data) : null;
    } catch {
      /* leave it for both */
    }
    const product = productOf(r.type, data);
    if (!product) continue;
    await prisma.notification.update({ where: { id: r.id }, data: { product } });
    n++;
  }
  if (n) console.log(`(gave ${n} older alerts their product)`);
}

async function setup() {
  const me = await prisma.user.findUnique({ where: { email: emailArg } });
  if (!me) throw new Error(`No account ${emailArg}. Pass --email=<your account>.`);
  await backfill();
  await nina();
  let a = await activityOf(me.id);
  if (!a) {
    const startsAt = new Date(Date.now() + 3 * 3600 * 1000);
    startsAt.setMinutes(Math.ceil(startsAt.getMinutes() / 5) * 5, 0, 0);
    a = await prisma.activity.create({
      data: {
        hostId: me.id, title: TITLE, category: 'drinks', city: 'Milan', cityKey: 'milan', venueName: 'Bar near Duomo (Centro)', lat: 45.464, lng: 9.19,
        startsAt, endsAt: new Date(+startsAt + 2 * 3600 * 1000), capacity: 6, status: 'published',
        description: 'A HERE activity for testing alerts that arrive while you are in THERE.',
      },
    });
    await prisma.activityMembership.create({ data: { activityId: a.id, userId: me.id, role: 'host' } });
    await prisma.conversation.create({ data: { scopeType: 'activity', activityId: a.id } });
  }
  console.log(`
Ready. "${TITLE}" is a HERE activity hosted by ${emailArg} (starts ${a.startsAt.toLocaleString()}).

  1. Restart the API so it has the new code:  npm run build && npm start   (in services/api)
  2. In the app, sign in as ${emailArg} and switch to THERE (the ivory screen).
     Stay on any THERE screen, e.g. Explore.
  3. Run:  npm run demo:crossmode -- ping
  4. Within a second a banner drops from the top: "New join request ... Open in HERE".
  5. Tap it. The colour-wave plays, the app turns white and green (HERE), and the activity page opens.
     (Check: the Messages tab in THERE shows no HERE alert, but has the chip "1 new in HERE".)
  6. Run step 3 again any time to send another one (Nina's earlier request is withdrawn first).
`);
}

async function ping() {
  const me = await prisma.user.findUnique({ where: { email: emailArg } });
  if (!me) throw new Error(`No account ${emailArg}`);
  const a = await activityOf(me.id);
  if (!a) throw new Error('Run step 1 first (npm run demo:crossmode).');
  const n = await nina();
  const loginRes = await api<Record<string, unknown>>('POST', '/v1/auth/login', undefined, { email: n.email, password: PASSWORD });
  const token = String(loginRes.token ?? loginRes.accessToken ?? '');
  if (!token) throw new Error(`Login gave no token: ${Object.keys(loginRes).join(', ')}`);
  // a clean slate so it can be run again: Nina's earlier request is withdrawn first
  await api('DELETE', `/v1/activities/${a.id}/requests/mine`, token).catch(() => undefined);
  await api('POST', `/v1/activities/${a.id}/requests`, token, { intro: 'Hi! Could I join? I just moved to Milan.' });
  console.log('Sent: Nina asked to join. Look at the top of the app now.');
}

const run = step === 'ping' ? ping : setup;
run()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
