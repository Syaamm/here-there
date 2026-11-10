import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, useWindowDimensions, View } from 'react-native';
import type { Mode } from '@/lib/theme';

// the colour of the product being opened and the logo the app opens with: the light mark on HERE's deep green, the deep green mark on THERE's ivory
const LOOK: Record<Mode, { fill: string; logo: number; label: string }> = {
  here: { fill: '#102F29', logo: require('../../assets/splash-icon.png'), label: 'HERE' },
  there: { fill: '#E9E5DD', logo: require('../../assets/icons/there/splash-icon.png'), label: 'THERE' },
};

/**
 * The switch between HERE and THERE, kept short so it feels immediate (about a third of a second): the new product's colour
 * fades over the screen with its logo in the centre, the app underneath swaps while it is covered, then the colour and the logo
 * fade away and show the new product. Only opacity and scale animate, on the native thread.
 */
export function ModeTransition({ target, onCovered, onDone }: { target: Mode; onCovered: () => void; onDone: () => void }) {
  const { width } = useWindowDimensions();
  const look = LOOK[target];
  const size = Math.min(width * 0.8, 340); // the picture has empty margin around the mark, so it is drawn large
  const cover = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let live = true;
    Animated.timing(cover, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (!live || !finished) return;
      onCovered();
      // wait for the new product to be drawn under the cover (the swap re-renders the app), then let it show
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!live) return;
          Animated.timing(cover, { toValue: 0, duration: 220, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(() => live && onDone());
        }),
      );
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the logo settles from slightly smaller as the colour comes in
  const pop = cover.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  return (
    <Animated.View pointerEvents="auto" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: look.fill, opacity: cover }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View accessible accessibilityLabel={look.label} style={{ transform: [{ scale: pop }] }}>
          <Image source={look.logo} contentFit="contain" style={{ width: size, height: size }} />
        </Animated.View>
      </View>
    </Animated.View>
  );
}
