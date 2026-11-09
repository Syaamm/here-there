import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

process.env.TRIP_SEARCH_CACHE_MS = '60000'; // the cache is off in tests by default; these tests are about paging through it

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  h = await startHarness('search-report-paging');
});
after(async () => {
  await h?.stop();
});

describe('trip search pages are cut from one ranked list', () => {
  it('pages without a repeat or a gap, and leaves out a trip cancelled between pages', async () => {
    // one organizer per trip: the trips share days, and one person cannot be on two trips at once
    const orgs: { token: string }[] = [];
    const viewer = await h.verified('SearchViewer');
    const day = 864e5;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      orgs.push(await h.verified(`SearchOrg${i}`));
      const r = await h.post('/v1/trips', orgs[i].token, {
        title: `Paging trip ${i}`,
        destination: 'Pagingville, Norway',
        originCity: 'Milan',
        dateStart: new Date(Date.now() + (10 + i) * day).toISOString(),
        dateEnd: new Date(Date.now() + (14 + i) * day).toISOString(),
        dateFlexibility: 'exact',
        budgetMin: 500,
        budgetMax: 800,
        budgetIncludesTransport: true,
        tags: ['nature'],
        groupSize: '2-3',
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      ids.push(r.body.id);
    }
    const url = '/v1/trips?destination=pagingville&limit=2';
    const p1 = await h.get(url, viewer.token);
    assert.equal(p1.status, 200, JSON.stringify(p1.body));
    assert.equal(p1.body.items.length, 2);
    assert.equal(p1.body.total, 5);
    assert.ok(p1.body.nextCursor);

    // a trip that is not on the next page goes away: the list still holds together, and a new trip does not shift it
    const seen = new Set<string>(p1.body.items.map((x: { id: string }) => x.id));
    const rest = ids.filter((id) => !seen.has(id));
    const gone = rest[rest.length - 1];
    assert.equal((await h.post(`/v1/trips/${gone}/cancel`, orgs[ids.indexOf(gone)].token, {})).status, 201);

    let cursor = p1.body.nextCursor as string | null;
    while (cursor) {
      const p = await h.get(`${url}&cursor=${cursor}`, viewer.token);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      for (const x of p.body.items) {
        assert.ok(!seen.has(x.id), 'no trip comes twice');
        seen.add(x.id);
      }
      cursor = p.body.nextCursor;
    }
    assert.ok(!seen.has(gone), 'the cancelled trip is not shown');
    assert.equal(seen.size, 4);
  });
});

describe('finished reports come a page at a time', () => {
  it('sends a cursor, and the next page continues without a repeat', async () => {
    const admin = (await h.post('/v1/auth/login', undefined, { email: 'admin@example.com', password: 'admin-password-1' })).body.token as string;
    const reporter = await h.verified('ReportMaker');
    const base = Date.now() - 100 * 3600 * 1000;
    for (let i = 0; i < 5; i++) {
      await h.prisma.report.create({
        data: { reporterId: reporter.id, targetType: 'user', targetId: reporter.id, category: 'spam', status: 'resolved', resolution: 'done', createdAt: new Date(base + i * 60000), resolvedAt: new Date() },
      });
    }
    const first = await h.get('/v1/admin/reports?status=resolved&limit=2', admin);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.items.length, 2);
    assert.ok(first.body.nextCursor);
    const ids = new Set<string>(first.body.items.map((r: { id: string }) => r.id));
    let cursor = first.body.nextCursor as string | null;
    while (cursor) {
      const p = await h.get(`/v1/admin/reports?status=resolved&limit=2&cursor=${cursor}`, admin);
      assert.equal(p.status, 200, JSON.stringify(p.body));
      for (const r of p.body.items) {
        assert.ok(!ids.has(r.id), 'no report comes twice');
        ids.add(r.id);
      }
      cursor = p.body.nextCursor;
    }
    assert.equal(ids.size, 5);
    // the waiting queue is not paged: it comes whole, urgent first
    assert.equal((await h.get('/v1/admin/reports?status=open', admin)).body.nextCursor, null);
  });
});

describe('cards show the real people going', () => {
  it('sends the first three faces with each of your plans, the host first, then in the order they joined', async () => {
    const host = await h.verified('FacesHost');
    const id = (await h.post('/v1/activities', host.token, h.activityBody({ capacity: 5, joinPolicy: 'instant' }))).body.id;
    for (const who of ['FacesAna', 'FacesBea', 'FacesCleo']) {
      const p = await h.verified(who);
      assert.equal((await h.post(`/v1/activities/${id}/requests`, p.token, {})).body.state, 'approved');
    }
    const soon = await h.get('/v1/me/activities/soon?hours=48', host.token);
    assert.equal(soon.status, 200, JSON.stringify(soon.body));
    const card = soon.body.joined.find((x: { id: string }) => x.id === id);
    assert.equal(card.going, 4);
    assert.deepEqual(card.faces.map((f: { displayName: string }) => f.displayName), ['FacesHost', 'FacesAna', 'FacesBea'], 'three faces for four going: the host, then the first two to join');
    assert.ok(card.faces.every((f: { id: string; photoUrl: string | null }) => typeof f.id === 'string' && 'photoUrl' in f));
  });
});
