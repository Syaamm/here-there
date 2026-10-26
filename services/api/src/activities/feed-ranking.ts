import { crowd } from '../common/social';

const HOUR = 3600 * 1000;

/** What the feed knows about one activity and the person looking at it. */
export type RankInput = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  capacity: number;
  going: number;
  category: string;
  tags: string[];
  /** how many of the viewer's BUDDIES (they follow each other) are going or hosting */
  buddiesGoing: number;
  /** how many people the viewer follows, who do not follow back, are going or hosting */
  followingGoing: number;
  /** km from the viewer; undefined when the viewer shared no position */
  distanceKm?: number;
};

export type Taste = { interests: Set<string> };

/** Each signal is 0..1; the weights say how much it matters. Signals that do not apply are left out, not counted as 0. */
export const WEIGHTS = { soon: 0.25, buddies: 0.45, following: 0.15, spots: 0.12, interest: 0.1, distance: 0.1, fresh: 0.03 } as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreActivity(a: RankInput, taste: Taste, now: Date): number {
  const parts: [number, number][] = [];

  // soon: the closer the start, the better. Already started means it can no longer be joined, so it sits low.
  const hours = (+a.startsAt - +now) / HOUR;
  parts.push([WEIGHTS.soon, hours <= 0 ? 0.1 : Math.exp(-hours / 6)]);

  // the viewer's circle, in tiers: buddies count most, people they follow count less, everyone else (and people who only
  // follow the viewer) count for nothing here
  parts.push([WEIGHTS.buddies, crowd(a.buddiesGoing)]);
  parts.push([WEIGHTS.following, crowd(a.followingGoing)]);

  // spots: full activities can only be waited for; among open ones, a group that already has people feels alive
  const open = a.capacity - a.going;
  parts.push([WEIGHTS.spots, open <= 0 ? 0 : 0.6 + 0.4 * clamp01(a.going / a.capacity)]);

  // interest: the category or a tag matches something in the viewer's profile interests
  if (taste.interests.size > 0) {
    const hit = taste.interests.has(a.category) || a.tags.some((t) => taste.interests.has(t.toLowerCase()));
    parts.push([WEIGHTS.interest, hit ? 1 : 0]);
  }

  // distance: only when the viewer's position was sent
  if (a.distanceKm !== undefined) parts.push([WEIGHTS.distance, Math.exp(-a.distanceKm / 5)]);

  // fresh: just posted things get a short lift
  const age = (+now - +a.createdAt) / HOUR;
  parts.push([WEIGHTS.fresh, clamp01(1 - age / 6)]);

  let total = 0;
  let weight = 0;
  for (const [w, s] of parts) {
    total += w * s;
    weight += w;
  }
  return total / weight;
}

/** Best first; equal scores fall back to the id so the order never wobbles between requests. */
export const ranksBefore = (a: { score: number; id: string }, b: { score: number; id: string }) =>
  a.score !== b.score ? a.score > b.score : a.id < b.id;

/**
 * The k best items out of any number, best first, in O(n log k): a small heap holds the best k seen so far and its
 * root is the weakest of them, so each new item only has to beat the root.
 */
export function topK<T extends { score: number; id: string }>(items: Iterable<T>, k: number): T[] {
  const heap: T[] = []; // min-heap: heap[0] is the worst of the kept items
  const worse = (x: T, y: T) => ranksBefore(y, x); // x is worse than y
  const up = (i: number) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!worse(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const down = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && worse(heap[l], heap[m])) m = l;
      if (r < heap.length && worse(heap[r], heap[m])) m = r;
      if (m === i) return;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  };
  for (const it of items) {
    if (heap.length < k) {
      heap.push(it);
      up(heap.length - 1);
    } else if (ranksBefore(it, heap[0])) {
      heap[0] = it;
      down(0);
    }
  }
  return heap.sort((a, b) => (ranksBefore(a, b) ? -1 : 1));
}

/** A cursor remembers the moment the ranking was taken, so page 2 is scored on the same clock as page 1. */
export function encodeCursor(asOf: Date, score: number, id: string) {
  return Buffer.from(`${asOf.toISOString()}|${score}|${id}`).toString('base64url');
}

export function decodeCursor(raw: string): { asOf: Date; score: number; id: string } | null {
  const [iso, s, ...rest] = Buffer.from(raw, 'base64url').toString().split('|');
  const id = rest.join('|');
  const asOf = new Date(iso);
  const score = Number(s);
  if (!id || isNaN(+asOf) || !Number.isFinite(score)) return null;
  return { asOf, score, id };
}
