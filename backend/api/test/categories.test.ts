import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
let admin = '';
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  process.env.REGION_CACHE_MS = '0';
  process.env.CATEGORY_CACHE_MS = '0'; // a change by an admin shows at once in the tests
  h = await startHarness('categories' + (process.env.TEST_DB_TAG ?? ''), { queueWrites: true });
  admin = h.adminToken;
});
after(async () => {
  await h?.stop();
});

const patch = (id: string, body: unknown) => h.call('PATCH', `/v1/admin/categories/${id}`, admin, body);
const listAdmin = async (kind: string) => (await h.get(`/v1/admin/categories?kind=${kind}`, admin)).body.items as { id: string; key: string; label: string; active: boolean; uses: number }[];

describe('categories made by an admin', () => {
  it('starts with the categories the app always had', async () => {
    const r = await h.get('/v1/categories', admin);
    assert.deepEqual(r.body.here.map((c: { key: string }) => c.key), ['coffee', 'drinks', 'food', 'sports', 'culture']);
    assert.deepEqual(r.body.there.map((c: { key: string }) => c.key), ['adventure', 'nature', 'beach', 'photography']);
  });

  it('only an admin can make or change one', async () => {
    const u = await h.verified('Cat');
    assert.equal((await h.post('/v1/admin/categories', u.token, { kind: 'here', label: 'Board games' })).status, 403);
    assert.equal((await h.post('/v1/admin/categories', undefined, { kind: 'here', label: 'Board games' })).status, 401);
  });

  it('a new activity category can be chosen at once, and a made-up one cannot', async () => {
    const made = await h.post('/v1/admin/categories', admin, { kind: 'here', label: 'Board games', emoji: '🎲', color: '#112233' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.key, 'board-games');
    assert.equal((await h.post('/v1/admin/categories', admin, { kind: 'here', label: 'board GAMES' })).status, 409, 'the same name twice');
    assert.ok((await h.get('/v1/categories?kind=here', admin)).body.here.some((c: { key: string; emoji: string }) => c.key === 'board-games' && c.emoji === '🎲'));

    const host = await h.verified('Host');
    const ok = await h.post('/v1/activities', host.token, h.activityBody({ category: 'board-games', title: 'Catan night', venueName: 'Game cafe' }));
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.category, 'board-games');
    const no = await h.post('/v1/activities', host.token, h.activityBody({ category: 'made-up', title: 'Something else', venueName: 'Another place', startsAt: h.hours(30), endsAt: h.hours(32) }));
    assert.equal(no.status, 400);
    assert.equal(no.body.code, 'INVALID_CATEGORY');
    // it can be searched for and filtered by
    assert.equal((await h.get('/v1/activities?category=board-games&city=milan', host.token)).body.items.length, 1);
  });

  it('a category in use is turned off, not removed; one turned off cannot be chosen but old plans keep it', async () => {
    const used = (await listAdmin('here')).find((c) => c.key === 'board-games')!;
    assert.equal(used.uses, 1);
    assert.equal((await h.call('DELETE', `/v1/admin/categories/${used.id}`, admin)).body.code, 'CATEGORY_IN_USE');
    assert.equal((await patch(used.id, { active: false })).status, 200);
    assert.ok(!(await h.get('/v1/categories?kind=here', admin)).body.here.some((c: { key: string }) => c.key === 'board-games'));
    const host = await h.verified('Host2');
    assert.equal((await h.post('/v1/activities', host.token, h.activityBody({ category: 'board-games', title: 'Late game', venueName: 'Game cafe 2' }))).body.code, 'INVALID_CATEGORY');
    assert.equal((await h.get('/v1/activities?category=board-games&city=milan', host.token)).body.items.length, 1, 'the old plan is still found');
  });

  it('an unused one can be removed, and renamed and reordered', async () => {
    const made = await h.post('/v1/admin/categories', admin, { kind: 'there', label: 'City break' });
    assert.equal(made.status, 201);
    const id = (await listAdmin('there')).find((c) => c.key === 'city-break')!.id;
    // the admin screen renumbers every row when one moves, so the order is never a tie
    const rows = await listAdmin('there');
    const order = [id, ...rows.filter((c) => c.id !== id).map((c) => c.id)];
    for (const [position, c] of order.entries()) assert.equal((await patch(c, { position, ...(c === id && { label: 'City breaks' }) })).status, 200);
    const there = (await h.get('/v1/categories?kind=there', admin)).body.there;
    assert.equal(there[0].label, 'City breaks');
    assert.equal((await h.call('DELETE', `/v1/admin/categories/${id}`, admin)).status, 200);
    assert.ok(!(await listAdmin('there')).some((c) => c.key === 'city-break'));
  });

  it('keeps at least one category turned on', async () => {
    const all = await listAdmin('there');
    for (const c of all.slice(0, -1)) assert.equal((await patch(c.id, { active: false })).status, 200);
    assert.equal((await patch(all[all.length - 1].id, { active: false })).body.code, 'LAST_CATEGORY');
  });
});

describe('how far around a city (coverage)', () => {
  it('is 25 km unless a place says otherwise, and a city can have its own', async () => {
    assert.equal((await h.get('/v1/regions/limits?city=Milan', admin)).body.area.km, 25);
    const made = await h.post('/v1/admin/regions', admin, { name: 'Thrissur', kind: 'city', areaKm: 40 });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal((await h.get('/v1/regions/limits?city=Thrissur', admin)).body.area.km, 40);
    assert.equal((await h.get('/v1/regions/limits?city=Milan', admin)).body.area.km, 25, 'other cities are not touched');
    assert.equal((await h.call('PATCH', `/v1/admin/regions/${made.body.key}`, admin, { areaKm: 500 })).status, 400, 'at most 100 km');
    assert.equal((await h.call('PATCH', `/v1/admin/regions/${made.body.key}`, admin, { areaKm: null })).status, 200);
    assert.equal((await h.get('/v1/regions/limits?city=Thrissur', admin)).body.area.km, 25, 'empty follows the default again');
  });

  it('a new default for the whole service reaches every city without its own', async () => {
    const root = (await h.get('/v1/admin/regions', admin)).body.items.find((r: { kind: string }) => r.kind === 'global');
    assert.equal((await h.call('PATCH', `/v1/admin/regions/${root.key}`, admin, { areaKm: 15 })).status, 200);
    assert.equal((await h.get('/v1/regions/limits?city=Milan', admin)).body.area.km, 15);
    assert.equal((await h.get('/v1/regions/limits', admin)).body.area.km, 15);
  });
});
