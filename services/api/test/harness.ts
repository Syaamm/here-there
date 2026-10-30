/**
 * Shared set-up for the small test files: its own database file per test file (so files run side by side, fast), the app
 * on a free port, an admin, and the helpers the tests use. Each test file calls `startHarness('name')` once.
 * (p0.test.ts is the original big file and keeps its own copy of this.)
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

type Res = { status: number; body: any };

export async function startHarness(name: string, opts: { queueWrites?: boolean } = {}) {
  const root = path.resolve(__dirname, '..', '..');
  const prismaDir = path.join(root, 'prisma');
  const dbFiles = [`test-${name}.db`, `test-${name}.db-journal`];
  process.env.NODE_ENV = 'test';
  // queueWrites: one database connection, so a burst of simultaneous requests waits in line instead of timing out on SQLite's single writer
  process.env.DATABASE_URL = `file:./test-${name}.db${opts.queueWrites ? '?connection_limit=1&socket_timeout=60' : ''}`;
  process.env.VERIFICATION_MODE = 'manual';
  process.env.REGISTER_LIMIT_PER_HOUR = '10000';
  process.env.BCRYPT_ROUNDS = '4';
  process.env.TRUST_PROXY = '1';
  process.env.ACCESS_TOKEN_MINUTES ??= '600'; // a slow test run must not outlive the real 15-minute sign-in (a test may set its own first)
  for (const f of dbFiles) rmSync(path.join(prismaDir, f), { force: true });
  execFileSync(process.execPath, [path.join(root, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], { cwd: root, env: { ...process.env }, stdio: 'ignore' });

  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { EmailService } = await import('../src/common/email.service');
  const bcrypt = await import('bcryptjs');
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const prisma = app.get(PrismaService) as any;
  const emailSvc = app.get(EmailService) as any;

  async function call(method: string, url: string, token?: string, body?: unknown): Promise<Res> {
    const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }
  const get = (u: string, t?: string) => call('GET', u, t);
  const post = (u: string, t?: string, b: unknown = {}) => call('POST', u, t, b);

  await prisma.user.create({
    data: { email: 'admin@example.com', passwordHash: await bcrypt.hash('admin-password-1', 4), role: 'admin', adultConfirmed: true, eligibility: 'verified', profile: { create: { displayName: 'Admin' } } },
  });
  const adminToken = (await post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token as string;

  let n = 0;
  /** A signed-up, email-confirmed, identity-verified adult. */
  async function verified(who: string) {
    const email = `${who}${++n}@example.com`.toLowerCase();
    const r = await post('/v1/auth/register', undefined, { email, password: 'a-long-password-1', displayName: who, homeCity: 'Milan', adultConfirmed: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const mail = [...emailSvc.outbox].reverse().find((m: any) => m.to === email);
    // sign-up step 2: the code from the email, with the ticket from step 1, confirms the address and signs in
    const c = await post('/v1/auth/register/confirm', undefined, { email, code: /(\d{6})/.exec(mail.text)![1], ticket: r.body.ticket });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const u = { token: c.body.token as string, id: c.body.user.id as string, email };
    assert.equal((await post('/v1/me/verification', u.token, { consent: true })).body.eligibility, 'pending');
    const check = (await get('/v1/admin/verifications?status=pending', adminToken)).body.items.find((c: any) => c.user.id === u.id);
    assert.equal((await post(`/v1/admin/verifications/${check.id}/decision`, adminToken, { decision: 'verified' })).status, 201);
    return u;
  }

  const hours = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();
  const activityBody = (over: Record<string, unknown> = {}) => ({ title: 'After-work aperitivo', category: 'drinks', city: 'Milan', venueName: 'Bar Brera', lat: 45.472, lng: 9.188, startsAt: hours(1), endsAt: hours(3), capacity: 3, ...over });

  return {
    get, post, call, base, hours, verified, activityBody, prisma, app, emailSvc,
    async stop() {
      await app.close();
      for (const f of dbFiles) rmSync(path.join(prismaDir, f), { force: true });
    },
  };
}
