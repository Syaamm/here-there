import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('tzapi');
});
after(async () => {
  await h?.stop();
});

describe('time zones in the API', () => {
  it('a plan carries its venue\'s own zone, worked out from where it is, and moving the venue changes it', async () => {
    const host = await h.verified('ZoneHost');
    const milan = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Milan aperitivo' }));
    assert.equal(milan.status, 201, JSON.stringify(milan.body));
    assert.equal(milan.body.timeZone, 'Europe/Rome');
    const lisbon = await h.post('/v1/activities', host.token, h.activityBody({ title: 'Lisbon sunset', city: 'Lisbon', venueName: 'Miradouro', lat: 38.7139, lng: -9.1334, startsAt: h.hours(5), endsAt: h.hours(7) }));
    assert.equal(lisbon.status, 201, JSON.stringify(lisbon.body));
    assert.equal(lisbon.body.timeZone, 'Europe/Lisbon');
    const moved = await h.call('PATCH', `/v1/activities/${lisbon.body.id}`, host.token, { lat: 35.6762, lng: 139.6503 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.timeZone, 'Asia/Tokyo');
  });

  it('a trip accepts its destination\'s zone, refuses a made-up one, and shows it back', async () => {
    const org = await h.verified('ZoneOrg');
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
    const body = { title: 'Tokyo', destination: 'Tokyo, Japan', originCity: 'Milan', dateStart: day(40), dateEnd: day(48), dateFlexibility: 'plus_minus_3', budgetMin: 1200, budgetMax: 1800, budgetIncludesTransport: true, tags: ['culture'], groupSize: '2-3', visibility: 'public' };
    const bad = await h.post('/v1/trips', org.token, { ...body, timeZone: 'Mars/Olympus' });
    assert.equal(bad.status, 400);
    const ok = await h.post('/v1/trips', org.token, { ...body, timeZone: 'Asia/Tokyo' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.timeZone, 'Asia/Tokyo');
  });

  it('the plan\'s past-day lock follows the trip\'s zone: a day that is still "today" there stays open', async () => {
    const org = await h.verified('ZoneLock');
    const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString();
    const base = { title: 'Auckland', destination: 'Auckland, New Zealand', originCity: 'Milan', dateStart: day(40), dateEnd: day(48), dateFlexibility: 'plus_minus_3', budgetMin: 1200, budgetMax: 1800, budgetIncludesTransport: true, tags: ['culture'], groupSize: '2-3', visibility: 'public', timeZone: 'Pacific/Auckland' };
    const created = await h.post('/v1/trips', org.token, base);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    // the trip is under way: it started two days ago
    const made = await h.prisma.trip.update({ where: { id: created.body.id }, data: { dateStart: new Date(Date.now() - 2 * 864e5), dateEnd: new Date(Date.now() + 3 * 864e5) } });
    const { todayFor } = await import('../src/common/timezone');
    const today = todayFor('Pacific/Auckland');
    const earliest = todayFor(null);
    const ok = await h.post(`/v1/trips/${made.id}/plan/items`, org.token, { kind: 'itinerary', title: 'Harbour walk', day: new Date(`${today}T12:00:00Z`).toISOString() });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const yesterday = new Date(+new Date(`${today}T12:00:00Z`) - 864e5).toISOString();
    const late = await h.post(`/v1/trips/${made.id}/plan/items`, org.token, { kind: 'itinerary', title: 'Too late', day: yesterday });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'DAY_PASSED');
    assert.ok(today >= earliest, 'a zone ahead of UTC never locks a day that is still today for the people there');
  });
});
