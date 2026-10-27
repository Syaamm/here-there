import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

// One shared pulse for every grey block on screen: a single native animation, started with the first block and stopped
// with the last, so a screenful of placeholders costs next to nothing.
const pulse = new Animated.Value(0);
let users = 0;
let loop: Animated.CompositeAnimation | null = null;
function usePulse() {
  useEffect(() => {
    if (users++ === 0) {
      loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }), Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true })]));
      loop.start();
    }
    return () => {
      if (--users === 0) {
        loop?.stop();
        loop = null;
      }
    };
  }, []);
  return pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
}

/** A grey block that breathes: stands in for text, a picture or a button while the real thing loads. */
export function Skeleton({ w = '100%', h = 14, r = 8, style }: { w?: DimensionValue; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const opacity = usePulse();
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no" style={[{ width: w, height: h, borderRadius: r, backgroundColor: c.accentSoft, opacity }, style]} />;
}

const Block = ({ children, gap = 12 }: { children: ReactNode; gap?: number }) => <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ gap }}>{children}</View>;

/** Rows like the ones in the lists: a picture and two lines. */
export function SkeletonRows({ count = 4 }: { count?: number }) {
  const { c } = useTheme();
  return (
    <Block>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }}>
          <Skeleton w={52} h={52} r={12} />
          <View style={{ flex: 1, gap: 7 }}>
            <Skeleton w="62%" h={13} />
            <Skeleton w="85%" h={11} />
            <Skeleton w="48%" h={10} />
          </View>
        </View>
      ))}
    </Block>
  );
}

/** A chat: bubbles on both sides. */
export function SkeletonChat({ compact = false }: { compact?: boolean }) {
  return (
    <Block gap={10}>
      <Skeleton w="62%" h={38} r={16} />
      <Skeleton w="48%" h={38} r={16} style={{ alignSelf: 'flex-end' }} />
      <Skeleton w="70%" h={56} r={16} />
      {compact ? null : <Skeleton w="40%" h={38} r={16} style={{ alignSelf: 'flex-end' }} />}
      {compact ? null : <Skeleton w="55%" h={38} r={16} />}
    </Block>
  );
}

/** A detail page: a title, a few facts, a block of text and a button. */
export function SkeletonDetail() {
  return (
    <Block gap={14}>
      <Skeleton w="35%" h={22} r={11} />
      <Skeleton w="80%" h={24} />
      <Skeleton w="100%" h={120} r={16} />
      <Skeleton w="95%" h={12} />
      <Skeleton w="88%" h={12} />
      <Skeleton w="60%" h={12} />
      <Skeleton w="100%" h={46} r={23} />
    </Block>
  );
}
