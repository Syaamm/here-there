import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_KEPT_PER_DAY, nextStep, summarise, weightOf, type Fact } from '../src/reliability/reliability';

const now = new Date('2026-10-26T12:00:00Z');
const daysAgo = (d: number) => new Date(+now - d * 864e5);
// a different day for each event, so the "two a day" cap does not get in the way
const kept = (n: number, startAgo = 5): Fact[] => Array.from({ length: n }, (_, i) => ({ kind: 'kept' as const, at: daysAgo(startAgo + i), label: `Plan ${i}` }));
const bad = (kind: Fact['kind'], d: number): Fact => ({ kind, at: daysAgo(d), label: 'x' });

describe('reliability level', () => {
  it('starts everyone as New, not low, and keeps them there until there is a little history', () => {
    assert.equal(summarise([], now).level, 'new');
    assert.equal(summarise(kept(2), now).level, 'new');
    // one slip early on does not label a newcomer
    assert.equal(summarise([...kept(1), bad('no_show', 3)], now).level, 'new');
    assert.equal(summarise([bad('no_show', 3)], now).level, 'new');
  });

  it('becomes Reliable after three kept plans, and Very reliable after ten with a clean record', () => {
    assert.equal(summarise(kept(3), now).level, 'reliable');
    assert.equal(summarise(kept(9), now).level, 'reliable');
    assert.equal(summarise(kept(10), now).level, 'very_reliable');
    // one confirmed no-show among ten keeps it from the top level, but is not "needs care"
    const s = summarise([...kept(10), bad('no_show', 20)], now);
    assert.equal(s.level, 'reliable');
    assert.equal(s.noShows, 1);
  });

  it('needs care only after repeated problems that outweigh the good, or upheld reports', () => {
    assert.equal(summarise([...kept(6), bad('no_show', 10), bad('no_show', 11)], now).level, 'needs_care');
    assert.equal(summarise([...kept(1), bad('no_show', 2), bad('late_cancel', 3)], now).level, 'needs_care');
    assert.equal(summarise([...kept(12), bad('upheld_report', 30), bad('upheld_report', 60)], now).level, 'needs_care');
    // one upheld report beside a long good record is not enough; beside a thin one it is
    assert.equal(summarise([...kept(12), bad('upheld_report', 30)], now).level, 'reliable');
    assert.equal(summarise([...kept(3), bad('upheld_report', 30)], now).level, 'needs_care');
    // problems that are outweighed by plenty of good do not tip it
    assert.equal(summarise([...kept(20), bad('no_show', 10), bad('late_cancel', 12)], now).level, 'reliable');
  });

  it('lets old events fade and drops them after two years, so a person can recover', () => {
    assert.ok(weightOf(daysAgo(0), now) > 0.99);
    assert.ok(Math.abs(weightOf(daysAgo(180), now) - 0.5) < 0.01);
    assert.equal(weightOf(daysAgo(731), now), 0);
    const old = [...kept(6), bad('no_show', 600), bad('no_show', 610)];
    const recent = [...kept(6), bad('no_show', 10), bad('no_show', 11)];
    assert.equal(summarise(recent, now).level, 'needs_care');
    assert.equal(summarise(old, now).level, 'reliable', 'two bad events from long ago no longer weigh enough');
    assert.equal(summarise([...kept(3), bad('no_show', 800), bad('no_show', 801)], now).noShows, 0, 'older than two years: gone');
  });

  it('counts at most two kept plans a day, so back-to-back fake meetups cannot farm a level', () => {
    const sameDay: Fact[] = Array.from({ length: 8 }, (_, i) => ({ kind: 'kept' as const, at: new Date(+daysAgo(4) + i * 60_000), label: `P${i}` }));
    assert.equal(summarise(sameDay, now).kept, MAX_KEPT_PER_DAY);
    assert.equal(summarise(sameDay, now).level, 'new');
  });

  it('tells the person plainly what would move them up', () => {
    assert.match(nextStep(summarise(kept(1), now)), /2 more plans/);
    assert.match(nextStep(summarise(kept(5), now)), /5 more kept plans/);
    assert.match(nextStep(summarise(kept(12), now)), /top level/);
    assert.match(nextStep(summarise([...kept(6), bad('no_show', 10), bad('no_show', 11)], now)), /Older problems count less/);
  });
});
