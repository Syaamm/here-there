import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, useWindowDimensions } from 'react-native';
import type { Mode } from '@/lib/theme';

const LOOK = {
  here: { fill: '#102F29', ink: '#FFFFFF', icon: 'people' as const, word: 'HERE' },
  there: { fill: '#FFFFFF', ink: '#143A30', icon: 'airplane' as const, word: 'THERE' },
};

/**
 * Full-screen switch between HERE and THERE: the new product's colour sweeps up from the bottom like a wave until it
 * fills the screen, its icon appears in the centre, the app underneath swaps while it is fully covered, then the colour
 * melts away. Only transforms and opacity animate, so it stays on the native thread.
 */
export function ModeTransition({ target, onCovered, onDone }: { target: Mode; onCovered: () => void; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const look = LOOK[target];
  const grow = useRef(new Animated.Value(0)).current; // the colour wave
  const icon = useRef(new Animated.Value(0)).current; // icon + word
  const out = useRef(new Animated.Value(1)).current; // whole overlay

  // a circle centred on the bottom edge, big enough to cover the screen once fully grown
  const D = Math.ceil(Math.hypot(width, height) * 2.1);

  useEffect(() => {
    let live = true;
    Animated.sequence([
      Animated.timing(grow, { toValue: 1, duration: 750, easing: Easing.bezier(0.5, 0, 0.2, 1), useNativeDriver: true }),
      Animated.timing(icon, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
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
  }, []);

  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  const lift = icon.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const planeX = icon.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] });

  return (
    <Animated.View pointerEvents="auto" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: out, overflow: 'hidden' }}>
      <Animated.View style={{ position: 'absolute', left: width / 2 - D / 2, top: height - D / 2, width: D, height: D, borderRadius: D / 2, backgroundColor: look.fill, transform: [{ scale }] }} />
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: icon, transform: [{ translateY: lift }] }}>
        <Animated.View style={{ transform: [{ translateX: target === 'there' ? planeX : 0 }, { rotate: target === 'there' ? '-45deg' : '0deg' }] }}>
          <Ionicons name={look.icon} size={64} color={look.ink} />
        </Animated.View>
        <Text style={{ marginTop: 14, color: look.ink, fontSize: 28, fontWeight: '800', letterSpacing: 4 }}>{look.word}</Text>
      </Animated.View>
    </Animated.View>
  );
}
