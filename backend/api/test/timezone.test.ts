import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isZone, localDay, localMinutes, nextDay, offsetMinutes, startOfLocalDay, todayFor, zoneFor } from '../src/common/timezone';

describe('time zones', () => {
  it('finds the zone of a place from its coordinates, and falls back when there are none', () => {
    assert.equal(zoneFor(45.47, 9.19), 'Europe/Rome');
    assert.equal(zoneFor(38.72, -9.14), 'Europe/Lisbon');
    assert.equal(zoneFor(35.68, 139.69), 'Asia/Tokyo');
    assert.equal(zoneFor(40.71, -74.0), 'America/New_York');
    assert.equal(zoneFor(undefined, undefined), 'Europe/Rome');
    assert.equal(zoneFor(Number.NaN, 5), 'Europe/Rome');
  });

  it('knows a real zone from nonsense', () => {
    assert.equal(isZone('Europe/Rome'), true);
    assert.equal(isZone('Mars/Olympus'), false);
    assert.equal(isZone(''), false);
    assert.equal(isZone(42), false);
  });

  it('works out the calendar day in the venue zone, not the server zone', () => {
    // 23:30 in Rome on 10 June is 21:30 UTC; in Tokyo it is already the 11th, in New York still the 10th
    const at = new Date('2026-06-10T21:30:00Z');
    assert.equal(localDay(at, 'Europe/Rome'), '2026-06-10');
    assert.equal(localDay(at, 'Asia/Tokyo'), '2026-06-11');
    assert.equal(localDay(at, 'America/New_York'), '2026-06-10');
    assert.equal(localMinutes(at, 'Europe/Rome'), 23 * 60 + 30);
    // 00:30 in Rome on the 11th is 22:30 UTC on the 10th
    assert.equal(localDay(new Date('2026-06-10T22:30:00Z'), 'Europe/Rome'), '2026-06-11');
  });

  it('spring forward: Rome loses an hour on 29 March 2026, so that day has 23 hours', () => {
    assert.equal(offsetMinutes(new Date('2026-03-28T12:00:00Z'), 'Europe/Rome'), 60);
    assert.equal(offsetMinutes(new Date('2026-03-30T12:00:00Z'), 'Europe/Rome'), 120);
    const start = startOfLocalDay('2026-03-29', 'Europe/Rome');
    const next = startOfLocalDay('2026-03-30', 'Europe/Rome');
    assert.equal(start.toISOString(), '2026-03-28T23:00:00.000Z', 'midnight in winter time');
    assert.equal(next.toISOString(), '2026-03-29T22:00:00.000Z', 'the next midnight is in summer time');
    assert.equal((+next - +start) / 3_600_000, 23);
  });

  it('fall back: Rome gains an hour on 25 October 2026, so that day has 25 hours', () => {
    const start = startOfLocalDay('2026-10-25', 'Europe/Rome');
    const next = startOfLocalDay('2026-10-26', 'Europe/Rome');
    assert.equal(start.toISOString(), '2026-10-24T22:00:00.000Z');
    assert.equal(next.toISOString(), '2026-10-25T23:00:00.000Z');
    assert.equal((+next - +start) / 3_600_000, 25);
    // 02:30 happens twice that night; both instants are on the 25th
    assert.equal(localDay(new Date('2026-10-25T00:30:00Z'), 'Europe/Rome'), '2026-10-25');
    assert.equal(localDay(new Date('2026-10-25T01:30:00Z'), 'Europe/Rome'), '2026-10-25');
    assert.equal(localDay(new Date('2026-10-25T23:30:00Z'), 'Europe/Rome'), '2026-10-26');
  });

  it('a zone that does not change its clocks, and one with a half-hour offset', () => {
    assert.equal(startOfLocalDay('2026-07-01', 'Asia/Tokyo').toISOString(), '2026-06-30T15:00:00.000Z');
    assert.equal(startOfLocalDay('2026-07-01', 'Asia/Kolkata').toISOString(), '2026-06-30T18:30:00.000Z');
    assert.equal(offsetMinutes(new Date('2026-07-01T00:00:00Z'), 'Asia/Kolkata'), 330);
  });

  it('southern hemisphere changes in the opposite season', () => {
    assert.equal(offsetMinutes(new Date('2026-01-15T00:00:00Z'), 'Australia/Sydney'), 660, 'summer time in January');
    assert.equal(offsetMinutes(new Date('2026-07-15T00:00:00Z'), 'Australia/Sydney'), 600);
  });

  it('"today" with a zone is that zone\'s today; without one it is the earliest day anywhere', () => {
    const now = new Date('2026-06-10T21:30:00Z');
    assert.equal(todayFor('Asia/Tokyo', now), '2026-06-11');
    assert.equal(todayFor('America/New_York', now), '2026-06-10');
    assert.equal(todayFor(null, now), '2026-06-10', 'UTC minus 12 hours: 09:30 on the 10th');
    assert.equal(todayFor('Mars/Olympus', now), '2026-06-10', 'an unknown zone is treated as no zone');
    assert.equal(nextDay('2026-12-31'), '2027-01-01');
    assert.equal(nextDay('2028-02-28'), '2028-02-29');
  });
});
