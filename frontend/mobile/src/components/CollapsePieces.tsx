import type { ReactNode } from 'react';
import { Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useHeaderCollapse } from './ui';

/**
 * The pieces of a home page's header (HERE and THERE), as they go when the page is scrolled (Screen's `collapse`), in order:
 * the city and the tagline fade out first, then the logo and your photo shrink while the row settles into the small header.
 * Outside a collapsing header they are plain wrappers.
 */
const TAGLINE_ROOM = 22; // the tagline's line and the gap above it: the logo moves down by half of it, so it sits centred once the tagline is gone

/** the LAMIS logo: shrinks from its left edge, and moves down to the row's middle as the tagline under it fades */
export function CollapseLogo({ children }: { children: ReactNode }) {
  const k = useHeaderCollapse();
  if (!k) return <>{children}</>;
  return (
    <Animated.View style={{ transformOrigin: 'left center', transform: [{ translateY: k.p.interpolate({ inputRange: [0.1, 0.6], outputRange: [0, TAGLINE_ROOM / 2], extrapolate: 'clamp' }) }, { scale: k.p.interpolate({ inputRange: [0.3, 1], outputRange: [1, 0.8], extrapolate: 'clamp' }) }] }}>
      {children}
    </Animated.View>
  );
}

/** the tagline under the logo: fades out early */
export function CollapseTagline({ children }: { children: ReactNode }) {
  const k = useHeaderCollapse();
  if (!k) return <>{children}</>;
  return <Animated.View style={{ opacity: k.p.interpolate({ inputRange: [0.05, 0.45], outputRange: [1, 0], extrapolate: 'clamp' }) }}>{children}</Animated.View>;
}

/** the city: fades out first, lifting a little; once gone it takes no taps */
export function CollapseCity({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const k = useHeaderCollapse();
  if (!k) return <>{children}</>;
  return (
    <Animated.View
      pointerEvents={k.hidden ? 'none' : 'auto'}
      accessibilityElementsHidden={k.hidden}
      importantForAccessibility={k.hidden ? 'no-hide-descendants' : 'auto'}
      style={[style, { opacity: k.p.interpolate({ inputRange: [0, 0.35], outputRange: [1, 0], extrapolate: 'clamp' }), transform: [{ translateY: k.p.interpolate({ inputRange: [0, 0.35], outputRange: [0, -6], extrapolate: 'clamp' }) }, { scale: k.p.interpolate({ inputRange: [0, 0.35], outputRange: [1, 0.92], extrapolate: 'clamp' }) }] }]}
    >
      {children}
    </Animated.View>
  );
}

/** your photo: shrinks from its right edge, after the city has gone */
export function CollapseAvatar({ children }: { children: ReactNode }) {
  const k = useHeaderCollapse();
  if (!k) return <>{children}</>;
  return <Animated.View style={{ transformOrigin: 'right center', transform: [{ scale: k.p.interpolate({ inputRange: [0.3, 1], outputRange: [1, 0.8], extrapolate: 'clamp' }) }] }}>{children}</Animated.View>;
}
