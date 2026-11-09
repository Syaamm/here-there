import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, useWindowDimensions, View } from 'react-native';
import type { Mode } from '@/lib/theme';

// the same logos the app shows when it opens: the light mark on HERE's deep green, the deep green mark on THERE's ivory
const LOOK = {
  here: { fill: '#102F29', logo: require('../../assets/splash-icon.png'), label: 'HERE' },
  there: { fill: '#E9E5DD', logo: require('../../assets/icons/there/splash-icon.png'), label: 'THERE' },
};

/**
 * Full-screen switch between HERE and THERE: the new product's colour sweeps up from the bottom like a wave until it
 * fills the screen, its logo (the one the app opens with) comes up in the centre, the app underneath swaps while it is
 * fully covered, then the colour melts away.
 * Only transforms and opacity animate, so it stays on the native thread.
 */
export function ModeTransition({ target, onCovered, onDone }: { target: Mode; onCovered: () => void; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const look = LOOK[target];
  const grow = useRef(new Animated.Value(0)).current; // the colour wave
  const logo = useRef(new Animated.Value(0)).current; // the logo coming up
  const out = useRef(new Animated.Value(1)).current; // whole overlay
  const [grown, setGrown] = useState(false);

  // a circle centred on the bottom edge, big enough to cover the screen once fully grown
  const D = Math.ceil(Math.hypot(width, height) * 2.1);
  const size = Math.min(width * 0.8, 340); // the picture has empty margin around the mark, so it is drawn large

  useEffect(() => {
    Animated.timing(grow, { toValue: 1, duration: 750, easing: Easing.bezier(0.5, 0, 0.2, 1), useNativeDriver: true }).start(({ finished }) => finished && setGrown(true));
  }, []);

  useEffect(() => {
    if (!grown) return;
    let live = true;
    Animated.timing(logo, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (!live || !finished) return;
      // the logo stays a moment, then the product underneath swaps while nothing of it is visible
      setTimeout(() => {
        if (!live) return;
        onCovered();
        setTimeout(() => {
          if (!live) return;
          Animated.timing(out, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => live && onDone());
        }, 450);
      }, 500);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grown]);

  const scale = grow.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  const lift = logo.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const pop = logo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  return (
    <Animated.View pointerEvents="auto" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: out, overflow: 'hidden' }}>
      <Animated.View style={{ position: 'absolute', left: width / 2 - D / 2, top: height - D / 2, width: D, height: D, borderRadius: D / 2, backgroundColor: look.fill, transform: [{ scale }] }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View accessible accessibilityLabel={look.label} style={{ opacity: logo, transform: [{ translateY: lift }, { scale: pop }] }}>
          <Image source={look.logo} contentFit="contain" style={{ width: size, height: size }} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}
