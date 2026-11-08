import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DockSpace } from '@/lib/dock';
import { useMe } from '@/lib/auth';
import { useKeyboardOverlap, keyboardTaps } from '@/lib/keyboard';
import { useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';
import { sc, tracking } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { TRIP_PHOTOS } from './Cards';
import { RoundPhoto } from './CreateParts';
import { Text, TextInput } from './ScaledText';
import { Avatar, Btn, pressed, Sheet, Field } from './ui';

/** THERE's pieces from the Figma pages (home, search and the filter sheet), shared by ExploreThere and SearchThere. */

const WAVE = '👋';

/** The wordmark "THERE." with its tagline under it (Figma). */
export function ThereBrand() {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View style={{ gap: 3 }}>
      <Text accessibilityRole="header" accessibilityLabel="THERE" style={{ color: c.onBand, fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: tracking(-1) }}>
        THERE<Text style={{ color: c.bandDot }}>.</Text>
      </Text>
      <Text style={{ color: c.onBandMuted, fontSize: 12, lineHeight: 16 }}>{t('Be Here.Go There.')}</Text>
    </View>
  );
}

/** The home header: the brand on the left, the city you are in on the right (tap it to change the city). */
export function ThereHomeHeader({ city, onPickCity }: { city: string; onPickCity: (c: string) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(city);
  const router = useRouter();
  const { me } = useMe();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <ThereBrand />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('City: {city}. Change city', { city })} hitSlop={8} onPress={() => (setV(city), setOpen(true))} style={({ pressed: p }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 }, p && { opacity: 0.8 }]}>
        <Ionicons name="location-outline" size={15} color={c.bandPin} />
        <Text numberOfLines={1} style={{ color: c.onBand, fontWeight: '600', fontSize: 16, lineHeight: 20, includeFontPadding: false, maxWidth: 130 }}>{city}</Text>
        <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: 16, lineHeight: 20, includeFontPadding: false }}>{WAVE}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Profile')} hitSlop={6} onPress={() => router.navigate('/profile' as never)}>
        <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={36} />
      </Pressable>
      </View>
      <Sheet visible={open} title={t('Choose your city')} onClose={() => setOpen(false)}>
        <Field label={t('City')} value={v} onChangeText={setV} autoFocus />
        <Btn
          title={t('Use this city')}
          disabled={v.trim().length < 2}
          onPress={() => {
            onPickCity(v.trim());
            setOpen(false);
          }}
        />
      </Sheet>
    </View>
  );
}

/**
 * The white search pill. `home`: a dark round filter button sits outside it. `inline`: a clear (X) button, a thin divider and
 * the filter icon sit inside it (the search page). A small dot on the filter says a filter is on.
 */
export function ThereSearchField({ value, onChangeText, placeholder, onSubmit, onClear, onFilter, filterActive, inline }: { value: string; onChangeText: (v: string) => void; placeholder: string; onSubmit?: () => void; onClear?: () => void; onFilter?: () => void; filterActive?: boolean; inline?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  const dot = filterActive ? <View style={{ position: 'absolute', top: inline ? 6 : 1, right: inline ? 6 : 1, width: 11, height: 11, borderRadius: 6, backgroundColor: c.accent, borderWidth: 2, borderColor: inline ? c.surface : c.bg }} /> : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, minHeight: sc(55), borderRadius: 28, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 20, paddingRight: inline ? 10 : 16 }}>
        <Ionicons name="search-outline" size={20} color={c.muted} />
        <TextInput
          accessibilityLabel={placeholder}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          placeholder={placeholder}
          placeholderTextColor={c.placeholder}
          returnKeyType="search"
          style={{ flex: 1, fontSize: inline ? 15 : 15.5, color: c.forest, paddingVertical: 0, minHeight: 24, includeFontPadding: false, textAlignVertical: 'center' }}
        />
        {inline ? (
          <>
            {value ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('Clear search')} hitSlop={4} onPress={onClear} style={{ width: 36, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={20} color={c.text} />
              </Pressable>
            ) : null}
            {value && onFilter ? <View style={{ width: 1, height: 19, backgroundColor: 'rgba(0,0,0,0.19)' }} /> : null}
            {onFilter ? (
              <Pressable accessibilityRole="button" accessibilityLabel={filterActive ? t('Filters, on') : t('Filters')} hitSlop={4} onPress={onFilter} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="options-outline" size={22} color={c.text} />
                {dot}
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
      {!inline && onFilter ? (
        <Pressable accessibilityRole="button" accessibilityLabel={filterActive ? t('Filters, on') : t('Filters')} onPress={onFilter} hitSlop={4} style={({ pressed: p }) => [{ width: sc(49), height: sc(49), borderRadius: 25, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}>
          <Ionicons name="options-outline" size={22} color="#fff" />
          {dot}
        </Pressable>
      ) : null}
    </View>
  );
}

/** The travel styles that have a picture, in the order of the design. */
export const TRIP_STYLES = ['adventure', 'nature', 'beach', 'photography'] as const;
const styleLabel = (k: string) => k[0].toUpperCase() + k.slice(1);

/** The row of round-photo chips under the search (Figma): tap one to show only trips of that style; tap it again to clear. */
export function TripStyleChips({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const { gutter } = useLayout();
  return (
    <ScrollView horizontal overScrollMode="never" showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 10, paddingVertical: 3 }}>
      {TRIP_STYLES.map((k) => {
        const on = value === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(styleLabel(k))}
            onPress={() => onChange(on ? null : k)}
            style={({ pressed: p }) => [{ borderRadius: 999, borderWidth: 1, borderColor: on ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: sc(8), paddingVertical: sc(3), paddingLeft: sc(3), paddingRight: sc(14) }, pressed(p)]}
          >
            <RoundPhoto source={TRIP_PHOTOS[k]} size={sc(36)} ring={on} />
            <Text numberOfLines={1} style={{ color: on ? '#fff' : c.forest, fontSize: 14, includeFontPadding: false }}>{t(styleLabel(k))}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- the filter sheet

/** A pill choice for the filter sheet: deep green when chosen, white when not. */
export function ThereChip({ label, active, onPress, spoken }: { label: string; active: boolean; onPress: () => void; spoken?: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: 44, paddingHorizontal: 20, borderRadius: 22, borderWidth: 1, borderColor: active ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: active ? c.forest : c.surface, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}
    >
      <Text style={{ color: active ? '#fff' : c.forest, fontSize: 15, lineHeight: 20, includeFontPadding: false, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

/** The small heading above a group of filter fields. */
export function ThereLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '500' }}>{children}</Text>;
}

/** A labelled white pill to type in. */
export function ThereInput({ label, value, onChangeText, placeholder, ...rest }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string } & Omit<React.ComponentProps<typeof TextInput>, 'style'>) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <ThereLabel>{label}</ThereLabel>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={c.placeholder} {...rest} style={{ minHeight: sc(55), borderRadius: 28, backgroundColor: c.surface, paddingHorizontal: 17, paddingVertical: 0, fontSize: 16, color: c.text, includeFontPadding: false, textAlignVertical: 'center' }} />
    </View>
  );
}

/** A labelled white pill that opens the calendar; it reads DD-MM-YYYY (or the hint while empty). */
export function ThereDateBox({ label, date, onPress, spoken }: { label: string; date: Date | null; onPress: () => void; spoken: string }) {
  const { c } = useTheme();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const { t } = useT();
  return (
    <View style={{ flex: 1, gap: 12 }}>
      <ThereLabel>{label}</ThereLabel>
      <Pressable accessibilityRole="button" accessibilityLabel={spoken} onPress={onPress} style={({ pressed: p }) => [{ minHeight: sc(55), borderRadius: 28, backgroundColor: c.surface, paddingHorizontal: 17, justifyContent: 'center' }, pressed(p)]}>
        <Text style={{ fontSize: 16, color: date ? c.text : c.placeholder }}>{date ? `${p2(date.getDate())}-${p2(date.getMonth() + 1)}-${date.getFullYear()}` : t('DD-MM-YYYY')}</Text>
      </Pressable>
    </View>
  );
}

/**
 * A slider for the most a trip may cost per person (the app filters by a ceiling, so there is one handle). Drag it, tap the
 * track, or use the screen reader's up/down. The far right end means no limit.
 */
export function ThereBudgetSlider({ value, onChange, min = 300, max = 5000, step = 100 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  const { c } = useTheme();
  const { t } = useT();
  const [w, setW] = useState(0);
  const start = useRef(value);
  const live = useRef({ w, value, onChange, min, max, step });
  live.current = { w, value, onChange, min, max, step };
  const snap = (v: number) => Math.min(live.current.max, Math.max(live.current.min, Math.round(v / live.current.step) * live.current.step));
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const L = live.current;
        if (!L.w) return;
        // a tap on the track puts the handle there; a drag then moves it from that place
        const v = snap(L.min + (e.nativeEvent.locationX / L.w) * (L.max - L.min));
        start.current = v;
        L.onChange(v);
      },
      onPanResponderMove: (_, g) => {
        const L = live.current;
        if (!L.w) return;
        L.onChange(snap(start.current + (g.dx / L.w) * (L.max - L.min)));
      },
    }),
  ).current;
  const frac = (value - min) / (max - min);
  const H = 22;
  const label = value >= max ? t('Any budget') : t('Up to {amount}', { amount: `€ ${value}` });
  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 22, justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: Math.min(Math.max(frac * w - 50, 0), Math.max(0, w - 100)), width: 100, alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{label}</Text>
        </View>
      </View>
      <View
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={t('Budget per person')}
        accessibilityValue={{ min, max, now: value, text: label }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step)))}
        style={{ height: 44, justifyContent: 'center', marginHorizontal: H / 2 }}
      >
        <View style={{ height: 10, borderRadius: 5, backgroundColor: '#fff' }} />
        <View style={{ position: 'absolute', left: 0, width: frac * w, height: 10, borderRadius: 5, backgroundColor: c.forest }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: frac * w - H / 2, width: H, height: H, borderRadius: H / 2, backgroundColor: '#fff', borderWidth: 2, borderColor: c.forest }} />
        {/* the touch layer: one transparent strip over the whole track, so positions are measured against the track */}
        <View {...pan.panHandlers} style={StyleSheet.absoluteFill} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: c.text, fontSize: 12 }}>€{min}</Text>
        <Text style={{ color: c.text, fontSize: 12 }}>€{max}+</Text>
      </View>
    </View>
  );
}

/**
 * The Filter sheet (Figma): an ivory sheet with big rounded top corners, "Filter" and a close X over a hairline, the fields
 * in a scrolling body, and the action buttons pinned at the bottom. `overlay` is drawn above the sheet (the calendar).
 */
export function ThereFilterSheet({ visible, onClose, children, footer, overlay }: { visible: boolean; onClose: () => void; children: ReactNode; footer: ReactNode; overlay?: ReactNode }) {
  const { c } = useTheme();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { isTablet } = useLayout();
  const { inset: keyboard, box, onLayout } = useKeyboardOverlap();
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(0)).current;
  const reduce = useRef(false);
  const shown = useRef({ children, footer, overlay });
  if (visible) shown.current = { children, footer, overlay };
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => (reduce.current = r))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const ms = (n: number) => (reduce.current ? 1 : n);
    if (visible) {
      setMounted(true);
      slide.setValue(0);
      Animated.timing(slide, { toValue: 1, duration: ms(300), easing: Easing.bezier(0.22, 0.9, 0.28, 1), useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(slide, { toValue: 0, duration: ms(220), easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => finished && setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <DockSpace.Provider value={0}>
        <Animated.View ref={box} onLayout={onLayout} style={{ flex: 1, justifyContent: isTablet ? 'center' : 'flex-end', paddingBottom: keyboard }}>
          <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,20,17,0.45)', opacity: slide }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Close')} />
          </Animated.View>
          <Animated.View
            accessibilityViewIsModal
            style={[
              { backgroundColor: c.bg, borderTopLeftRadius: 44, borderTopRightRadius: 44, height: height * 0.9, overflow: 'hidden', transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] },
              isTablet && { alignSelf: 'center', width: 560, maxWidth: '92%', borderRadius: 30, height: Math.min(height * 0.9, 760), opacity: slide },
            ]}
          >
            <View style={{ paddingHorizontal: 20, paddingTop: 22 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 20, lineHeight: 26, fontWeight: '600' }}>{t('Filter')}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} hitSlop={6} onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 }}>
                  <Ionicons name="close" size={22} color={c.text} />
                </Pressable>
              </View>
              <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.12)', marginTop: 8 }} />
            </View>
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 20, gap: 26 }}>
              {shown.current.children}
            </ScrollView>
            <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: insets.bottom + 16, gap: 8, borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', backgroundColor: c.bg }}>{shown.current.footer}</View>
          </Animated.View>
          {shown.current.overlay}
        </Animated.View>
      </DockSpace.Provider>
    </Modal>
  );
}
