/**
 * A tiny memory of the last two places the person was, so a page can tell HOW it came back into view. Coming back is not
 * the same as arriving: after a back swipe from a chat or an activity the page you return to must simply be there, with no
 * entrance animation and no reload flash. The animation is only for arriving: the app opening, or another dock tab.
 */
const MAIN = ['/', '/discover', '/create', '/inbox', '/profile'];
// screens that sit on top of the whole app (and leave the page under them untouched while they are open)
const OVERLAYS = ['/chat', '/verify', '/onboarding'];
let prev: string | null = null;
let current: string | null = null;

const isOverlay = (p: string) => OVERLAYS.some((o) => p === o || p.startsWith(o + '/'));

/** Called while rendering with the address; harmless to call again with the same one. */
export function trackPath(p: string) {
  if (p !== current) {
    prev = current;
    current = p;
  }
}

/** Should the page at `path` play its entrance animation now that it is in front? */
export function entersFresh(path: string, inner: boolean) {
  if (prev === null) return true; // the app has just opened
  if (isOverlay(prev) && !isOverlay(path)) return false; // coming back from a chat: it was only covered
  if (inner) return true; // a page opened from another page slides in
  return MAIN.includes(prev) && prev !== path; // a dock tab: only when you arrive from another dock tab
}
