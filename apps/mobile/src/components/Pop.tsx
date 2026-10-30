import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

// read once: when the person has asked their phone for less motion, nothing in here animates
let reduced = false;
AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduced = r)).catch(() => {});
export const reducedMotion = () => reduced;

/** A gentle spring with a hint of overshoot, shared by the calendar, the day strip and the day card. */
export const SOFT = { damping: 13, stiffness: 230, mass: 0.8 } as const;

/**
 * The "chosen" look of a button, laid over it: it pops in (grows from 70% with a small overshoot and fades up) when `on`
 * becomes true, and eases out when it turns false. Put the chosen colours and the chosen content in `children`; the plain
 * button underneath stays as it is. Opacity and transform only, so it runs on the native thread.
 */
export function Pop({ on, children, style, inset = 0 }: { on: boolean; children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const fade = useRef(new Animated.Value(on ? 1 : 0)).current;
  const grow = useRef(new Animated.Value(on ? 1 : 0.7)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced) {
      fade.setValue(on ? 1 : 0);
      grow.setValue(on ? 1 : 0.7);
      return;
    }
    if (on) {
      grow.setValue(0.7);
      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(grow, { toValue: 1, ...SOFT, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fade, { toValue: 0, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { top: -inset, left: -inset, right: -inset, bottom: -inset, alignItems: 'center', justifyContent: 'center', opacity: fade, transform: [{ scale: grow }] }, style]}
    >
      {children}
    </Animated.View>
  );
}

// Which rows of a list are on screen right now (reported by the list), so rows that wait for the reader can fade in as they arrive.
const inView = new Set<string>();
const watchers = new Set<() => void>();
// Rows that have already faded in. A recycling list unmounts rows that scroll far away and mounts them again on the way back; those are
// drawn as they were, not faded in a second time.
const shown = new Set<string>();
/** The list tells the rows which of them are on screen (call it from the list's onViewableItemsChanged). */
export function setInView(ids: string[]) {
  if (inView.size > 5000) inView.clear();
  for (const id of ids) inView.add(id);
  watchers.forEach((w) => w());
}

/**
 * One row of a list that fades in, with a small rise, when it appears. `animate` is false for the rows that were there when
 * the screen opened (so a whole page does not flicker on), true for the ones that come later. With `gate`, the fade waits until
 * the list reports the row in view (see setInView): earlier messages are loaded well before the reader gets to them, and would
 * otherwise have finished fading long before anyone saw them. If the row is never reported in view it shows after a while
 * anyway. `id` must be the row's own key. Opacity and transform only (native thread).
 */
export function Appear({ id, animate = true, gate = false, children, style }: { id: string; animate?: boolean; gate?: boolean; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const run = animate && !reduced && !shown.has(id);
  const v = useRef(new Animated.Value(run ? 0 : 1)).current;
  const started = useRef(!run);
  const play = (ms: number) => {
    started.current = true;
    if (shown.size > 5000) shown.clear();
    shown.add(id);
    watchers.delete(poke);
    Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };
  const check = useRef<() => void>(() => {});
  check.current = () => {
    if (started.current || (gate && !inView.has(id))) return;
    play(340);
  };
  const poke = useRef(() => check.current()).current;
  useEffect(() => {
    if (started.current) {
      shown.add(id);
      return;
    }
    watchers.add(poke);
    check.current();
    // never leave a row invisible: after a while it shows whether or not it was seen coming into view
    const t = setTimeout(() => {
      if (!started.current) play(200);
    }, 45000);
    return () => {
      watchers.delete(poke);
      clearTimeout(t);
    };
    // only when it first appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <Animated.View style={[{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }, style]}>{children}</Animated.View>;
}

/**
 * Content that arrives afresh whenever its `key` changes (give it the chosen day as a key): a quick fade, and a small
 * rise that springs into place. It starts on the first frame, so nothing flashes empty in between.
 */
export function Swap({ children, from = 14 }: { children: ReactNode; from?: number }) {
  const fade = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return;
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(rise, { toValue: 1, ...SOFT, useNativeDriver: true }),
    ]).start();
    // runs once per mount: a new key mounts a new one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={{ opacity: fade, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }, { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) }] }}>{children}</Animated.View>
  );
}
