import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('waitingqueue' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

/** a report about a made-up person, by a made-up reporter */
async function report(category: string, targetId: string) {
  const by = await h.verified('Rep' + Math.random().toString(36).slice(2, 7));
  const r = await h.post('/v1/reports', by.token, { targetType: 'user', targetId, category, details: 'seen in a test' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}

describe('the waiting report queue: a page at a time, in queue order, with a small summary', () => {
  it('pages in queue order (urgent first) without losing or repeating a report, and the summary agrees', async () => {
    const staff = await h.staff('QueueStaff');
    const target = await h.verified('QueueTarget');
    // five ordinary reports, then an urgent one filed LAST: it must still come first
    const ordinary: string[] = [];
    for (let i = 0; i < 5; i++) ordinary.push(await report('harassment', target.id));
    const urgent = await report('physical_safety', target.id);

    const first = await h.get('/v1/admin/reports?status=waiting&limit=2', staff.token);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.items.length, 2);
    assert.ok(first.body.nextCursor, 'more pages follow');
    assert.equal(first.body.items[0].id, urgent, 'the urgent report is first even though it was filed last');

    // walk every page: each report once, none lost
    const seen: string[] = first.body.items.map((x: { id: string }) => x.id);
    let cursor: string | null = first.body.nextCursor;
    for (let i = 0; cursor && i < 10; i++) {
      const page = await h.get(`/v1/admin/reports?status=waiting&limit=2&cursor=${cursor}`, staff.token);
      assert.equal(page.status, 200, JSON.stringify(page.body));
      seen.push(...page.body.items.map((x: { id: string }) => x.id));
      cursor = page.body.nextCursor;
    }
    assert.equal(new Set(seen).size, seen.length, 'no report twice');
    for (const id of [urgent, ...ordinary]) assert.ok(seen.includes(id), 'no report lost');

    // the last report of a page is decided before the next page is asked for (its cursor now points at a report that is gone):
    // the next page still carries on exactly after it
    const again = await h.get('/v1/admin/reports?status=waiting&limit=2', staff.token);
    const gone = again.body.items[1].id as string;
    await h.post(`/v1/admin/reports/${gone}/resolve`, staff.token, { status: 'dismissed', resolution: 'Nothing found' });
    const next = await h.get(`/v1/admin/reports?status=waiting&limit=2&cursor=${again.body.nextCursor}`, staff.token);
    assert.equal(next.status, 200);
    assert.equal(next.body.items.length, 2);
    assert.ok(next.body.items.every((x: { id: string }) => x.id !== gone && x.id !== again.body.items[0].id), 'the decided report is gone and nothing repeats');

    assert.equal((await h.get('/v1/admin/reports?status=waiting&cursor=junk', staff.token)).status, 400);

    // the summary: a total, urgent and overdue, and the ids of the open ones
    const s = await h.get('/v1/admin/reports/waiting', staff.token);
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.total, seen.length - 1, 'one was decided meanwhile');
    assert.ok(s.body.urgent >= 1);
    assert.equal(s.body.openIds.length, s.body.open);
    assert.ok(s.body.openIds.includes(urgent));
  });
});
