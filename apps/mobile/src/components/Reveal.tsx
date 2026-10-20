import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Content eases in as it appears: a short fade and a small rise, staggered by position so a list unrolls instead of
 * popping in. Opacity and transform only (native thread). Skipped when the person has asked for reduced motion.
 */
export function Reveal({ index = 0, children, style, from = 12 }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle>; from?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (!live) return;
        if (reduce) v.setValue(1);
        else Animated.timing(v, { toValue: 1, duration: 340, delay: Math.min(index, 8) * 50, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      });
    return () => {
      live = false;
    };
    // runs once, when the item first appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }] }, style]}>{children}</Animated.View>;
}
