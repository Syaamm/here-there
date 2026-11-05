import { LinearGradient } from 'expo-linear-gradient';
import { tap } from './haptics';
import { usePathname } from 'expo-router';
import { createContext, memo, useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout } from '@/lib/layout';
import { scBase } from '@/lib/scale';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/**
 * How tall the floating dock is at the bottom of a phone screen (0 where there is none: tablets use a side rail, and
 * screens outside the tabs have no dock). The dock floats over the pages, so pages leave this much room at the bottom.
 */
export const DockSpace = createContext(0);
export const useDockSpace = () => useContext(DockSpace);

/** Sizes of the phone dock, in points. Every icon is centred on the pill's middle line and drawn in an ICON square. */
export const DOCK = {
  icon: 26, // optical size shared by the three drawn icons (the profile photo is 28 so it matches optically)
  avatar: 28,
  pill: 72, // height of the white pill (also the height of every tab slot, so each hit area is 72 tall)
  sideInset: 14, // pill's gap to the screen edges
  plus: 56, // diameter of the Create button: a plain disc sitting on the pill's top edge (no ring)
  raise: 18, // how far the Create button's top rises above the pill (a quarter of the pill's height)
} as const;

/**
 * Bottom spacing per platform. iPhone: the home-indicator inset is large, so the dock sits closer to the edge.
 * Android: lift above the gesture bar or the 3-button bar (whatever inset the system reports) plus a small gap.
 */
export function useDockMetrics() {
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();
  const bottom = Platform.OS === 'ios' ? Math.max(insets.bottom - 6, 12) : Math.max(insets.bottom, 12) + 6;
  const pill = Math.max(DOCK.pill, scBase(DOCK.pill)); // the dock does not grow with the text size
  return { isWide, pill, bottom, barHeight: pill + bottom, space: isWide ? 0 : pill + bottom };
}

/** An Animated.Value created once (useRef(new Animated.Value()) would build a throw-away one on every render). */
export function useAnim(initial: number) {
  const ref = useRef<Animated.Value | null>(null);
  if (!ref.current) ref.current = new Animated.Value(initial);
  return ref.current;
}

const SHADOW = '#0B2620';

/**
 * The tab bar's backdrop (phones): a soft fade so page content melts out behind the dock, and the white pill.
 * The pill is opaque so its shadow/elevation never shows through it as a grey box.
 */
export const DockBackground = memo(function DockBackground({ bottom }: { bottom: number }) {
  const { c } = useTheme();
  return (
    <>
      <LinearGradient pointerEvents="none" colors={[c.fadeFrom, c.fadeTo]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: DOCK.sideInset,
          right: DOCK.sideInset,
          top: 0,
          bottom,
          borderRadius: 999,
          backgroundColor: c.surface,
          elevation: 5,
          shadowColor: SHADOW,
          shadowOpacity: 0.1,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 3 },
        }}
      />
    </>
  );
});

/**
 * Every dock item reacts to a touch, in one motion: while the finger is down the icon squashes flat from the top;
 * on release it springs a little taller than normal, jumps up, and drops back to rest with a small bounce.
 * Behind the open tab a soft capsule swells in. All animations are transforms/opacity on the native driver.
 */
export const DockButton = memo(function DockButton(props: any) {
  const { children, onPress, onLongPress, style, accessibilityLabel, accessibilityState, testID, glass } = props;
  const { c } = useTheme();
  // this navigator reports the open tab as `aria-selected` (older ones used accessibilityState)
  const selected = !!(props['aria-selected'] ?? accessibilityState?.selected);
  const drop = useAnim(selected ? 1 : 0);
  const seen = useRef(selected);
  useEffect(() => {
    if (seen.current === selected) return;
    seen.current = selected;
    Animated.spring(drop, { toValue: selected ? 1 : 0, friction: selected ? 5 : 9, tension: selected ? 150 : 200, useNativeDriver: true }).start();
  }, [selected, drop]);
  const squash = useAnim(1); // vertical scale: below 1 squashed, above 1 stretched
  const lift = useAnim(0); // 0 on the ground, 1 at the top of the jump
  const down = () => {
    tap('Light'); // a small tap under the finger, like the Create button
    lift.stopAnimation();
    squash.stopAnimation();
    Animated.timing(squash, { toValue: 0.88, duration: 60, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };
  const up = () => {
    Animated.spring(squash, { toValue: 1, friction: 12, tension: 420, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.timing(lift, { toValue: 1, duration: 50, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, friction: 14, tension: 420, useNativeDriver: true }),
    ]).start();
  };
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={props['aria-label'] ?? accessibilityLabel}
      accessibilityState={{ ...accessibilityState, selected }}
      testID={testID}
      // Android: let the press animation draw its first frame before the new page starts rendering
      onPress={Platform.OS === 'android' && onPress ? (e: unknown) => requestAnimationFrame(() => onPress(e)) : onPress}
      onLongPress={onLongPress}
      onPressIn={down}
      onPressOut={up}
      style={style}
    >
      {glass ? (
        <Animated.View
          pointerEvents="none"
          // Android: the capsule (two gradients) is scaled and faded as one cached layer instead of being redrawn every frame
          renderToHardwareTextureAndroid
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            opacity: drop.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ scaleX: drop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }, { scaleY: drop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
        >
          {/* the open-tab capsule: a soft tint with a fine rim (THERE adds a faint sheen and sand tint through its tokens) */}
          <View style={{ position: 'absolute', left: 1, right: 1, top: 7, bottom: 7, borderRadius: 999, borderWidth: 1, borderColor: c.glassRim, backgroundColor: c.glassFill, overflow: 'hidden' }}>
            <LinearGradient colors={[c.glassShine, 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.6 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <LinearGradient colors={[c.glassTint, c.glassTintEnd]} start={{ x: 0.5, y: 0.35 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
          </View>
        </Animated.View>
      ) : null}
      {/* no hardware-texture cache here: the icon inside animates too (fill rising), which would re-draw the cache every frame */}
      <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transformOrigin: 'center bottom', transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }, { scaleY: squash }] }}>{children}</Animated.View>
    </Pressable>
  );
});

// Create button geometry: all sizes are whole pixels and the layout is at its LARGEST size; animation only scales it down (<= 1).
const BAR_LEN = 16; // a fine plus: its arms are 2 px thick
const BAR_THICK = 2;
// How the button moves (the sizes of the first version): REST at rest, OPEN while Create is the open tab, SQUEEZE taken off under a finger.
// The face is drawn BIG_K times larger than it shows (the largest it ever gets, with the rebound) and only ever shrunk, so it never blurs.
const REST = 1; // rests at its drawn size (56), like the reference
const OPEN = 1.08;
const SQUEEZE = 0.1; // how much a finger squeezes it; the rebound can pass its size by about a third of this
const BIG_K = OPEN + 0.08; // headroom above the largest size it reaches (OPEN plus the rebound), so it is never stretched

/**
 * The round "+" in the middle of the bar, raised above it (phones only; the side rail uses a normal item).
 * Pure Views, no image, font glyph or SVG: a solid forest disc sitting on the pill's top edge, with no ring and no shadow, and a fine white plus.
 * The inner disc is forest; while the Create tab is open it fades to the accent green (no extra ring).
 */
export const CreateButton = memo(function CreateButton({ onPress }: { onPress?: (...args: any[]) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  // the open tab, read from the address (the tab bar does not hand this button its selected state reliably)
  const selected = usePathname() === '/create';
  const grow = useAnim(selected ? 1 : 0); // 0 resting, 1 selected
  const press = useAnim(0);
  const spin = useAnim(selected ? 1 : 0); // the plus's turn, with a little overshoot
  const pulse = useAnim(0); // the soft wave that leaves the button when it is tapped
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.timing(grow, { toValue: selected ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.timing(spin, { toValue: selected ? 1 : 0, duration: 460, easing: Easing.out(Easing.back(1.8)), useNativeDriver: true }).start();
  }, [selected, grow, spin]);
  // driven straight from the touch (no React state), so a press never re-renders anything on the JS thread
  // pressing squeezes it in quickly; letting go springs it back past its size and settles (a loose spring: the bounce is the feel)
  const setDown = (isDown: boolean) => {
    if (isDown) tap('Medium'); // the one haptic of a tap, the moment the finger lands
    Animated.spring(press, { toValue: isDown ? 1 : 0, friction: isDown ? 9 : 3.6, tension: isDown ? 320 : 240, useNativeDriver: true }).start();
  };
  const land = () => {
    pulse.setValue(0);
    Animated.timing(pulse, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    onPress?.();
  };
  // The feel of the first version: small at rest, swelling under the finger, bigger while Create is open. `size` is how big the
  // button looks (1 = its drawn size). The face itself is drawn BIG (the largest it ever gets) and only ever shrunk by `sharp`,
  // so it is never stretched and stays sharp at every moment;
  const size = Animated.add(grow.interpolate({ inputRange: [0, 1], outputRange: [REST, OPEN] }), press.interpolate({ inputRange: [0, 1], outputRange: [0, -SQUEEZE] }));
  const sharp = Animated.multiply(size, 1 / BIG_K);
  const turn = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  const bar = { position: 'absolute', backgroundColor: '#FFFFFF', borderRadius: (BAR_THICK * BIG_K) / 2 } as const;
  const big = DOCK.plus * BIG_K;
  const barLen = BAR_LEN * BIG_K;
  const barThick = BAR_THICK * BIG_K;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Create')} accessibilityState={{ selected }} onPress={land} onPressIn={() => setDown(true)} onPressOut={() => setDown(false)} style={{ flex: 1, alignItems: 'center' }}>
      {/* the slot keeps the button's layout size; the big face inside is centred on it and shrunk by `sharp` */}
      <View style={{ marginTop: -DOCK.raise, width: DOCK.plus, height: DOCK.plus }}>
        {/* a soft wave that leaves the button when it lands (a plain fading disc, drawn behind the face) */}
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: DOCK.plus, height: DOCK.plus, borderRadius: DOCK.plus / 2, backgroundColor: c.forest, opacity: pulse.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.3, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }] }} />
        <Animated.View style={{ position: 'absolute', left: -(big - DOCK.plus) / 2, top: -(big - DOCK.plus) / 2, width: big, height: big, borderRadius: big / 2, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', transform: [{ scale: sharp }] }}>
          {/* while Create is open the face takes the accent green: a second disc fades in over the forest one (opacity runs on the native driver; a colour change would not) */}
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: big, height: big, borderRadius: big / 2, backgroundColor: c.green, opacity: grow }} />
          <Animated.View pointerEvents="none" style={{ width: big, height: big, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: turn }] }}>
            <View style={{ ...bar, left: (big - barLen) / 2, top: (big - barThick) / 2, width: barLen, height: barThick }} />
            <View style={{ ...bar, left: (big - barThick) / 2, top: (big - barLen) / 2, width: barThick, height: barLen }} />
          </Animated.View>
        </Animated.View>
      </View>
    </Pressable>
  );
});
