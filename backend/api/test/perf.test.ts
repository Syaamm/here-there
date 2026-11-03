import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('perf');
});
after(async () => {
  await h?.stop();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('live feed nudges reach only phones showing the same city', () => {
  it('tells Milan phones about a Milan plan, and Rome phones about a Rome plan, nobody else', async () => {
    const { WebSocket } = await import('ws');
    const host = await h.verified('CityHost');
    const open = async (who: string, city?: string) => {
      const u = await h.verified(who);
      const events: string[] = [];
      const ws = new WebSocket(h.base.replace('http', 'ws') + '/v1/live');
      let ready = false;
      ws.on('message', (raw) => {
        const e = JSON.parse(raw.toString());
        if (e.type === 'ready') ready = true;
        else events.push(e.type);
      });
      await new Promise<void>((res) => ws.on('open', () => res()));
      ws.send(JSON.stringify({ type: 'auth', token: u.token }));
      for (let i = 0; i < 60 && !ready; i++) await sleep(50);
      assert.ok(ready);
      if (city) ws.send(JSON.stringify({ type: 'scope', city }));
      return { ws, events };
    };
    const milan = await open('MilanPhone', 'Milan');
    const rome = await open('RomePhone', ' rome ');
    const unscoped = await open('NoCityPhone');
    await sleep(200); // the scope messages have arrived

    assert.equal((await h.post('/v1/activities', host.token, h.activityBody({ city: 'Milan' }))).status, 201);
    await sleep(2400); // 0.4 s grouping + up to 1.5 s random delay
    assert.deepEqual(milan.events, ['feed-changed']);
    assert.deepEqual(rome.events, []);
    assert.deepEqual(unscoped.events, [], 'a phone that has not said which city it shows is left alone (it still has its slow refresh)');

    assert.equal((await h.post('/v1/activities', host.token, h.activityBody({ city: 'Rome', title: 'Rome aperitivo', startsAt: h.hours(8), endsAt: h.hours(10) }))).status, 201);
    await sleep(2400);
    assert.deepEqual(milan.events, ['feed-changed']);
    assert.deepEqual(rome.events, ['feed-changed']);

    // a trip is announced to its home city and its destination
    const day = 864e5;
    const trip = await h.post('/v1/trips', host.token, { title: 'Rome weekend', destination: 'Rome, Italy', originCity: 'Turin', dateStart: new Date(Date.now() + 40 * day).toISOString(), dateEnd: new Date(Date.now() + 44 * day).toISOString(), dateFlexibility: 'exact', budgetMin: 300, budgetMax: 500, budgetIncludesTransport: true, tags: ['food'], groupSize: '2-3' });
    assert.equal(trip.status, 201, JSON.stringify(trip.body));
    await sleep(2400);
    assert.deepEqual(milan.events, ['feed-changed'], 'Milan is neither where it starts nor where it goes');
    assert.deepEqual(rome.events, ['feed-changed', 'feed-changed']);

    for (const p of [milan, rome, unscoped]) p.ws.close();
  });
});

describe('the time-sorted list fills its pages even when most rows are filtered out', () => {
  it('pages through only the plans that still have room, with no empty page in the middle', async () => {
    const hostA = await h.verified('PagerHostA'); // a host may have 5 open plans, so two hosts
    const hostB = await h.verified('PagerHostB');
    const guest = await h.verified('PagerGuest');
    const ids: { id: string; full: boolean }[] = [];
    // four full plans first (the earliest ones), then three open ones
    for (let i = 0; i < 7; i++) {
      const full = i < 4;
      const host = full ? hostA : hostB;
      const id = (await h.post('/v1/activities', host.token, h.activityBody({ city: 'Naples', title: `Plan ${i}`, capacity: full ? 2 : 4, startsAt: h.hours(2 + 3 * i), endsAt: h.hours(4 + 3 * i) }))).body.id as string;
      if (full) {
        const r = await h.post(`/v1/activities/${id}/requests`, guest.token, {});
        await h.post(`/v1/activities/${id}/requests/${r.body.id}/decision`, host.token, { decision: 'approve' });
      }
      ids.push({ id, full });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: any = await h.get(`/v1/activities?city=Naples&hasSpots=true&limit=2&to=${encodeURIComponent(h.hours(40))}${cursor ? `&cursor=${cursor}` : ''}`, guest.token);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      if (r.body.nextCursor) assert.ok(r.body.items.length > 0, 'a page with a next page is never empty');
      seen.push(...r.body.items.map((x: { id: string }) => x.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    assert.deepEqual(seen, ids.filter((x) => !x.full).map((x) => x.id));
    assert.equal(pages, 2, 'three open plans at two a page');
  });
});

describe('admin lists continue past their first page', () => {
  it('walks users, activities and audit events a few at a time with no row repeated or missed', async () => {
    const admin = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token as string;
    const walk = async (path: string, limit: number) => {
      const ids: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const r: any = await h.get(`${path}${path.includes('?') ? '&' : '?'}limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`, admin);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        ids.push(...r.body.items.map((x: { id: string }) => x.id));
        cursor = r.body.nextCursor;
        pages++;
      } while (cursor && pages < 100);
      return ids;
    };
    for (const path of ['/v1/admin/users', '/v1/admin/activities', '/v1/admin/audit']) {
      const whole = await walk(path, 200);
      const small = await walk(path, 3);
      assert.ok(whole.length > 3, `${path} has more than one small page`);
      assert.equal(new Set(small).size, small.length, `${path}: no repeats`);
      assert.deepEqual(small, whole, `${path}: same rows, same order`);
    }
    // oldest-first queues too
    const ver = await walk('/v1/admin/verifications?status=verified', 2);
    assert.equal(new Set(ver).size, ver.length);
  });
});
