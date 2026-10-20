import { useWindowDimensions } from 'react-native';

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
