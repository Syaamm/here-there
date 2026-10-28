import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent, Pressable, View } from 'react-native';
import { localeTag, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { reducedMotion, SOFT } from './Pop';
import { Text } from './ScaledText';

const CARD = 58;
const GAP = 8;
const STEP = CARD + GAP;
const HEIGHT = 70;
// the frame glides slowly and settles without a bounce
const GLIDE = { damping: 22, stiffness: 95, mass: 1 } as const;

/** A calendar day is kept as "YYYY-MM-DD" and read at noon UTC, so it is the same day in every time zone. */
const part = (key: string, o: Intl.DateTimeFormatOptions) => new Date(`${key}T12:00:00Z`).toLocaleDateString(localeTag(), { ...o, timeZone: 'UTC' });

/**
 * A day picker that works like a dial: a soft green frame stays fixed in the middle and the row of dates slides underneath
 * it. Slide the row (it settles on a day), or tap any date and the row turns until that date sits in the frame. The dates
 * next to the frame shrink and fade, so the chosen one stands out.
 *
 * The first position is "Later" (a plan with no day yet). `days` are the days to offer ("YYYY-MM-DD"), `value` the chosen
 * one (null = not decided). `dayNumber` gives "Day 3" for a day.
 */
export function DayStrip({ days, value, onChange, dayNumber }: { days: string[]; value: string | null; onChange: (day: string | null) => void; dayNumber: (key: string) => string }) {
  const { t } = useT();
  const { c } = useTheme();
  const items: (string | null)[] = [null, ...days];
  const indexOf = (v: string | null) => Math.max(0, v ? items.indexOf(v) : 0);
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(indexOf(value) * STEP)).current;
  const ref = useRef<{ scrollTo: (o: { x: number; animated: boolean }) => void } | null>(null);
  const at = useRef(indexOf(value)); // the position the dial is on (or turning to)
  // the frame gives a small pulse each time a day settles in it
  const pulse = useRef(new Animated.Value(1)).current;
  const pulsed = useRef(value);
  useEffect(() => {
    if (pulsed.current === value) return;
    pulsed.current = value;
    if (reducedMotion()) return;
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.08, duration: 110, useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, ...SOFT, useNativeDriver: true }),
    ]).start();
  }, [value, pulse]);

  const goTo = (i: number, animated: boolean) => {
    at.current = i;
    ref.current?.scrollTo({ x: i * STEP, animated });
  };
  // the dial follows a day chosen from somewhere else, and opens on the chosen day
  useEffect(() => {
    const i = indexOf(value);
    if (width && i !== at.current) goTo(i, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  useEffect(() => {
    if (width) ref.current?.scrollTo({ x: indexOf(value) * STEP, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.min(items.length - 1, Math.max(0, Math.round(e.nativeEvent.contentOffset.x / STEP)));
    at.current = i;
    if (items[i] !== value) onChange(items[i]);
  };

  const FRAME_W = CARD + 12;
  const FRAME_H = HEIGHT + 12;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ height: FRAME_H, justifyContent: 'center' }}>
      {width ? (
        <>
          {/* the fixed frame: soft green fill, thin green edge */}
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{ position: 'absolute', left: (width - FRAME_W) / 2, top: 0, width: FRAME_W, height: FRAME_H, borderRadius: 20, borderWidth: 1.5, borderColor: `${c.green}99`, backgroundColor: `${c.green}14`, transform: [{ scale: pulse }] }}
          />
          <Animated.ScrollView
            // the ref only ever needs scrollTo
            ref={ref as never}
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            snapToInterval={STEP}
            decelerationRate="fast"
            scrollEventThrottle={16}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { x } } }], { useNativeDriver: true })}
            onMomentumScrollEnd={settle}
            onScrollEndDrag={(e) => {
              // released without a fling: it settles at once
              if (Math.abs(e.nativeEvent.velocity?.x ?? 0) < 0.05) settle(e);
            }}
            contentContainerStyle={{ paddingHorizontal: (width - CARD) / 2, gap: GAP, alignItems: 'center' }}
          >
            {items.map((d, i) => {
              const on = d === value;
              // where this date is as the row slides: 0 in the frame, then one place and two places away, on either side
              const ramp = (out: [number, number, number, number, number] | [string, string, string, string, string]) => x.interpolate({ inputRange: [(i - 2) * STEP, (i - 1) * STEP, i * STEP, (i + 1) * STEP, (i + 2) * STEP], outputRange: out as never, extrapolate: 'clamp' });
              return (
                // like a dial turning: the dates away from the frame tilt back, sink a little, shrink and fade; the one in the frame comes forward
                <Animated.View key={d ?? 'later'} style={{ opacity: ramp([0.25, 0.55, 1, 0.55, 0.25]), transform: [{ perspective: 600 }, { translateY: ramp([12, 5, 0, 5, 12]) }, { rotateY: ramp(['55deg', '30deg', '0deg', '-30deg', '-55deg']) }, { scale: ramp([0.74, 0.88, 1.06, 0.88, 0.74]) }] }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={d ? `${dayNumber(d)}, ${part(d, { weekday: 'long', day: 'numeric', month: 'long' })}` : t('Not decided yet')}
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      goTo(i, true);
                      if (!on) onChange(d);
                    }}
                    style={{ width: CARD, height: HEIGHT, alignItems: 'center', justifyContent: 'center', gap: 1 }}
                  >
                    {d ? (
                      <>
                        <Text style={{ color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>{part(d, { weekday: 'short' }).toUpperCase()}</Text>
                        <Text style={{ color: c.text, fontSize: 21, fontWeight: '800', lineHeight: 26 }}>{Number(d.slice(8))}</Text>
                        <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>{part(d, { month: 'short' })}</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="help-circle-outline" size={22} color={c.muted} />
                        <Text style={{ color: c.text, fontSize: 12, fontWeight: '800' }}>{t('Later')}</Text>
                      </>
                    )}
                  </Pressable>
                </Animated.View>
              );
            })}
          </Animated.ScrollView>
        </>
      ) : null}
    </View>
  );
}

/**
 * Pick one of a few options in a single rounded bar, each with an icon. The same soft green frame as the day dial sits on
 * the chosen one and glides to the next when another is picked; the chosen icon lifts a little. If the value matches none
 * of the options (an exact time typed in), the frame fades away.
 * `options` are [label, value, icon, hint?].
 */
export function Segmented<T extends string>({ options, value, onChange }: { options: readonly (readonly [string, T, keyof typeof Ionicons.glyphMap, string?])[]; value: T | string; onChange: (v: T) => void }) {
  const { c } = useTheme();
  const PAD = 4;
  const GAPS = 4;
  const H = 56;
  const [width, setWidth] = useState(0);
  const n = options.length;
  const segW = width ? (width - PAD * 2 - GAPS * (n - 1)) / n : 0;
  const at = options.findIndex((o) => o[1] === value);
  const x = useRef(new Animated.Value(0)).current;
  const seen = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  useEffect(() => {
    if (!segW) return;
    if (at < 0) {
      Animated.timing(seen, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      return;
    }
    const to = at * (segW + GAPS);
    if (!placed.current || reducedMotion()) {
      // first showing: it is simply there
      x.setValue(to);
      placed.current = true;
    } else {
      Animated.spring(x, { toValue: to, ...GLIDE, useNativeDriver: true }).start();
    }
    Animated.timing(seen, { toValue: 1, duration: reducedMotion() ? 0 : 160, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at, segW]);
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', backgroundColor: c.accentSoft, borderRadius: 16, padding: PAD, gap: GAPS }}>
      {segW ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ position: 'absolute', left: PAD, top: PAD, width: segW, height: H, borderRadius: 13, borderWidth: 1.5, borderColor: `${c.green}AA`, backgroundColor: `${c.green}26`, opacity: seen, transform: [{ translateX: x }] }}
        />
      ) : null}
      {options.map(([label, v, icon, hint]) => (
        <Segment key={label} on={value === v} label={label} hint={hint} icon={icon} onPress={() => onChange(v)} height={H} />
      ))}
    </View>
  );
}

/** One option of the bar: its icon rises and grows a little while it is the chosen one, and settles back when it is not. */
function Segment({ on, label, hint, icon, onPress, height }: { on: boolean; label: string; hint?: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; height: number }) {
  const { t } = useT();
  const { c } = useTheme();
  const lift = useRef(new Animated.Value(on ? 1 : 0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reducedMotion()) lift.setValue(on ? 1 : 0);
    else Animated.spring(lift, { toValue: on ? 1 : 0, ...SOFT, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${t(label)}, ${t(hint)}` : t(label)}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [{ flex: 1, minHeight: height, borderRadius: 13, alignItems: 'center', justifyContent: 'center', gap: 3 }, pressed && !on && { opacity: 0.7 }]}
    >
      <Animated.View style={{ transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }, { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }}>
        <Ionicons name={icon} size={18} color={on ? c.green : c.forest} />
      </Animated.View>
      <Text style={{ color: c.text, fontSize: 11, fontWeight: on ? '800' : '700' }}>{t(label)}</Text>
    </Pressable>
  );
}
