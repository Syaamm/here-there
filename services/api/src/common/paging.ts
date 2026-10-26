import { E } from './errors';

/**
 * Keyset ("cursor") paging for lists that are shown newest first. The cursor is the sort time and id of the last row sent,
 * so the next page is "everything after that row": it stays correct when rows are added or removed between requests,
 * and it costs the same on page 500 as on page 1 (unlike skipping rows).
 */
export const encodeKeyset = (at: Date, id: string) => Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

export function decodeKeyset(raw: string | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const [iso, ...rest] = Buffer.from(raw, 'base64url').toString().split('|');
  const id = rest.join('|');
  const at = new Date(iso);
  if (!id || isNaN(+at)) throw E.badRequest('INVALID_CURSOR', 'Invalid cursor');
  return { at, id };
}

/** `?limit=` as a number between 1 and `max`, or `fallback` when missing or not a number. */
export function pageLimit(raw: string | undefined, fallback: number, max = 100) {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/** Rows read with `limit + 1`: the extra one only says whether another page exists. */
export function sliceKeyset<T extends { id: string }>(rows: T[], limit: number, sortAt: (row: T) => Date) {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeKeyset(sortAt(last), last.id) : null };
}
