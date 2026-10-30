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

/** The rows that come after a cursor on a list shown newest first, by `field` (a time) and then id. Spread into `where`. */
export const beforeKeyset = (cur: { at: Date; id: string } | null, field = 'createdAt') =>
  cur ? { OR: [{ [field]: { lt: cur.at } }, { [field]: cur.at, id: { lt: cur.id } }] } : {};

/** The same for a list shown oldest first. */
export const afterKeyset = (cur: { at: Date; id: string } | null, field = 'createdAt') =>
  cur ? { OR: [{ [field]: { gt: cur.at } }, { [field]: cur.at, id: { gt: cur.id } }] } : {};

/**
 * A list that comes in groups, one group after the other (requests: waiting first, then the waiting list, then approved...),
 * oldest first inside each group. `read` fetches up to `take` rows of one group after a cursor. The cursor carries the group
 * number and the last row, so the next page continues exactly there, even in the middle of a group.
 */
export async function pageByGroup<T extends { id: string; createdAt: Date }>(
  groups: string[],
  limit: number,
  cursorRaw: string | undefined,
  read: (group: string, after: { at: Date; id: string } | null, take: number) => Promise<T[]>,
) {
  const cur = decodeKeyset(cursorRaw);
  let from = 0;
  let after: { at: Date; id: string } | null = null;
  if (cur) {
    const [rank, ...rest] = cur.id.split('|');
    from = Number(rank);
    if (!Number.isInteger(from) || from < 0 || from >= groups.length || !rest.length) throw E.badRequest('INVALID_CURSOR', 'Invalid cursor');
    after = { at: cur.at, id: rest.join('|') };
  }
  const out: { row: T; rank: number }[] = [];
  for (let r = from; r < groups.length && out.length < limit + 1; r++) {
    const rows = await read(groups[r], r === from ? after : null, limit + 1 - out.length);
    for (const row of rows) out.push({ row, rank: r });
  }
  const page = out.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page.map((p) => p.row), nextCursor: out.length > limit && last ? encodeKeyset(last.row.createdAt, `${last.rank}|${last.row.id}`) : null };
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

/**
 * One page of a list read straight from the database, newest first (or oldest first). This is the one way to page a list:
 * it reads the `?limit=` and `?cursor=`, narrows the query to the rows after the cursor, asks for one row more than the page
 * to learn whether another page exists, and hands back `{ items, nextCursor }`.
 *
 *   const page = await pageOf((a) => this.prisma.report.findMany({ ...a, include: { ... } }), { limit, cursor, where: { reporterId: me.id } });
 *   return { items: page.items.map(toDto), nextCursor: page.nextCursor };
 *
 * `sortBy` is the time column the list is ordered by (default createdAt); `idField` is the unique column that breaks ties
 * (default id); `order: 'asc'` is for lists shown oldest first. The caller's own `where` is kept apart from the cursor
 * condition, so a `where` with its own OR or AND is safe.
 */
export async function pageOf<T extends object>(
  read: (args: { where: any; orderBy: any; take: number }) => Promise<T[]>,
  o: { limit: number; cursor?: string; where?: object; sortBy?: string; idField?: string; order?: 'asc' | 'desc' },
): Promise<{ items: T[]; nextCursor: string | null }> {
  const sortBy = o.sortBy ?? 'createdAt';
  const idField = o.idField ?? 'id';
  const order = o.order ?? 'desc';
  const cur = decodeKeyset(o.cursor);
  const op = order === 'desc' ? 'lt' : 'gt';
  const after = cur ? { OR: [{ [sortBy]: { [op]: cur.at } }, { [sortBy]: cur.at, [idField]: { [op]: cur.id } }] } : {};
  const rows = await read({ where: { AND: [o.where ?? {}, after] }, orderBy: [{ [sortBy]: order }, { [idField]: order }], take: o.limit + 1 });
  const items = rows.slice(0, o.limit);
  const last = items[items.length - 1] as Record<string, any> | undefined;
  return { items, nextCursor: rows.length > o.limit && last ? encodeKeyset(last[sortBy] as Date, String(last[idField])) : null };
}
