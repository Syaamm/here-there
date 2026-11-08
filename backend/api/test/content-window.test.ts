import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('contentwindow' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

const day = 24 * 3600e3;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

describe('Content by when it happens', () => {
  it('lists a window from today earliest first, later windows separately, and what already happened latest first', async () => {
    const host = await h.verified('WindowHost');
    let slot = 0;
    const make = async (title: string) => {
      slot += 3; // three hours apart: one host cannot have two plans at once
      const r = await h.post('/v1/activities', host.token, h.activityBody({ title, venueName: title, startsAt: h.hours(slot), endsAt: h.hours(slot + 2) }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.id as string;
    };
    const soon = await make('Soon plan');
    const later = await make('Later plan');
    const nextMonth = await make('Next month plan');
    const past = await make('Past plan');
    // move them in time (the planning limit only applies when people create them)
    await h.prisma.activity.update({ where: { id: later }, data: { startsAt: new Date(Date.now() + 10 * day), endsAt: new Date(Date.now() + 10 * day + 7200e3) } });
    await h.prisma.activity.update({ where: { id: nextMonth }, data: { startsAt: new Date(Date.now() + 40 * day), endsAt: new Date(Date.now() + 40 * day + 7200e3) } });
    await h.prisma.activity.update({ where: { id: past }, data: { startsAt: new Date(Date.now() - 3 * day), endsAt: new Date(Date.now() - 3 * day + 7200e3) } });

    const first = (await h.get(`/v1/admin/activities?from=${iso(-60e3)}&to=${iso(30 * day)}`, h.adminToken)).body;
    const ids = first.items.map((a: { id: string }) => a.id);
    assert.deepEqual(ids.filter((id: string) => [soon, later, nextMonth, past].includes(id)), [soon, later], 'this month only, earliest first');
    const second = (await h.get(`/v1/admin/activities?from=${iso(30 * day)}&to=${iso(60 * day)}`, h.adminToken)).body;
    assert.ok(second.items.some((a: { id: string }) => a.id === nextMonth));
    const earlier = (await h.get(`/v1/admin/activities?to=${iso(0)}`, h.adminToken)).body;
    assert.ok(earlier.items.some((a: { id: string }) => a.id === past));
    assert.ok(!earlier.items.some((a: { id: string }) => a.id === soon));
  });

  it('gives the dashboard numbers for the chosen days', async () => {
    const day = (ms: number) => new Date(Date.now() + ms).toISOString().slice(0, 10);
    const seven = (await h.get(`/v1/admin/overview?from=${day(-6 * 864e5)}&to=${day(0)}`, h.adminToken)).body;
    assert.equal(seven.period.days.length, 7);
    assert.equal(seven.series.members.length, 7);
    assert.equal((await h.get('/v1/admin/overview', h.adminToken)).body.period.days.length, 30, 'the last 30 days by default');
    // the future is cut at today, and the range at a year
    assert.equal((await h.get(`/v1/admin/overview?from=${day(-2 * 864e5)}&to=${day(40 * 864e5)}`, h.adminToken)).body.period.to, day(0));
    assert.equal((await h.get(`/v1/admin/overview?from=2020-01-01&to=${day(0)}`, h.adminToken)).body.period.days.length, 366);
  });

  it('tells each viewer how far ahead plans can go where they look after', async () => {
    // the defaults: activities a month ahead, trips six
    assert.equal((await h.get('/v1/admin/activities', h.adminToken)).body.limitMonths, 1);
    assert.equal((await h.get('/v1/admin/trips', h.adminToken)).body.limitMonths, 6);
    // Milan allows activities three months ahead: its staff and the admin (the longest anywhere) see three
    const milanStaff = await h.staff('MilanContent', { permissions: ['content'] });
    assert.equal((await h.call('PATCH', `/v1/admin/regions/${milanStaff.regionKey}`, h.adminToken, { hereMonths: 3 })).status, 200);
    assert.equal((await h.get('/v1/admin/activities', milanStaff.token)).body.limitMonths, 3);
    assert.equal((await h.get('/v1/admin/activities', h.adminToken)).body.limitMonths, 3);
    // a Rome staff member still has the default
    const romeStaff = await h.staff('RomeContent', { city: 'Rome', permissions: ['content'] });
    assert.equal((await h.get('/v1/admin/activities', romeStaff.token)).body.limitMonths, 1);
  });

  it('lists the audit log from a chosen time', async () => {
    const old = await h.prisma.auditEvent.create({ data: { action: 'session.login', objectType: 'user', objectId: 'old-entry', createdAt: new Date(Date.now() - 40 * day) } });
    const fresh = await h.prisma.auditEvent.create({ data: { action: 'session.login', objectType: 'user', objectId: 'fresh-entry' } });
    const ids = async (q: string) => (await h.get(`/v1/admin/audit?limit=200${q}`, h.adminToken)).body.items.map((e: { id: string }) => e.id) as string[];
    const week = await ids(`&from=${iso(-7 * day)}`);
    assert.ok(week.includes(fresh.id) && !week.includes(old.id), 'the last 7 days only');
    const all = await ids('');
    assert.ok(all.includes(fresh.id) && all.includes(old.id), 'everything without from');
  });
});
