import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Animated, PixelRatio, Platform, Pressable, Text as RNText, View, type ScrollViewInstance, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { get } from '@/lib/api';
import { localeTag, useT } from '@/lib/i18n';
import { tick } from '@/lib/haptics';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { Text, TextInput, type InputHandle } from './ScaledText';
import type { Place } from './PlaceSearch';
import { StepBars, StepLabel } from './StepMotion';
import { PlainTitle, pressed } from './ui';
import { dateLang } from '@/lib/format';
import { fontOf } from '@/lib/fonts';

/** The four "Host activity" steps (Figma "Host activity 1/4 to 4/4"): back button, title, progress, then the step's content. */

/** The top of every step: round back button, "Host activity" and the step's name in the middle, "Step n/4" and four bars under them. */
export function WizardTop({ step, title, onBack, right, onStep, canStep }: { step: number; title: string; onBack: () => void; right?: ReactNode; /** tapping a step bar jumps to it, where canStep allows */ onStep?: (i: number) => void; canStep?: (i: number) => boolean }) {
  const { t } = useT();
  const { c, mode } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <PlainTitle
        onBack={onBack}
        custom={
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 16 }}>{t('Host activity')}</Text>
            <Text accessibilityRole="header" numberOfLines={1} style={{ color: c.text, fontSize: 15, lineHeight: 19, fontWeight: '500', textAlign: 'center' }}>{title}</Text>
          </View>
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 }}>
        <StepLabel step={step} style={{ color: c.muted, fontSize: 12.7, lineHeight: 16 }} />
        {right}
      </View>
      <StepBars step={step} track={mode === 'there' ? '#fff' : c.sand} fill={c.forest} onPick={onStep} canPick={canStep} />
    </View>
  );
}

/** The two text buttons on the right of a wizard's top: "Restart" (saves a draft, then an empty form on step 1) and "Clear all". */
export function WizardActions({ canRestart, onRestart, canClear, onClear }: { canRestart: boolean; onRestart: () => void; canClear: boolean; onClear: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const action = (label: string, spoken: string, on: boolean, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={spoken} accessibilityState={{ disabled: !on }} disabled={!on} hitSlop={8} onPress={onPress} style={{ minHeight: 30, justifyContent: 'center', opacity: on ? 1 : 0.4 }}>
      <Text style={{ color: c.text, fontSize: 13, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      {action(t('Restart'), t('Save as a draft and start again'), canRestart, onRestart)}
      {action(t('Clear all'), t('Clear all'), canClear, onClear)}
    </View>
  );
}

/** A section label: forest green, medium weight. */
export function CreateLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={style}>
      <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 16, lineHeight: 22, fontWeight: '500', paddingLeft: 2 }}>{children}</Text>
    </View>
  );
}

/** The full-width pill field (one line). */
export function PillInput({ label, style, ...rest }: TextInputProps & { label: string; ref?: Ref<InputHandle> }) {
  const { c } = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={c.placeholder}
      selectionColor={c.forest}
      cursorColor={c.forest}
      underlineColorAndroid="transparent"
      returnKeyType="done"
      {...rest}
      style={[{ includeFontPadding: false, minHeight: sc(54), borderWidth: 1, borderRadius: 32, borderColor: c.line, backgroundColor: c.surface, color: c.text, fontSize: 14, paddingHorizontal: 20, paddingVertical: 10 }, style]}
    />
  );
}

/** The roomy rounded box for the description. */
export function PillArea({ label, style, ...rest }: TextInputProps & { label: string; ref?: Ref<InputHandle> }) {
  const { c } = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={c.placeholder}
      multiline
      textAlignVertical="top"
      selectionColor={c.forest}
      cursorColor={c.forest}
      underlineColorAndroid="transparent"
      {...rest}
      style={[{ minHeight: sc(100), borderWidth: 1, borderRadius: 32, borderColor: c.line, backgroundColor: c.surface, color: c.text, fontSize: 14, lineHeight: 20, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 16 }, style]}
    />
  );
}

/** A category: round photo and a word inside a pill. Dark and filled when picked. */
/**
 * A small round photo (the category chips and cards). The round frame clips the photo and draws the white ring: Android does not
 * reliably round an image's own corners or draw a border on it, which left square or uneven edges there.
 */
export function RoundPhoto({ source, size, ring }: { source: ImageSource | number; size: number; ring?: boolean }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', borderWidth: ring ? 1.5 : 0, borderColor: '#fff' }}>
      <Image source={source} contentFit="cover" style={{ width: '100%', height: '100%' }} />
    </View>
  );
}

/** A category card in the create form's grid. `width` is its column's width (three to a row, see CreateActivity). */
export function CategoryPill({ label, spoken, photo, selected, onPress, width }: { label: string; spoken: string; photo: ImageSource | number; selected: boolean; onPress: () => void; width?: number }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      style={({ pressed: p }) => [{ width: width ?? '30%', minHeight: sc(40), borderRadius: 999, borderWidth: 1, borderColor: selected ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: selected ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: sc(3), paddingLeft: sc(3), paddingRight: sc(8) }, pressed(p)]}
    >
      <RoundPhoto source={photo} size={sc(32)} ring={selected} />
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: selected ? '#fff' : c.forest, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** A small pill choice (am / pm, quick picks, durations, neighbourhoods): white with a thin rim, dark when picked. */
export function SmallPill({ label, spoken, active, onPress }: { label: string; spoken?: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: 40, paddingHorizontal: 18, borderRadius: 32, borderWidth: 1.2, borderColor: active ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: active ? c.forest : c.surface, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}
    >
      <Text style={{ color: active ? '#fff' : c.forest, fontSize: 14, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

// A row is about 40 dp, nudged so it is a WHOLE number of physical pixels. Android rounds a text line's height to whole pixels but
// scrolls and snaps in fractions of one: on a screen where 40 dp is e.g. 112.5 px, the one long column of numbers drifted half a pixel
// per row away from the scroll positions (about three quarters of a row by the middle of the wheel), so the number shown in the
// middle window was not the one the wheel stopped on. iPhone screens have whole-pixel rows already, so nothing changes there.
const WHEEL_ROW = Math.round(40 * PixelRatio.get()) / PixelRatio.get();
const WHEEL_ROWS = 5;

/**
 * The numbers of a wheel as one plain column: no animation of its own (the whole column only moves), so a wheel costs the phone
 * almost nothing per frame however many rows it has. Memoised: the screen's re-renders don't rebuild it.
 */
const WheelColumn = memo(function WheelColumn({ texts, off, color, offColor }: { texts: string; off: string; color: string; offColor: string }) {
  // ONE text, a number per line (each line a row tall), not a view per number: the step opens at once however long the wheel is.
  // Runs of greyed numbers are coloured parts of it. Not scaled with the phone's text size, so the lines stay exactly a row apart.
  const list = texts.split('|');
  const parts: { text: string; grey: boolean }[] = [];
  list.forEach((text, k) => {
    const grey = off[k] === '1';
    const line = (k ? '\n' : '') + text;
    const last = parts[parts.length - 1];
    if (last && last.grey === grey) last.text += line;
    else parts.push({ text: line, grey });
  });
  return (
    <RNText allowFontScaling={false} style={{ fontSize: 26, lineHeight: WHEEL_ROW, height: WHEEL_ROW * list.length, ...fontOf('700'), textAlign: 'center', color, includeFontPadding: false, textAlignVertical: 'top' }}>
      {parts.map((p, k) => (
        <RNText key={k} style={p.grey ? { color: offColor } : null}>{p.text}</RNText>
      ))}
    </RNText>
  );
});

/**
 * A picker wheel, built like the iPhone's: a dim column of numbers scrolls, and a window one row tall in the middle shows the same
 * column in full colour, moved in step with it (natively), so whatever passes the middle lights up. Only two layers move per frame,
 * so it is smooth on Android too. It snaps to a row and reports it once it has stopped; it turns itself only when the value changes
 * from outside (− / +, AM / PM, a quick pick, or a disabled row being refused). Rows that can't be picked are greyed.
 */
/** How many rows a looping wheel lays out (its items repeated): it rests in the middle and is moved back there (unseen) after each
 *  stop, so it turns either way without end. Plain rows are cheap, so a long run is drawn and a fling never reaches an end. */
const WHEEL_LENGTH = 300;


type WheelProps<T extends string | number> = { items: T[]; value: T; onChange: (v: T) => void; label: (v: T) => string; spoken: string; disabled?: (v: T) => boolean };

/** The picker wheel: the iPhone's own build, and a simpler one for Android (see WheelAndroid). */
export function Wheel<T extends string | number>(props: WheelProps<T>) {
  return Platform.OS === 'android' ? <WheelAndroid {...props} /> : <WheelIOS {...props} />;
}

function WheelIOS<T extends string | number>({ items, value, onChange, label, spoken, disabled }: WheelProps<T>) {
  const { c } = useTheme();
  const box = useRef<ScrollViewInstance>(null);
  // the wheel turns without end: 58, 59, 00, 01... (and 11, 12, 1, 2... for the hours)
  const n = items.length;
  const y = useRef(new Animated.Value(0)).current; // how far the wheel has turned (set to where it opens just below)
  const copies = Math.max(5, Math.round(WHEEL_LENGTH / Math.max(1, n)) | 1); // odd, so there is a middle copy
  const rows = useMemo(() => Array.from({ length: n * copies }, (_, k) => items[k % n]), [items, n, copies]);
  const middle = n * Math.floor(copies / 2); // where the middle copy starts
  // the column's text and its greyed rows, as strings: they only change when the numbers really do (not on every re-render)
  const texts = rows.map(label).join('|');
  const off = rows.map((v) => (disabled?.(v) ? '1' : '0')).join('');
  const minusY = useMemo(() => Animated.multiply(y, -1), [y]);
  const want = Math.max(0, items.indexOf(value)); // the value's place among the items
  const shown = useRef(middle + want); // the row the wheel rests on (among all the copies)
  // where it opens, fixed once: iOS moves a scroll view at once whenever this changes, which would skip the roll after − / +
  const start = useRef<{ x: number; y: number } | null>(null);
  if (!start.current) {
    start.current = { x: 0, y: (middle + want) * WHEEL_ROW };
    y.setValue(start.current.y);
  }
  const ticked = useRef(middle + want); // the last row a haptic click was given for
  // after it stops: back to the same value in the middle copy, without moving on screen (the rows look the same)
  const recentre = (i: number) => {
    const k = middle + (i % n);
    if (k === i) return i;
    box.current?.scrollTo({ y: k * WHEEL_ROW, animated: false });
    ticked.current = k;
    return k;
  };
  // true from the moment a finger touches the wheel until it has come to rest. Only then is where it stopped reported: a roll the
  // screen asked for itself (− / +, AM / PM) can send late or half-way scroll events, and those must never change the value back.
  const touched = useRef(false);
  // it came to rest on row i: remember it, and report it when it is a new value. A greyed (not allowed) number is never kept:
  // the wheel eases to the nearest allowed one and reports that instead (the screen's own correction would not turn it when
  // the allowed value was already the shown one, which left the wheel resting on a grey number).
  const settle = (offset: number) => {
    if (!touched.current) {
      // not turned by a finger: only keep the rows centred, report nothing
      const j = Math.min(rows.length - 1, Math.max(0, Math.round(offset / WHEEL_ROW)));
      shown.current = recentre(j);
      return;
    }
    touched.current = false;
    const i = Math.min(rows.length - 1, Math.max(0, Math.round(offset / WHEEL_ROW)));
    let k = i % n;
    if (disabled?.(items[k])) {
      // nearest allowed number in the list (not round the end: 12 o'clock should not jump to 11 at night)
      let best = -1;
      for (let j = 0; j < n; j++) {
        if (disabled(items[j])) continue;
        if (best < 0 || Math.abs(j - k) < Math.abs(best - k) || (Math.abs(j - k) === Math.abs(best - k) && j > best)) best = j;
      }
      if (best >= 0) {
        const row = i - k + best; // the same copy of the list, so the wheel only moves a little
        shown.current = row;
        ticked.current = row;
        box.current?.scrollTo({ y: row * WHEEL_ROW, animated: true });
        if (best !== want) onChange(items[best]);
        idle.current = setTimeout(() => {
          shown.current = recentre(row);
        }, 320);
        return;
      }
    }
    shown.current = recentre(i);
    if (k !== want) onChange(items[k]);
  };
  const latest = useRef({ settle });
  latest.current = { settle };
  const lastY = useRef(0);
  const dragging = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (idle.current && clearTimeout(idle.current)), []);
  // if it is still between two numbers (Android sometimes stops there), ease it onto the nearest and report that one
  const toNearestRow = () => {
    if (dragging.current || !touched.current) return;
    const row = Math.round(lastY.current / WHEEL_ROW) * WHEEL_ROW;
    if (Math.abs(lastY.current - row) < 1) return;
    box.current?.scrollTo({ y: row, animated: true });
    idle.current = setTimeout(() => latest.current.settle(row), 260);
  };
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y } } }], {
        useNativeDriver: true,
        // a faint click each time a new row reaches the middle
        listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
          const at = e.nativeEvent.contentOffset.y;
          lastY.current = at;
          const i = Math.round(at / WHEEL_ROW);
          if (i !== ticked.current) {
            ticked.current = i;
            tick();
          }
          // once it goes still (not under a finger)
          if (idle.current) clearTimeout(idle.current);
          idle.current = setTimeout(toNearestRow, 180);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [y],
  );

  // a change from outside (− / +, AM / PM, a quick pick): turn to the nearest row that shows it, the short way round
  useEffect(() => {
    if (n === 0 || shown.current % n === want) return;
    const base = shown.current - (shown.current % n);
    const near = [base + want - n, base + want, base + want + n].reduce((best, k) => (Math.abs(k - shown.current) < Math.abs(best - shown.current) ? k : best));
    shown.current = near;
    box.current?.scrollTo({ y: near * WHEEL_ROW, animated: true });
  }, [want, n]);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={spoken}
      accessibilityValue={{ text: label(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(items[(want + (e.nativeEvent.actionName === 'increment' ? 1 : n - 1)) % n])}
      style={{ width: 56, height: WHEEL_ROW * WHEEL_ROWS }}
    >
      <Animated.ScrollView
        ref={box}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        snapToInterval={WHEEL_ROW}
        decelerationRate={0.995}
        contentOffset={start.current}
        // built while hidden (a step not on screen yet), a scroll view can't hold its place: put it on the value once it is shown
        onLayout={() => {
          box.current?.scrollTo({ y: shown.current * WHEEL_ROW, animated: false });
          y.setValue(shown.current * WHEEL_ROW);
        }}
        contentContainerStyle={{ paddingVertical: ((WHEEL_ROWS - 1) / 2) * WHEEL_ROW }}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          dragging.current = true;
          touched.current = true;
          if (idle.current) clearTimeout(idle.current);
        }}
        onScrollEndDrag={() => {
          dragging.current = false;
          // let go slowly (no fling): Android sends no momentum event and no more scroll events, and the still-timer already ran
          // while the finger was down, so nothing else would bring it onto a row. A fling's scroll events cancel this one.
          if (idle.current) clearTimeout(idle.current);
          idle.current = setTimeout(toNearestRow, 140);
        }}
        onMomentumScrollEnd={(e) => {
          if (idle.current) clearTimeout(idle.current);
          settle(e.nativeEvent.contentOffset.y);
        }}
      >
        <View style={{ opacity: 0.3 }}>
          <WheelColumn texts={texts} off={off} color={c.text} offColor={c.muted} />
        </View>
      </Animated.ScrollView>
      {/* the middle row: the same column in full colour, exactly over the dim one, moved with the scroll */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ((WHEEL_ROWS - 1) / 2) * WHEEL_ROW, height: WHEEL_ROW, overflow: 'hidden' }}>
        <Animated.View style={{ transform: [{ translateY: minusY }] }}>
          <WheelColumn texts={texts} off={off} color={c.text} offColor={c.muted} />
        </Animated.View>
      </View>
    </View>
  );
}

/**
 * The wheel on Android, built for Android (the iPhone's is above and is left alone). What it does differently:
 *  - it never moves the list behind the finger's back: the numbers are repeated many times and it starts in the middle, so it turns
 *    either way for a long, long way without the jump that put the list back in the middle after each stop (that jump made it stick
 *    and stutter);
 *  - the native snap (snapToInterval) puts it on a row, and the value is read once, when it has really stopped (the end of a fling,
 *    or a short moment after the finger lets go slowly), never from the scroll events on the way;
 *  - no haptic click, so nothing buzzes while it turns.
 * The look is the same: a dim column, and a window one row tall in the middle that shows the same numbers in full colour.
 */
function WheelAndroid<T extends string | number>({ items, value, onChange, label, spoken, disabled }: WheelProps<T>) {
  const { c } = useTheme();
  const box = useRef<ScrollViewInstance>(null);
  const n = items.length;
  const copies = Math.max(5, Math.round(WHEEL_LENGTH / Math.max(1, n)) | 1); // odd, so there is a middle copy
  const rows = useMemo(() => Array.from({ length: n * copies }, (_, k) => items[k % n]), [items, n, copies]);
  const middle = n * Math.floor(copies / 2);
  const want = Math.max(0, items.indexOf(value));
  const texts = rows.map(label).join('|');
  const off = rows.map((v) => (disabled?.(v) ? '1' : '0')).join('');
  const y = useRef(new Animated.Value((middle + want) * WHEEL_ROW)).current;
  const minusY = useMemo(() => Animated.multiply(y, -1), [y]);
  // One snap point per row, each worked out on its own. (snapToInterval makes Android round the row height to whole pixels, so on some
  // screens every row snaps a pixel short and the error adds up row by row: the hour and the minute column, resting on different
  // rows, ended up at different heights, and a stop could be read as the wrong row.)
  const snaps = useMemo(() => Array.from({ length: n * copies }, (_, k) => k * WHEEL_ROW), [n, copies]);
  const rest = useRef(middle + want); // the row it rests on
  const rowAt = (offset: number) => Math.min(rows.length - 1, Math.max(0, Math.round(offset / WHEEL_ROW)));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  // it has stopped at (about) this offset: keep the row, and report it when it is a new value. A greyed number is never kept: it
  // eases to the nearest allowed one in the same copy, and that one is reported.
  const settle = (offset: number) => {
    clearTimer();
    const i = rowAt(offset);
    const k = i % n;
    if (disabled?.(items[k])) {
      let best = -1;
      for (let j = 0; j < n; j++) {
        if (disabled(items[j])) continue;
        if (best < 0 || Math.abs(j - k) < Math.abs(best - k) || (Math.abs(j - k) === Math.abs(best - k) && j > best)) best = j;
      }
      if (best >= 0) {
        const row = i - k + best;
        rest.current = row;
        box.current?.scrollTo({ y: row * WHEEL_ROW, animated: true });
        if (best !== want) onChange(items[best]);
        return;
      }
    }
    rest.current = i;
    if (k !== want) onChange(items[k]);
  };

  // the finger let go: with a fling the momentum events take over; with a slow release there are none, so after a moment it is put on
  // the nearest row (the native snap usually has done it already) and read
  const letGo = (offset: number, speed: number) => {
    clearTimer();
    if (speed > 0.15) return; // a fling: the end of the momentum reports it
    timer.current = setTimeout(() => {
      const row = rowAt(offset) * WHEEL_ROW;
      const moves = Math.abs(offset - row) > 1;
      if (moves) box.current?.scrollTo({ y: row, animated: true });
      timer.current = setTimeout(() => settle(row), moves ? 220 : 0);
    }, 90);
  };

  // a change from outside (- / +, AM / PM, a quick pick): turn to the nearest row that shows it
  useEffect(() => {
    if (n === 0 || rest.current % n === want) return;
    const base = rest.current - (rest.current % n);
    const near = [base + want - n, base + want, base + want + n].reduce((best, k) => (Math.abs(k - rest.current) < Math.abs(best - rest.current) ? k : best));
    rest.current = near;
    box.current?.scrollTo({ y: near * WHEEL_ROW, animated: true });
  }, [want, n]);

  const onScroll = useMemo(() => Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true }), [y]);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={spoken}
      accessibilityValue={{ text: label(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onChange(items[(want + (e.nativeEvent.actionName === 'increment' ? 1 : n - 1)) % n])}
      style={{ width: 56, height: WHEEL_ROW * WHEEL_ROWS }}
    >
      <Animated.ScrollView
        ref={box}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        overScrollMode="never"
        snapToOffsets={snaps}
        decelerationRate="fast"
        // built while hidden (a step not on screen yet), a scroll view can't hold its place: put it on the value once it is shown
        onLayout={() => {
          box.current?.scrollTo({ y: rest.current * WHEEL_ROW, animated: false });
          y.setValue(rest.current * WHEEL_ROW);
        }}
        contentContainerStyle={{ paddingVertical: ((WHEEL_ROWS - 1) / 2) * WHEEL_ROW }}
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={clearTimer}
        onMomentumScrollBegin={clearTimer}
        onScrollEndDrag={(e) => letGo(e.nativeEvent.contentOffset.y, Math.abs(e.nativeEvent.velocity?.y ?? 0))}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
      >
        <View style={{ opacity: 0.3 }}>
          <WheelColumn texts={texts} off={off} color={c.text} offColor={c.muted} />
        </View>
      </Animated.ScrollView>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ((WHEEL_ROWS - 1) / 2) * WHEEL_ROW, height: WHEEL_ROW, overflow: 'hidden' }}>
        <Animated.View style={{ transform: [{ translateY: minusY }] }}>
          <WheelColumn texts={texts} off={off} color={c.text} offColor={c.muted} />
        </Animated.View>
      </View>
    </View>
  );
}

/** The round "−" / "+" and the arrows: white, 44 px to touch. */
export function RoundBtn({ icon, label, onPress, onLongPress, disabled, size = 44, filled }: { icon: 'add' | 'remove' | 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean; size?: number; filled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed: p }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: filled ? c.surface : 'transparent', borderWidth: filled ? 0 : 1, borderColor: 'rgba(0,0,0,0.09)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }, pressed(p)]}
    >
      <Ionicons name={icon} size={icon === 'add' || icon === 'remove' ? 22 : 18} color={c.text} />
    </Pressable>
  );
}

/** A number between − and +, in a soft pill (the party size). */
export function CountPill({ value, onMinus, onPlus, minusLabel, plusLabel, canMinus, canPlus }: { value: number; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; canMinus: boolean; canPlus: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ alignSelf: 'center', width: '78%', minHeight: 56, borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }}>
      <RoundBtn filled icon="remove" label={minusLabel} disabled={!canMinus} onPress={onMinus} size={44} />
      <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 32, lineHeight: 40, fontWeight: '700' }}>{value}</Text>
      <RoundBtn filled icon="add" label={plusLabel} disabled={!canPlus} onPress={onPlus} size={44} />
    </View>
  );
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Date formatters, made once per language and style: making one is slow on a phone (and was done for every day, every redraw). */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateFormat(tag: string, opts: Intl.DateTimeFormatOptions) {
  const key = tag + JSON.stringify(opts);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, opts);
    formatters.set(key, f);
  }
  return f;
}

/**
 * A month to pick the day from. Days outside min..max are greyed and cannot be picked. The arrows change the month,
 * only as far as the first and last day that can be picked.
 */
export function MonthCalendar({ month, onMonth, selected, min, max, onPick, marks }: { month: Date; onMonth: (m: Date) => void; selected: Date; min: Date; max: Date; onPick: (d: Date) => void; /** days that already hold a plan of yours ("year-month-day", month from 0): a dot under the number */ marks?: Record<string, 'activity' | 'trip'> }) {
  const { t } = useT();
  const { c } = useTheme();
  const tag = dateLang();
  const weekStart = tag.toLowerCase().startsWith('it') ? 1 : 0; // Italian weeks start on Monday
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => dateFormat(tag, { weekday: 'short' }).format(new Date(2023, 0, 1 + ((i + weekStart) % 7)))), [tag, weekStart]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length < 42) cells.push(null); // always six rows: the calendar is the same size in every month (some need four, some six)
  const lo = startOfDay(min);
  const hi = startOfDay(max);
  const canPrev = new Date(month.getFullYear(), month.getMonth(), 0) >= lo;
  const canNext = new Date(month.getFullYear(), month.getMonth() + 1, 1) <= hi;
  const monthName = dateFormat(tag, { month: 'long', year: 'numeric' }).format(first);
  const sel = startOfDay(selected);
  // the days are drawn again only when what they show changes (the month, the chosen day, the first and last day allowed),
  // not on each redraw of the step (the time wheels, − / +, the clock that ticks)
  const pick = useRef(onPick);
  pick.current = onPick;
  const days = useMemo(
    () =>
      cells.map((n, i) => {
        if (n == null) return <View key={i} style={{ width: `${100 / 7}%`, height: 44 }} />;
        const d = new Date(month.getFullYear(), month.getMonth(), n);
        const off = d < lo || d > hi;
        const on = +d === +sel;
        const mark = marks?.[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`];
        return (
          <View key={i} style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dateFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' }).format(d) + (mark ? `. ${mark === 'trip' ? t('You are on a trip this day') : t('You have a plan this day')}` : '')}
              accessibilityState={{ selected: on, disabled: off }}
              disabled={off}
              onPress={() => pick.current(d)}
              style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : 'transparent' }}
            >
              <Text style={{ color: on ? '#fff' : off ? c.placeholder : c.text, fontSize: 13, fontWeight: on ? '500' : '400' }}>{n}</Text>
              {/* a day that already holds a plan of yours: a dot (red for an activity, amber for a trip; also said aloud above) */}
              {mark ? <View style={{ position: 'absolute', bottom: 5, width: 5, height: 5, borderRadius: 3, backgroundColor: on ? '#fff' : mark === 'trip' ? c.warnFg : c.badFg }} /> : null}
            </Pressable>
          </View>
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [month.getFullYear(), month.getMonth(), +sel, +lo, +hi, tag, c, marks],
  );
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <RoundBtn icon="chevron-back" label={t('Previous month')} disabled={!canPrev} onPress={() => onMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1))} />
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 16, fontWeight: '600', textTransform: 'capitalize' }}>{monthName}</Text>
        <RoundBtn icon="chevron-forward" label={t('Next month')} disabled={!canNext} onPress={() => onMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1))} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {weekdays.map((w, i) => (
          <View key={i} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: 13 }}>{w}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {days}
      </View>
    </View>
  );
}

const MIN_CHARS = 3;
const DELAY_MS = 500; // one search per pause in typing

/**
 * Where an activity meets: its neighbourhood or area ("Brera, Milan"), not a particular shop; the exact spot is agreed in
 * the group chat. A pill search field over the area search, nearby areas first. Picking a result shows it as a card with Change; the typed words
 * stay usable as a plain name when the search finds nothing or is not available, so nobody gets stuck. Same behaviour as
 * the earlier PlaceSearch, in the design's look.
 */
export function PlacePick({ label, text, onText, place, onPlace, city, near, inputRef, onSubmit, invalid }: { /** marked red: the thing that was missed */ invalid?: boolean; label: string; text: string; onText: (v: string) => void; place: Place | null; onPlace: (p: Place | null) => void; city: string; /** the city's centre: places near it are listed first */ near?: { lat: number; lng: number } | null; inputRef?: Ref<InputHandle>; /** the keyboard's return key */ onSubmit?: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [found, setFound] = useState<Place[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const latest = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (place || q.length < MIN_CHARS) {
      latest.current++;
      setFound(null);
      setState('idle');
      return;
    }
    const mine = ++latest.current;
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const r = await get<{ items: Place[] }>(`/v1/places/search?${new URLSearchParams({ q, kind: 'area', ...(near ? { lat: String(near.lat), lng: String(near.lng) } : city.trim() ? { city: city.trim() } : {}) })}`);
        if (mine !== latest.current) return;
        setFound(r.items);
        setState('done');
      } catch {
        if (mine !== latest.current) return;
        setFound(null);
        setState('error');
      }
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, city, near?.lat, near?.lng, place]);

  if (place) {
    return (
      <View style={{ minHeight: sc(64), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 8 }}>
        <Ionicons name="location" size={22} color={c.forest} />
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ color: c.forest, fontSize: 14, fontWeight: '600' }}>{place.name}</Text>
          {place.address ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{place.address}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Change location, now {name}', { name: place.name })} hitSlop={6} onPress={() => { onText(''); onPlace(null); }} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
          <Text style={{ color: c.forest, fontSize: 14, fontWeight: '600' }}>{t('Change')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ minHeight: sc(56), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, borderWidth: invalid ? 1.2 : 0, borderColor: c.danger }}>
        <Ionicons name="search-outline" size={22} color={c.text} />
        <TextInput
          accessibilityLabel={label}
          placeholder={t('Search a neighbourhood or area')}
          placeholderTextColor={c.placeholder}
          selectionColor={c.forest}
          cursorColor={c.forest}
          underlineColorAndroid="transparent"
          ref={inputRef}
          returnKeyType={onSubmit ? 'next' : 'search'}
          submitBehavior={onSubmit ? 'submit' : undefined}
          onSubmitEditing={onSubmit}
          value={text}
          onChangeText={onText}
          maxLength={100}
          autoCorrect={false}
          style={{ flex: 1, color: c.forest, fontSize: 14, paddingVertical: 12, includeFontPadding: false }}
        />
      </View>
      {state === 'searching' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Searching…')}</Text> : null}
      {state === 'error' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Search unavailable. Type the neighbourhood name.')}</Text> : null}
      {state === 'done' && found && found.length === 0 ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('No neighbourhood found.')}</Text> : null}
      {found && found.length > 0 ? (
        <View style={{ borderRadius: 24, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {found.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={t('Use {name}, {address}', { name: p.name, address: p.address })}
              onPress={() => onPlace(p)}
              style={({ pressed: isPressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 18, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, isPressed && { backgroundColor: c.sand }]}
            >
              <Ionicons name="location-outline" size={18} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{p.name}</Text>
                {p.address ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{p.address}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {state === 'done' || state === 'error' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Pick the neighbourhood to show it on the map.')}</Text> : null}
    </View>
  );
}
