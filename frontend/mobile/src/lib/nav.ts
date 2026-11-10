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
// the trail of pages in the order they were opened (coming back to a page in it cuts the trail back to that page), so Back
// from a main page can tell which page you came from
let trail: string[] = [];

const isOverlay = (p: string) => OVERLAYS.some((o) => p === o || p.startsWith(o + '/'));

/** Called while rendering with the address; harmless to call again with the same one. */
export function trackPath(p: string) {
  if (p !== current) {
    prev = current;
    current = p;
    const at = trail.lastIndexOf(p);
    if (at >= 0) trail = trail.slice(0, at + 1); // came back to a page of the trail
    else trail = [...trail.slice(-40), p];
  }
}

/** Is this one of the five main pages (Home, Search or Map, Create, Inbox, Profile)? */
export const isMainPath = (p: string | null) => !!p && MAIN.includes(p);
/** The page in front right now. */
export const currentPath = () => current;

/**
 * Where Back goes from a main page (the rule of the app): to the main page you came from, when that is where you were; from
 * anywhere else (an inner page was in between, or the app opened on this page) to Home. Home itself is not handled here: Back on
 * Home asks to press again, and the second press closes the app.
 */
export function backFromMain(): string {
  const before = trail.length >= 2 ? trail[trail.length - 2] : null;
  return before && isMainPath(before) && before !== current ? before : '/';
}

/** Should the page at `path` play its entrance animation now that it is in front? */
export function entersFresh(path: string, inner: boolean) {
  if (prev === null) return true; // the app has just opened
  if (isOverlay(prev) && !isOverlay(path)) return false; // coming back from a chat: it was only covered
  if (inner) return true; // a page opened from another page slides in
  return MAIN.includes(prev) && prev !== path; // a dock tab: only when you arrive from another dock tab
}
