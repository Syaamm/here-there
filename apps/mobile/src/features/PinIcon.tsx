import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { ClipPath, Circle, Defs, Path, Rect } from 'react-native-svg';
import { Text } from '@/components/ScaledText';
import { useTheme } from '@/lib/theme';
import { PIN_PATH, pinWidth } from './mapShared';

/** The phone map's pin (the browser map draws its own with Leaflet, see MapHere.web). */
const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * A place on the map: a location pin, red at rest. When it is the selected place, green fills it from the bottom up.
 * A small badge shows how many activities are there; the pin is grey when all of them are full.
 */
export function PinIcon({ full, active, count }: { category?: string; full: boolean; active: boolean; count: number }) {
  const { c } = useTheme();
  const w = pinWidth(count);
  const fill = useRef(new Animated.Value(active ? 1 : 0)).current;
  const id = useRef(`pin${Math.random().toString(36).slice(2)}`).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: active ? 1 : 0, duration: 350, useNativeDriver: false }).start();
  }, [active, fill]);
  return (
    <View style={{ width: w + 10, height: w + 6, alignItems: 'center', justifyContent: 'flex-end' }}>
      <Svg width={w} height={w} viewBox="0 0 24 24">
        <Defs>
          <ClipPath id={id}>
            <AnimatedRect x="0" width="24" y={fill.interpolate({ inputRange: [0, 1], outputRange: [24, 0] })} height={fill.interpolate({ inputRange: [0, 1], outputRange: [0, 24] })} />
          </ClipPath>
        </Defs>
        <Path d={PIN_PATH} fill={full ? '#9A9A9A' : '#D32F2F'} />
        <Path d={PIN_PATH} fill={c.green} clipPath={`url(#${id})`} />
        <Circle cx="12" cy="9.8" r="3.2" fill="#fff" />
      </Svg>
      <View style={{ position: 'absolute', top: 0, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: c.forest, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{count}</Text>
      </View>
    </View>
  );
}
