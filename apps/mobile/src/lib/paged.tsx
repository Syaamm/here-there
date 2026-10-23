import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SkeletonRows } from '@/components/Skeleton';
import { useOnScrollEnd } from '@/components/ui';

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
