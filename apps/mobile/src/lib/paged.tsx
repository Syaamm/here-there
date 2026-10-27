import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SkeletonRows } from '@/components/Skeleton';
import { useOnScrollEnd } from '@/components/ui';
import { get } from './api';
import { PAGE_STEP, screenBatch } from './batch';
import { cursorDeps, patchCache, useLoad } from './hooks';

/** How much of a list is drawn: a first batch, then a bigger one each time the reader nears the end (like a social feed). */
export const FIRST_BATCH = 6;
export const NEXT_BATCH = 5;
const LOAD_MS = 350; // how long the grey placeholder rows show before the next batch takes their place

/**
 * Draws only part of a list. 6 items at first (more if they do not fill the screen); each time the page is scrolled near
 * its end, grey placeholder rows show at the bottom for a moment and 5 more items replace them, until the whole list is
 * shown. A long list is never all drawn at once. The reset key starts again from 6 when the list is a different one
 * (another tab, another filter, another section).
 */
export function usePaged<T>(items: T[], resetKey = '', first = FIRST_BATCH, step = NEXT_BATCH) {
  const [count, setCount] = useState(first);
  const [loadingMore, setLoadingMore] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useIsFocused();

  useEffect(() => {
    setCount(first);
    setLoadingMore(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, [resetKey, first]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useOnScrollEnd(() => {
    if (!focused || timer.current || count >= items.length) return; // not on screen, already loading, or nothing left
    setLoadingMore(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCount((c) => c + step);
      setLoadingMore(false);
    }, LOAD_MS);
  });

  return { shown: items.slice(0, count), count, total: items.length, hasMore: count < items.length, loadingMore };
}

type CursorPage<T> = { items: T[]; nextCursor: string | null };
const MAX_REFETCH = 100; // the most rows one refresh asks for (the server's page limit)
/** A row's own id, whatever the list is of (an activity, a request, a person, a chat). */
const rowId = (x: unknown) => {
  const r = x as { id?: string; requestId?: string; applicationId?: string; userId?: string; conversationId?: string };
  return r.id ?? r.requestId ?? r.applicationId ?? r.userId ?? r.conversationId ?? '';
};
const pageUrl = (path: string, params: Record<string, string>, limit: number, cursor?: string | null) =>
  `${path}?${new URLSearchParams({ ...params, limit: String(limit), ...(cursor ? { cursor } : {}) })}`;

/**
 * A list read from the server a page at a time: enough rows to fill the window first (see screenBatch), then a normal page of
 * 20 each time the reader nears the end, with grey rows at the bottom meanwhile. The rows really are fetched then: the server
 * sends only the next page after the last row shown (a cursor), never the whole list.
 *
 * It keeps the last answer (so the page opens at once) and can poll. A refresh asks again for as many rows as are already
 * loaded, so what you scrolled past does not vanish and a new row at the top cannot make a row in the middle go missing.
 * Anything else the answer carries (counts, totals) is kept and refreshed with it.
 */
export function useCursorList<T, X extends object = object>(
  path: string,
  params: Record<string, string>,
  cacheKey: string,
  opts: { pollMs?: number; animate?: boolean; keep?: boolean; first?: number; step?: number; /** about how tall one row is, to size the first page to the window */ rowHeight?: number; idOf?: (x: T) => string; /** load nothing yet (a search that has not been asked) */ skip?: boolean } = {},
) {
  const { pollMs, animate, keep, first = screenBatch(opts.rowHeight), step = PAGE_STEP, skip, idOf = rowId } = opts;
  const key = cursorDeps(path, params)[0] + (skip ? '#skipped' : '');
  const latest = useRef<(CursorPage<T> & X) | null>(null);
  const list = useLoad(
    () => (skip ? Promise.resolve({ items: [], nextCursor: null } as unknown as CursorPage<T> & X) : get<CursorPage<T> & X>(pageUrl(path, params, Math.min(MAX_REFETCH, Math.max(first, latest.current?.items.length ?? 0))))),
    [key],
    pollMs,
    cacheKey,
    { animate, keep },
  );
  latest.current = list.data;
  const keyNow = useRef(key);
  keyNow.current = key;

  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);
  const focused = useIsFocused();
  useEffect(() => {
    busy.current = false; // a different list: any page still on its way belongs to the old one
    setLoadingMore(false);
  }, [key]);

  useOnScrollEnd(() => {
    const d = latest.current;
    if (skip || !focused || busy.current || !d?.nextCursor) return;
    busy.current = true;
    setLoadingMore(true);
    const asked = key;
    // the grey rows show for at least a moment, so a fast answer does not make the list jump
    Promise.all([get<CursorPage<T> & X>(pageUrl(path, params, step, d.nextCursor)), new Promise((r) => setTimeout(r, LOAD_MS))])
      .then(([more]) => {
        if (keyNow.current !== asked) return;
        patchCache<CursorPage<T> & X>(cacheKey, [key], (old) => {
          const have = new Set(old.items.map(idOf));
          return { ...old, ...more, items: [...old.items, ...more.items.filter((x) => !have.has(idOf(x)))] };
        });
      })
      .catch(() => {}) // the next time the end is reached it asks again
      .finally(() => {
        if (keyNow.current !== asked) return;
        busy.current = false;
        setLoadingMore(false);
      });
  });

  return {
    data: list.data,
    items: list.data?.items ?? [],
    hasMore: !!list.data?.nextCursor,
    loadingMore,
    loading: list.loading,
    error: list.error,
    reload: list.reload,
  };
}

/** The grey placeholder rows at the end of a list that still has more to show. */
export function PagedTail({ paged, rows = 2 }: { paged: { hasMore: boolean }; rows?: number }) {
  return paged.hasMore ? <SkeletonRows count={rows} /> : null;
}

/** The same, as a piece of a page: draws the render function for the first items of a list, then more as the page is scrolled. */
export function Paged<T>({ items, render, resetKey = '' }: { items: T[]; render: (item: T, index: number) => ReactNode; resetKey?: string }) {
  const paged = usePaged(items, resetKey);
  return (
    <>
      {paged.shown.map((x, i) => render(x, i))}
      <PagedTail paged={paged} />
    </>
  );
}
