process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = require('./test-db').testDatabaseUrl('overview'); // its own schema, so no other test's database is touched
process.env.VERIFICATION_MODE = 'manual';

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { dropTestDatabase, resetTestDatabase } from './test-db';

const root = path.resolve(__dirname, '..', '..');
let app: any;
let prisma: any;
let base = '';
let adminToken = '';
const DAY = 24 * 3600 * 1000;

before(async () => {
  await resetTestDatabase('overview');
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
  await dropTestDatabase('overview');
});

describe('admin overview', () => {
  it('reports real members, identity numbers, report counts and 30-day series', async () => {
    const r = await fetch(`${base}/v1/admin/overview`, { headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(r.status, 200);
    const o = await r.json();

    // members: the people the Users page lists (verified, plain, old); the admin, a guest and an erased account are left out
    assert.equal(o.members, 3);
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
    assert.equal(sum(o.series.members), 2, 'verified and plain joined in the period; the 40-day-old one did not');
    assert.equal(o.series.members[29], 2, 'both joined today');
    assert.equal(sum(o.series.reports), 3, 'the 45-day-old report is outside the period');
    assert.equal(o.previous.members, 1, 'the member from 40 days ago is in the previous period');

    assert.deepEqual(o.reportsByCategory, [{ category: 'harassment', count: 2 }, { category: 'spam', count: 1 }]);
  });

  it('is for staff only', async () => {
    assert.equal((await fetch(`${base}/v1/admin/overview`)).status, 401);
  });
});
