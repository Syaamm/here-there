import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Image, Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAT_IMAGES } from '@/lib/constants';
import { useTheme } from '@/lib/theme';

/** White rounded-square button that floats on top of a hero image. */
export function FloatingButton({ icon, label, onPress, round, color = '#102F29', fx, size = 44 }: { /** width and height in px */ size?: number; icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress?: () => void; /** a circle instead of a rounded square */ round?: boolean; color?: string; /** pop: the icon swells and settles whenever it changes (a heart being filled); nudge: the icon slides back, then the action runs (a back arrow) */ fx?: 'pop' | 'nudge' }) {
  const press = useRef(new Animated.Value(0)).current; // the whole button, while a finger is on it
  const beat = useRef(new Animated.Value(0)).current; // the icon: 0 at rest, 1 at the peak of the pop / nudge
  const play = () =>
    Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: 80, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(beat, { toValue: 0, friction: 4, tension: 220, useNativeDriver: true }),
    ]).start();
  // quick timing, no spring wind-up: the button answers the instant a finger lands
  const spring = (to: number) => Animated.timing(press, { toValue: to, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  const iconMove =
    fx === 'nudge'
      ? { transform: [{ translateX: beat.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }] }
      : fx === 'pop'
        ? { transform: [{ scale: beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] }
        : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        if (fx) play(); // plays at once, on the tap itself; the action does not wait for it
        onPress?.();
      }}
      onPressIn={() => spring(1)}
      onPressOut={() => spring(0)}
    >
      <Animated.View
        style={[
          round
            ? // glass: see-through dark disc with a faint rim, white icon, so it reads on any photo
              { width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }
            : { width: size, height: size, borderRadius: size * 0.32, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
          { transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) }] },
        ]}
      >
        <Animated.View style={iconMove}>
          <Ionicons name={icon} size={Math.round(size * 0.5)} color={round && color === '#102F29' ? '#fff' : color} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * The picture area at the top of a detail screen: a coloured block (a stand-in until real photos exist) with a floating
 * back button, an optional action on the right (the ⋯ menu), and an optional emoji. Full-bleed on phones.
 */
export function Hero({ color, emoji, category, right, height = 220, rounded, plain, round }: { /** round (circle) floating buttons */ round?: boolean; color: string; /** the page has its own header bar above, so no floating back / menu buttons and no extra top space */ plain?: boolean; emoji?: string; /** show this category's photo instead of the plain block */ category?: string; right?: ReactNode; height?: number; rounded?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={{ height: height + (rounded || plain ? 0 : Math.max(insets.top, 20)), backgroundColor: color, borderRadius: rounded ? 24 : 0, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      {category && CAT_IMAGES[category] ? <Image source={CAT_IMAGES[category]} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} /> : null}
      {emoji && !(category && CAT_IMAGES[category]) ? (
        <Text style={{ fontSize: 72, opacity: 0.45 }} accessibilityElementsHidden>
          {emoji}
        </Text>
      ) : null}
      {round && category && CAT_IMAGES[category] ? (
        // a soft dark wash, darkest at the top where the buttons sit
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.28)']} locations={[0, 0.55, 1]} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      ) : null}
      {plain ? null : (
        <View style={{ position: 'absolute', left: 16, right: 16, top: rounded ? 16 : Math.max(insets.top, 20) + 12, flexDirection: 'row', justifyContent: 'space-between' }}>
          <FloatingButton round={round} fx="nudge" icon="chevron-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          {right}
        </View>
      )}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: c.line, opacity: rounded ? 0 : 1 }} />
    </View>
  );
}
