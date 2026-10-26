import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeCursor, encodeCursor, scoreActivity, topK, type RankInput } from '../src/activities/feed-ranking';

const now = new Date('2026-10-26T12:00:00Z');
const at = (h: number) => new Date(+now + h * 3600e3);
const base = (over: Partial<RankInput> = {}): RankInput => ({
  id: 'a', startsAt: at(2), endsAt: at(4), createdAt: at(-1), capacity: 4, going: 1, category: 'coffee', tags: [], buddiesGoing: 0, followingGoing: 0, ...over,
});
const none = { interests: new Set<string>() };

describe('feed scoring', () => {
  it('prefers sooner, friends, open places, matching interests and nearness', () => {
    const s = (o: Partial<RankInput>, taste = none) => scoreActivity(base(o), taste, now);
    assert.ok(s({ startsAt: at(1) }) > s({ startsAt: at(8) }));
    // the circle, in tiers: buddies count most, people you follow less, and nobody you know counts for nothing
    const nobody = s({});
    assert.ok(s({ buddiesGoing: 1 }) > s({ followingGoing: 1 }), 'a buddy beats someone you follow');
    assert.ok(s({ followingGoing: 1 }) > nobody, 'someone you follow beats a stranger');
    assert.ok(s({ buddiesGoing: 2 }) > s({ buddiesGoing: 1 }));
    assert.ok(s({ followingGoing: 2 }) > s({ followingGoing: 1 }));
    // a buddy going later beats a stranger's plan that starts sooner; someone you merely follow does not
    assert.ok(s({ buddiesGoing: 1, startsAt: at(10) }) > s({ startsAt: at(1) }));
    assert.ok(s({ followingGoing: 1, startsAt: at(10) }) < s({ startsAt: at(1) }));
    assert.ok(s({ going: 1 }) > s({ going: 4 }), 'full is worse than open');
    assert.ok(s({}, { interests: new Set(['coffee']) }) > s({}, { interests: new Set(['sports']) }));
    assert.ok(s({ distanceKm: 0.5 }) > s({ distanceKm: 15 }));
  });

  it('ranks something already started below something about to start, and stays within 0..1', () => {
    assert.ok(scoreActivity(base({ startsAt: at(-1) }), none, now) < scoreActivity(base({ startsAt: at(1) }), none, now));
    for (const o of [{}, { buddiesGoing: 9, followingGoing: 9, distanceKm: 0 }, { going: 4, startsAt: at(40) }]) {
      const v = scoreActivity(base(o), { interests: new Set(['coffee']) }, now);
      assert.ok(v >= 0 && v <= 1);
    }
  });
});

describe('topK', () => {
  it('returns the k best, best first, with ties broken by id', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `id${String(i).padStart(3, '0')}`, score: ((i * 37) % 50) / 50 }));
    const got = topK(items, 10);
    const want = [...items].sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1)).slice(0, 10);
    assert.deepEqual(got, want);
    assert.equal(topK(items, 500).length, 200);
    assert.deepEqual(topK([], 5), []);
  });
});

describe('cursor', () => {
  it('round-trips and rejects junk', () => {
    const c = decodeCursor(encodeCursor(now, 0.123456789012345, 'x|y'))!;
    assert.equal(+c.asOf, +now);
    assert.equal(c.score, 0.123456789012345);
    assert.equal(c.id, 'x|y');
    assert.equal(decodeCursor('not-a-cursor'), null);
  });
});
