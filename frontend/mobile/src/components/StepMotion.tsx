import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';

/**
 * Motion shared by the two four-step wizards (HERE "Host activity", THERE "Create a Trip"): the step bars fill and drain,
 * the "Step n/4" label slides in, and a step's content slides in from the side it came from. Everything is opacity and
 * transform on the native driver (no layout animation, so Android stays smooth); none of it when reduced motion is on.
 */

let reduced = false;
AccessibilityInfo.isReduceMotionEnabled().then((r) => (reduced = r)).catch(() => {});

const ease = Easing.out(Easing.cubic);

/** The four bars. Each fill is a full-width bar scaled from its left edge: it grows when its step is reached and drains going back. */
export function StepBars({ step, count = 4, track, fill }: { step: number; count?: number; track: string; /** the filled part's colour (default forest; the wizards' dark band passes white) */ fill?: string }) {
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

  return (
    <View accessibilityRole="progressbar" accessibilityLabel={t('Step {n} of {total}', { n: step + 1, total: count })} accessibilityValue={{ min: 1, max: count, now: step + 1 }} style={{ flexDirection: 'row', gap: 7 }}>
      {fills.map((v, i) => (
        <View key={i} style={{ flex: 1, height: 5, borderRadius: 65, backgroundColor: track, overflow: 'hidden' }}>
          <Animated.View style={{ flex: 1, backgroundColor: fill ?? c.forest, transform: [{ scaleX: v }], transformOrigin: 'left center' }} />
        </View>
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
export function StepTransition({ step, children, style }: { step: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(1)).current;
  const side = useRef(new Animated.Value(24)).current;
  const prev = useRef(step);
  // decided while rendering, so the very first frame of the new step is already at its start position (no flash of the final state)
  if (prev.current !== step) {
    side.setValue(step > prev.current ? 24 : -24);
    prev.current = step;
    v.setValue(reduced ? 1 : 0);
  }
  useEffect(() => {
    if (reduced) {
      v.setValue(1);
      return;
    }
    Animated.timing(v, { toValue: 1, duration: 250, easing: ease, useNativeDriver: true }).start();
  }, [step, v]);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateX: Animated.multiply(Animated.subtract(1, v), side) }] }]}>{children}</Animated.View>
  );
}
