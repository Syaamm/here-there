import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, useWindowDimensions, View } from 'react-native';
import { Text } from './ScaledText';
import type { Mode } from '@/lib/theme';

const LOOK = {
  here: { fill: '#102F29', ink: '#FFFFFF', icon: 'people' as const, word: 'HERE' },
  there: { fill: '#E9E5DD', ink: '#102F29', icon: 'airplane' as const, word: 'THERE' },
};

/**
 * Full-screen switch between HERE and THERE: the new product's colour sweeps up from the bottom like a wave until it
 * fills the screen, its icon appears in the centre, the app underneath swaps while it is fully covered, then the colour
 * melts away. The word is set in a classic serif and starts as just its first letter, like a monogram; the other letters
 * then slide out of it and the word opens to its full width, the way a logo reveals its name.
 * Only transforms and opacity animate, so it stays on the native thread.
 */
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: "Georgia, 'Times New Roman', serif" });
const LETTER = { fontFamily: SERIF, fontSize: 40, lineHeight: 48, fontWeight: '500' as const, letterSpacing: 3 };

export function ModeTransition({ target, onCovered, onDone }: { target: Mode; onCovered: () => void; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const look = LOOK[target];
  const chars = [...look.word];
  const grow = useRef(new Animated.Value(0)).current; // the colour wave
  const icon = useRef(new Animated.Value(0)).current; // icon + first letter
  const spread = useRef(new Animated.Value(0)).current; // 0 = only the first letter, 1 = the whole word
  const out = useRef(new Animated.Value(1)).current; // whole overlay
  const [grown, setGrown] = useState(false);
  const [widths, setWidths] = useState<number[]>([]); // each letter's width, measured before it is shown
  const ready = widths.filter(Boolean).length === chars.length;

  // a circle centred on the bottom edge, big enough to cover the screen once fully grown
  const D = Math.ceil(Math.hypot(width, height) * 2.1);

  useEffect(() => {
    Animated.timing(grow, { toValue: 1, duration: 750, easing: Easing.bezier(0.5, 0, 0.2, 1), useNativeDriver: true }).start(({ finished }) => finished && setGrown(true));
  }, []);

  useEffect(() => {
    if (!grown || !ready) return;
    let live = true;
    Animated.sequence([
      Animated.timing(icon, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(spread, { toValue: 1, duration: 650, easing: Easing.bezier(0.65, 0, 0.25, 1), useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (!live || !finished) return;
      onCovered(); // swap the product underneath while nothing of it is visible
      setTimeout(() => {
        if (!live) return;
        Animated.timing(out, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => live && onDone());
      }, 450);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grown, ready]);

  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  const lift = icon.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const planeX = icon.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] });

  // where each letter ends up, so the others can start stacked on the first one and the row can start centred on it
  const total = widths.reduce((a, b) => a + (b || 0), 0);
  const centres = widths.map((w, i) => widths.slice(0, i).reduce((a, b) => a + (b || 0), 0) + (w || 0) / 2);
  const rowShift = ready ? total / 2 - widths[0] / 2 : 0;

  return (
    <Animated.View pointerEvents="auto" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: out, overflow: 'hidden' }}>
      <Animated.View style={{ position: 'absolute', left: width / 2 - D / 2, top: height - D / 2, width: D, height: D, borderRadius: D / 2, backgroundColor: look.fill, transform: [{ scale }] }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={{ opacity: icon, transform: [{ translateY: lift }, { translateX: target === 'there' ? planeX : 0 }, { rotate: target === 'there' ? '-45deg' : '0deg' }] }}>
          <Ionicons name={look.icon} size={64} color={look.ink} />
        </Animated.View>
        <Animated.View
          accessible
          accessibilityLabel={look.word}
          style={{ flexDirection: 'row', marginTop: 14, transform: [{ translateY: lift }, { translateX: spread.interpolate({ inputRange: [0, 1], outputRange: [rowShift, 0] }) }] }}
        >
          {chars.map((ch, i) => {
            const first = i === 0;
            return (
              <Animated.View
                key={i}
                onLayout={(e) => {
                  const w = e.nativeEvent.layout.width;
                  setWidths((cur) => (cur[i] === w ? cur : Object.assign([...cur], { [i]: w })));
                }}
                style={{
                  opacity: first ? icon : spread.interpolate({ inputRange: [0.15, 0.7], outputRange: [0, 1], extrapolate: 'clamp' }),
                  transform: [
                    { translateX: first || !ready ? 0 : spread.interpolate({ inputRange: [0, 1], outputRange: [centres[0] - centres[i], 0] }) },
                    { scale: first ? 1 : spread.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  ],
                }}
              >
                <Text allowFontScaling={false} style={{ color: look.ink, ...LETTER }}>{ch}</Text>
              </Animated.View>
            );
          })}
        </Animated.View>
      </View>
    </Animated.View>
  );
}
