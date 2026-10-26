process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./overview-test.db'; // its own file, so no other test's database is touched
process.env.VERIFICATION_MODE = 'manual';

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const root = path.resolve(__dirname, '..', '..');
const dbFiles = ['overview-test.db', 'overview-test.db-journal'].map((f) => path.join(root, 'prisma', f));
let app: any;
let prisma: any;
let base = '';
let adminToken = '';
const DAY = 24 * 3600 * 1000;

before(async () => {
  for (const f of dbFiles) rmSync(f, { force: true });
  execFileSync(process.execPath, [path.join(root, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push', '--skip-generate'], { cwd: root, env: { ...process.env }, stdio: 'ignore' });
  const { createApp } = await import('../src/main');
  const { PrismaService } = await import('../src/common/prisma.service');
  const { JwtService } = await import('@nestjs/jwt');
  app = await createApp();
  await app.listen(0);
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  prisma = app.get(PrismaService);

  const user = (email: string, extra: Record<string, unknown> = {}) => prisma.user.create({ data: { email, passwordHash: '!', adultConfirmed: true, ...extra } });
  const admin = await user('admin@overview.test', { role: 'admin' });
  const verified = await user('verified@overview.test', { eligibility: 'verified' });
  await user('plain@overview.test');
  await user('guest@overview.test', { role: 'guest' }); // a demo guest is not a member
  await user('gone@overview.test', { state: 'deleted' }); // an erased account is not a member
  await user('old@overview.test', { createdAt: new Date(Date.now() - 40 * DAY) }); // in the 30 days before the period

  await prisma.report.createMany({
    data: [
      { reporterId: verified.id, targetType: 'user', targetId: 'x', category: 'harassment', status: 'open' },
      { reporterId: verified.id, targetType: 'user', targetId: 'y', category: 'harassment', status: 'in_review' },
      { reporterId: verified.id, targetType: 'trip', targetId: 'z', category: 'spam', status: 'resolved' },
      { reporterId: verified.id, targetType: 'trip', targetId: 'w', category: 'fraud', status: 'dismissed', createdAt: new Date(Date.now() - 45 * DAY) },
    ],
  });
  const check = (eligibility: string) => ({ userId: verified.id, providerRef: `ref-${eligibility}`, eligibility });
  await prisma.verificationCheck.createMany({ data: [check('verified'), check('rejected'), check('pending')] });

  adminToken = await app.get(JwtService).signAsync({ sub: admin.id, pv: 0 });
});
after(async () => {
  await app.close();
  for (const f of dbFiles) rmSync(f, { force: true });
});

describe('admin overview', () => {
  it('reports real members, identity numbers, report counts and 30-day series', async () => {
    const r = await fetch(`${base}/v1/admin/overview`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(r.status, 200);
    const o = await r.json();

    // members: admin, verified, plain, old (guest and erased account left out)
    assert.equal(o.members, 4);
    assert.equal(o.verifiedMembers, 1);
    assert.equal(o.approvalRate, 0.5, 'one passed and one rejected; the pending one is not counted');
    assert.equal(o.pendingVerifications, 1);

    assert.deepEqual(o.reports, { open: 1, in_review: 1, resolved: 1, dismissed: 1 });
    assert.equal(o.openReports, 2, 'the old counter still means open + in review');

    // the period is the last 30 whole days, today last
    assert.equal(o.period.days.length, 30);
    assert.equal(o.period.to, new Date().toISOString().slice(0, 10));
    for (const k of ['members', 'activities', 'trips', 'reports']) assert.equal(o.series[k].length, 30, k);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    assert.equal(sum(o.series.members), 3, 'admin, verified and plain joined in the period; the 40-day-old one did not');
    assert.equal(o.series.members[29], 3, 'all three joined today');
    assert.equal(sum(o.series.reports), 3, 'the 45-day-old report is outside the period');
    assert.equal(o.previous.members, 1, 'the member from 40 days ago is in the previous period');

    assert.deepEqual(o.reportsByCategory, [{ category: 'harassment', count: 2 }, { category: 'spam', count: 1 }]);
  });

  it('is for staff only', async () => {
    assert.equal((await fetch(`${base}/v1/admin/overview`)).status, 401);
  });
});
