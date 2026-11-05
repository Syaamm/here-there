import { useIsFocused, usePathname } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native';
import { entersFresh } from '@/lib/nav';

const MAIN_TABS = ['/', '/discover', '/create', '/inbox', '/profile'];

/**
 * The five dock tabs rise and fade in, but only when you ARRIVE at one from another (or the app opens): coming back to a
 * tab from a page that was opened on top of it shows it as it was, with no animation. Pages opened from other pages are
 * screens of their own, and the system slides them in and out (with the swipe back from the left edge), so they get
 * nothing from here. Opacity and transform only (native thread); none of it when reduced motion is on.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  const path = usePathname();
  // Decided while this page is the open one and then kept: a page that is leaving sees the address change under it.
  const inner = useRef(!MAIN_TABS.includes(path));
  if (focused) inner.current = !MAIN_TABS.includes(path);
  // starts fully visible unless it is about to play its entrance (so a page that is simply there never flashes blank)
  const v = useRef(new Animated.Value(!MAIN_TABS.includes(path) || !entersFresh(path, false) ? 1 : 0)).current;
  const reduce = useRef(false);
  const pathNow = useRef(path);
  pathNow.current = path;
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => (reduce.current = r))
      .catch(() => {});
  }, []);

  const covered = useRef(false); // a page that something else was opened over: coming back to it is a "back"
  useEffect(() => {
    if (!focused) {
      // Android shows no slide for pages opened on top (see the stack in app/_layout), so the page underneath is simply hidden.
      // While nothing of it is on screen it is already set to the start of its entrance, so on the way back the first frame
      // you see is the beginning of the animation (setting it at that moment instead showed one frame at full strength, then a dip: a flicker).
      if (Platform.OS === 'android') {
        covered.current = true;
        v.setValue(0);
      }
      return; // iPhone: leaving, stay exactly as it is (the system slide shows it)
    }
    const back = covered.current;
    covered.current = false;
    const arriving = !inner.current && entersFresh(pathNow.current, false);
    // reduced motion, or a page that is simply there: no entrance at all. iPhone also has none for inner pages or for coming back (the slide does it)
    if (reduce.current || (!arriving && !back)) {
      v.setValue(1);
      return;
    }
    if (!back) v.setValue(0);
    // Android fades a whole page's children one by one; caching the page as one layer while it moves keeps every frame cheap
    setMoving(true);
    Animated.timing(v, { toValue: 1, duration: back ? 220 : 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMoving(false);
    });
  }, [focused, v]);

  return (
    <Animated.View renderToHardwareTextureAndroid={moving} style={{ flex: 1, opacity: Platform.OS === 'android' ? v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) : v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}
