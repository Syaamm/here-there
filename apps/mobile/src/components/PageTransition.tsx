import { useIsFocused, usePathname } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

const MAIN_TABS = ['/', '/discover', '/create', '/inbox', '/profile'];

/**
 * Every page eases in when it becomes the open one. A page inside HERE or THERE (an activity, a chat, someone's
 * profile) slides in a little from the right, like a push; the five main tabs rise and fade. Opacity and transform
 * only (native thread), about a fifth of a second, and none of it when the person asked for reduced motion.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const path = usePathname();
  // Decided while this page is the open one and then kept: a page that is leaving sees the address change under it,
  // and must not switch from "rise" to "slide" (or vanish) in the middle of its own exit.
  const inner = useRef(!MAIN_TABS.includes(path));
  if (focused) inner.current = !MAIN_TABS.includes(path);
  const v = useRef(new Animated.Value(0)).current;
  const reduce = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => (reduce.current = r))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!focused) return; // leaving: stay exactly as it is while the navigator fades it out
    if (reduce.current) {
      v.setValue(1);
      return;
    }
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [focused, v]);

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: v,
        transform: inner.current
          ? [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) }]
          : [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}
