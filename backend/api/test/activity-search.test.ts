import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startHarness } from './harness';

let h: Awaited<ReturnType<typeof startHarness>>;
before(async () => {
  process.env.ACCESS_TOKEN_MINUTES = '600';
  h = await startHarness('actsearch' + (process.env.TEST_DB_TAG ?? ''));
});
after(async () => {
  await h?.stop();
});

let n = 0;
async function plan(title: string, category: string, venueName = 'Some venue') {
  const host = await h.verified(`SearchHost${++n}`);
  const r = await h.post('/v1/activities', host.token, h.activityBody({ title, category, venueName }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
}

describe('the map search words (q)', () => {
  it('finds by title, venue and category word, and leaves the rest out', async () => {
    const viewer = await h.verified('SearchViewer');
    await plan('Yoga at evening', 'sports');
    await plan('Morning espresso', 'coffee', 'Bar Roma');
    await plan('Pizza night', 'food', 'Yoga Studio Cafe');
    await plan('Gallery walk', 'culture');
    await plan('Happy hour on the Navigli', 'drinks');
    const find = async (q: string) => {
      const r = await h.get(`/v1/activities?city=Milan&to=${encodeURIComponent(h.hours(48))}&q=${encodeURIComponent(q)}`, viewer.token);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return (r.body.items as { title: string }[]).map((a) => a.title).sort();
    };
    assert.deepEqual(await find('yoga'), ['Pizza night', 'Yoga at evening']); // title, and the venue's name
    assert.deepEqual(await find('YOGA'), ['Pizza night', 'Yoga at evening']); // any capitals
    // the category's own name, and what means the same: a "cafe" venue is a coffee place too
    assert.deepEqual(await find('coffee'), ['Morning espresso', 'Pizza night']);
    assert.deepEqual(await find('roma'), ['Morning espresso']); // venue
    assert.deepEqual(await find('yoga sports'), ['Yoga at evening']); // every word has to match
    assert.deepEqual(await find('nothingmatches'), []);
    // words that mean the same, in either language, and a typo: "aperitivo" and "aprevito" find the happy hour
    assert.deepEqual(await find('aperitivo'), ['Happy hour on the Navigli']);
    assert.deepEqual(await find('aprevito'), ['Happy hour on the Navigli']);
    assert.deepEqual(await find('happy hour'), ['Happy hour on the Navigli']);
    assert.deepEqual(await find('aperitivo yoga'), []); // every word still has to match
    // without words, everything comes back as before
    const all = await h.get(`/v1/activities?city=Milan&to=${encodeURIComponent(h.hours(48))}`, viewer.token);
    assert.equal(all.body.items.length, 5);
  });
});
