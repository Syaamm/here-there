import { Platform, useWindowDimensions } from 'react-native';

/**
 * Where a page may start below the status bar. An iPhone reports a tall safe area (the notch or Dynamic Island), and
 * starting right under all of it leaves a wide empty band, so pages start just inside it. Elsewhere: the full inset.
 */
export const statusTop = (inset: number) => (Platform.OS === 'ios' ? Math.max(inset - 6, 20) : Math.max(inset, 20));
/** Extra air between that and the first line of a header. */
export const headerGap = Platform.OS === 'ios' ? 6 : 14;

/**
 * Responsive breakpoints, same idea as a responsive website.
 *   compact   < 640   phones (and small browser windows)
 *   medium    640+    large phones in landscape, small tablets
 *   expanded  1000+   iPads and tablets in landscape, desktop browsers
 */
export const BREAKPOINTS = { medium: 640, expanded: 1000 } as const;

export function useLayout() {
  const { width, height } = useWindowDimensions();
  return {
    width,
    height,
    isTablet: width >= BREAKPOINTS.medium,
    /** wide enough for a side navigation rail and two-pane screens */
    isWide: width >= BREAKPOINTS.expanded,
    /** comfortable side padding for the content column */
    gutter: width >= BREAKPOINTS.medium ? 24 : 16,
  };
}
