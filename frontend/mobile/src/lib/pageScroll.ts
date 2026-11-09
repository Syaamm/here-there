import type { RefObject } from 'react';

type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };
type Page = { scrollTo: (y: number) => void; offset: () => number; measureTop: (cb: (y: number) => void) => void };
let page: Page | null = null;

/** The page in front tells where it can be scrolled (Screen does this while it is on screen). */
export const setScrollPage = (p: Page | null) => {
  page = p;
};

/** Scrolls the page in front so this field is near its top, where it cannot be missed. */
export function scrollToField(ref: RefObject<Measurable | null>) {
  const el = ref.current;
  const here = page;
  if (!el || !here) return;
  el.measureInWindow((_x, y) => here.measureTop((top) => here.scrollTo(Math.max(0, here.offset() + (y - top) - 28))));
}
