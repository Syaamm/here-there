import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { tap } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';

import { sc, sp } from '@/lib/scale';
/**
 * Motion shared by the two four-step wizards (HERE "Host activity", THERE "Create a trip"): the step bars fill and drain,
 * the "Step n/4" label slides in, and a step's content slides in from the side it came from. Everything is opacity and
 * transform on the native driver (no layout animation, so Android stays smooth); none of it when reduced motion is on.
 */

let reduced = false;
AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduced = r)).catch(() => {});

const ease = Easing.out(Easing.cubic);

/**
 * The four bars. Each fill is a full-width bar scaled from its left edge: it grows when its step is reached and drains going back.
 * With `onPick` each bar also jumps to its step, where `canPick` allows it.
 */
export function StepBars({ step, count = 4, track, fill, onPick, canPick }: { step: number; count?: number; track: string; /** the filled part's colour (default forest; the wizards' dark band passes white) */ fill?: string; onPick?: (i: number) => void; canPick?: (i: number) => boolean }) {
  const { t } = useT();
  const { c } = useTheme();
  const fills = useRef(Array.from({ length: count }, (_, i) => new Animated.Value(i <= step ? 1 : 0))).current;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fills.forEach((v, i) => {
      const to = i <= step ? 1 : 0;
      if (reduced) v.setValue(to);
      else Animated.timing(v, { toValue: to, duration: 300, easing: ease, useNativeDriver: true }).start();
    });
  }, [step, fills]);

  const bar = (v: Animated.Value) => (
    <View style={{ height: sc(5), borderRadius: sc(65), backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={{ flex: 1, backgroundColor: fill ?? c.forest, transform: [{ scaleX: v }], transformOrigin: 'left center' }} />
    </View>
  );
  if (onPick)
    // each bar is a button to its step; a 5 px bar is too thin to hit, so the button is taller than it looks
    return (
      <View style={{ flexDirection: 'row', gap: sp(7), marginVertical: -sc(8) }}>
        {fills.map((v, i) => {
          const ok = i !== step && (canPick?.(i) ?? true);
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={t('Go to step {n}', { n: i + 1 })}
              accessibilityState={{ disabled: !ok, selected: i === step }}
              disabled={!ok}
              hitSlop={{ top: 8, bottom: 8 }}
              onPress={() => {
                tap('Medium');
                onPick(i);
              }}
              style={{ flex: 1, paddingVertical: sp(8) }}
            >
              {bar(v)}
            </Pressable>
          );
        })}
      </View>
    );
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('Step {n} of {total}', { n: step + 1, total: count })} accessibilityValue={{ min: 1, max: count, now: step + 1 }} style={{ flexDirection: 'row', gap: sp(7) }}>
      {fills.map((v, i) => (
        <View key={i} style={{ flex: 1 }}>{bar(v)}</View>
      ))}
    </View>
  );
}

/** "Step n/4": the new number drifts in a few pixels and fades up when the step changes. */
export function StepLabel({ step, style }: { step: number; style?: StyleProp<TextStyle> }) {
  const { t } = useT();
  const v = useRef(new Animated.Value(1)).current;
  const prev = useRef(step);
  const dir = useRef(1);
  if (prev.current !== step) {
    dir.current = step > prev.current ? 1 : -1;
    prev.current = step;
    v.setValue(reduced ? 1 : 0);
  }
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: 260, easing: ease, useNativeDriver: true }).start();
  }, [step, v]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [6 * dir.current, 0] }) }] }}>
      <Text style={style}>{t('Step {n}/4', { n: step + 1 })}</Text>
    </Animated.View>
  );
}

/** Wraps a wizard's step content: when `step` changes the new content slides 24 px in from the right (forward) or left (back) while fading up. It is already in place and tappable from the first frame. */
/** Swiping between a wizard's steps: left for the next step, right for the one before. */
export type StepSwipe = { canNext: boolean; canBack: boolean; onNext: () => void; onBack: () => void };

export function StepTransition({ step, children, style, swipe }: { step: number; children: ReactNode; style?: StyleProp<ViewStyle>; swipe?: StepSwipe }) {
  const v = useRef(new Animated.Value(1)).current;
  const side = useRef(new Animated.Value(24)).current;
  const prev = useRef(step);
  const drag = useRef(new Animated.Value(0)).current; // how far the step is being swiped sideways
  const bySwipe = useRef(false); // the step is changing because of a swipe (not Continue, Back or the bars)
  // decided while rendering, so the very first frame of the new step is already at its start position (no flash of the final state)
  if (prev.current !== step) {
    const forward = step > prev.current;
    prev.current = step;
    if (bySwipe.current) {
      // after a swipe: ONE movement only. The new step takes the old one's place exactly where the finger left it (nothing is
      // reset, so nothing jumps) and then settles into place; the usual slide-in is not added on top of it
      side.setValue(0);
      v.setValue(1);
    } else {
      side.setValue(0); // steps never move sideways: they are simply there (only the page scrolls, up and down)
      v.setValue(reduced ? 1 : 0);
      drag.setValue(0);
    }
  }
  useEffect(() => {
    if (!bySwipe.current) return;
    bySwipe.current = false;
    Animated.spring(drag, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 300, mass: 0.7 }).start();
  }, [step, drag]);

  /*
   * The swipe: the step follows the finger sideways and fades a little. Let go far or fast enough and it slides away (one tick),
   * and the next step comes in from that side. A step that can't be left that way yet (not finished, or the first or last step)
   * only stretches a little, like a rubber band, and springs back with a buzz. Only a clearly sideways move counts, so scrolling,
   * typing, the time wheel, the map and sideways rows of chips work as before.
   */
  const { width } = useWindowDimensions();
  const latest = useRef({ swipe, width, step });
  latest.current = { swipe, width, step };
  // one swipe changes the step once: after it has, the rest of that finger's movement is ignored
  const switched = useRef(false);
  const go = (forward: boolean) => {
    const { swipe: s, step: from } = latest.current;
    if (!s || switched.current) return;
    switched.current = true;
    bySwipe.current = true;
    tap('Medium');
    (forward ? s.onNext : s.onBack)(); // the new step shows at once and glides the last bit in
    // if the step did not change after all, bring this one back
    setTimeout(() => {
      if (latest.current.step !== from) return;
      bySwipe.current = false;
      Animated.spring(drag, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 260 }).start();
    }, 120);
  };
  const settle = () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260, mass: 0.7 }).start();
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !!latest.current.swipe && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderGrant: () => {
        switched.current = false;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        if (switched.current) return;
        const { swipe: s, width: w } = latest.current;
        const forward = g.dx < 0;
        const allowed = forward ? s?.canNext : s?.canBack;
        if (!allowed) {
          // can't go that way: a short rubber-band pull only
          return; // can't go that way: nothing moves (a buzz when the finger lets go)
        }
        // a quarter of the way across: the next step comes in by itself, no need to let go (and no empty space opens up)
        if (Math.abs(g.dx) > w * 0.25) return go(forward);
        // the step itself does not follow the finger: it stays still until the step changes
      },
      onPanResponderRelease: (_, g) => {
        if (switched.current) return;
        const { swipe: s } = latest.current;
        const forward = g.dx < 0;
        const allowed = forward ? s?.canNext : s?.canBack;
        // a quick flick counts too, even if it was short
        if (allowed && Math.abs(g.vx) > 0.45 && Math.abs(g.dx) > 30) return go(forward);
        if (!allowed && Math.abs(g.dx) > 30) tap('Medium');
        settle();
      },
      onPanResponderTerminate: () => {
        if (!switched.current) settle();
      },
    }),
  ).current;
  // the step being dragged stays solid: only a touch lighter, never fading away to an empty screen
  const fade = drag.interpolate({ inputRange: [-width * 0.45, 0, width * 0.45], outputRange: [0.92, 1, 0.92], extrapolate: 'clamp' });
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: 110, easing: ease, useNativeDriver: true }).start(); // already 1 after a swipe: nothing moves
  }, [step, v]);
  return (
    <Animated.View {...pan.panHandlers} style={{ opacity: fade, transform: [{ translateX: drag }] }}>
      <Animated.View style={[style, { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }), transform: [{ translateX: Animated.multiply(Animated.subtract(1, v), side) }] }]}>{children}</Animated.View>
    </Animated.View>
  );
}

/**
 * A part of a form that comes and goes (the quick picks): it folds open and shut, fading as the space under it closes up,
 * instead of popping in and out. While closing it keeps showing what it last showed. `gap` is the parent column's gap, which
 * it takes back as it closes so nothing jumps when it is gone. (Height cannot run on the native driver; it is short and small.)
 */
export function Collapse({ open, gap = 16, children }: { open: boolean; gap?: number; children: ReactNode }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [height, setHeight] = useState(0);
  const [mounted, setMounted] = useState(open);
  const last = useRef(children);
  if (open) last.current = children;

  useEffect(() => {
    if (open) setMounted(true);
    if (reduced) {
      v.setValue(open ? 1 : 0);
      if (!open) setMounted(false);
      return;
    }
    Animated.timing(v, { toValue: open ? 1 : 0, duration: 240, easing: ease, useNativeDriver: false }).start(({ finished }) => finished && !open && setMounted(false));
  }, [open, v]);

  if (!mounted) return null;
  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={{
        overflow: 'hidden',
        opacity: v,
        height: height ? v.interpolate({ inputRange: [0, 1], outputRange: [0, height] }) : undefined,
        marginTop: v.interpolate({ inputRange: [0, 1], outputRange: [-gap, 0] }),
      }}
    >
      {/* measured at its own size, whatever room the fold leaves it */}
      <View onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={{ position: height ? 'absolute' : 'relative', left: 0, right: 0, top: 0 }}>
        {open ? children : last.current}
      </View>
    </Animated.View>
  );
}
