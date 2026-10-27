import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused, useRouter } from 'expo-router';
import { Children, createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Image, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, useWindowDimensions, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { Text, TextInput } from './ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { photoSrc } from '@/lib/api';
import { headerGap, statusTop, useLayout } from '@/lib/layout';
import { sc, useScale } from '@/lib/scale';
import { PageTransition } from './PageTransition';
import { SkeletonRows } from './Skeleton';
import { useDockSpace } from '@/lib/dock';
import { formatDay, useKeyboardInset, useKeyboardShown, useScrollFieldIntoView } from '@/lib/keyboard';
import { useTheme } from '@/lib/theme';

// ---------------------------------------------------------------- layout
/** Shared press feedback: a crisp 3% shrink and a light dim. Transform and opacity only, so it never reflows. */
export const pressed = (p: boolean) => (p ? { opacity: 0.88, transform: [{ scale: 0.97 }] } : null);

// Lists ask to be told when the reader gets near the end of the page, so they can draw the next batch (see lib/paged).
// One shared signal: the page that is in front sends it (a page out of sight never does).
const endListeners = new Set<() => void>();
/** Calls `fn` whenever the page in front is scrolled close to its end, or is too short to scroll at all. */
export function useOnScrollEnd(fn: () => void) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    const f = () => latest.current();
    endListeners.add(f);
    return () => void endListeners.delete(f);
  }, []);
}

export function Screen({
  header, children,
  hasHeader = false,
  scroll = true,
  tabBar = false,
  wide = false,
  maxWidth,
  hero,
  stickyHero,
  onRefresh,
  refreshing = false,
  onScrollY,
  style,
}: {
  children: ReactNode;
  /** a full-bleed picture area above the padded content (detail screens) */
  hero?: ReactNode;
  /** a picture area in two pieces: `scrolling` scrolls away with the page, `pinned` scrolls until it reaches the top and then stays there while the rest of the page slides under it. Both are laid out by the system's own sticky header, so they never lag the scroll. */
  stickyHero?: { scrolling: ReactNode; pinned: ReactNode };
  /** stays put at the top while the content scrolls beneath it (the HERE/THERE header on the main tabs) */
  header?: ReactNode;
  /** true when a native header already sits above the content */
  hasHeader?: boolean;
  scroll?: boolean;
  /** true on tab screens, where the tab bar already handles the bottom inset */
  tabBar?: boolean;
  /** feeds and two-pane screens: let the content use up to 1180 px instead of a 760 px reading column */
  wide?: boolean;
  /** override the content column's maximum width (e.g. 520 for sign-in forms) */
  maxWidth?: number;
  /** reports how far the page has scrolled (px), for effects that follow the scroll */
  onScrollY?: (y: number) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  // never closer to the top than a phone's status bar needs (a browser reports no inset, a real phone does)
  const top = statusTop(insets.top);
  const typing = useKeyboardShown();
  const keyboard = useKeyboardInset(); // the page ends at the bottom edge: the keyboard pushes it up by exactly its height
  const scroller = useRef<ScrollViewInstance>(null);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const lastFire = useRef(0);
  const fireEnd = () => {
    if (onScreen) endListeners.forEach((f) => f());
  };
  const scrolled = useRef(0);
  const savedTop = useRef(0);
  const onScreen = useIsFocused();
  useScrollFieldIntoView(scroller, scrolled, onScreen);
  useEffect(() => {
    // the page came back into front: if the phone dropped its scroll position meanwhile, put it back
    if (onScreen && savedTop.current > 40) requestAnimationFrame(() => scrolled.current < savedTop.current - 40 && scroller.current?.scrollTo({ y: savedTop.current, animated: false }));
  }, [onScreen]); // and the field being typed in is scrolled above it
  const dockRoom = useDockSpace();
  const dock = typing ? 0 : dockRoom; // the floating dock covers the bottom of the page, so leave room under the content (it hides while typing)
  const pad = { paddingTop: hasHeader ? 12 : header ? 8 : top + 8, paddingBottom: (tabBar ? 24 : insets.bottom + 24) + dock, paddingHorizontal: gutter };
  // The content sits in a centred column: full width on phones, a comfortable measure on tablets and desktops.
  const columnWidth = maxWidth ?? (wide ? 1180 : 760);
  const column: ViewStyle = { width: '100%', maxWidth: columnWidth, alignSelf: 'center', gap: 16 };
  const body = scroll ? (
    <ScrollView
      ref={scroller}
      // a page too short to scroll (a big screen, a short list) asks for more at once, until it is full. Both sizes are
      // needed, and either can arrive first, so the check runs when either one is known.
      onLayout={(e) => {
        viewH.current = e.nativeEvent.layout.height;
        if (contentH.current && contentH.current < viewH.current) fireEnd();
      }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ flexGrow: 1 }, hero || stickyHero ? { paddingBottom: pad.paddingBottom } : pad, style]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      stickyHeaderIndices={stickyHero ? [1] : undefined}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrolled.current = e.nativeEvent.contentOffset.y;
        const m = e.nativeEvent;
        if (m.contentSize.height - m.contentOffset.y - m.layoutMeasurement.height < 600 && Date.now() - lastFire.current > 150) {
          lastFire.current = Date.now();
          fireEnd(); // near the end: the next batch is shown before the reader gets there
        }
        if (onScreen) savedTop.current = scrolled.current; // only while the page is in front: a reset after it left must not overwrite it
        onScrollY?.(scrolled.current);
      }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {/* an array, not a fragment: the ScrollView counts its direct children to find the sticky one */}
      {stickyHero ? [
        <View key="scrolling" style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>{stickyHero.scrolling}</View>,
        <View key="pinned" style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>{stickyHero.pinned}</View>,
      ] : hero ? (
        <View style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>{hero}</View>
      ) : null}
      {/* its own height is the real height of the content (the scroll area itself is stretched to fill the screen, so it
          cannot tell a short page from a full one): whenever it changes, a short page asks for more */}
      <View
        onLayout={(e) => {
          contentH.current = e.nativeEvent.layout.height;
          if (viewH.current && contentH.current < viewH.current) fireEnd();
        }}
        style={[column, hero || stickyHero ? { paddingHorizontal: gutter, paddingTop: 16 } : null]}
      >
        {children}
      </View>
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, pad, style]}>
      <View style={[column, { flex: 1 }]}>{children}</View>
    </View>
  );
  return (
    <Animated.View style={{ flex: 1, backgroundColor: c.bg, paddingBottom: keyboard }}>
      {header ? (
        <View style={{ paddingTop: top + headerGap, paddingBottom: 6, paddingHorizontal: gutter + 6, backgroundColor: c.bg, zIndex: 2 }}>
          <View style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>{header}</View>
        </View>
      ) : null}
      <PageTransition>{body}</PageTransition>
    </Animated.View>
  );
}

/**
 * Cards in as many columns as fit: one on phones, two on tablets, three on wide screens.
 * It measures its own width, so it also adapts when a side navigation rail takes some space.
 */
export function Grid({ children, min = 330, gap = 12 }: { children: ReactNode; min?: number; gap?: number }) {
  const [w, setW] = useState(0);
  const cols = w ? Math.max(1, Math.min(3, Math.floor((w + gap) / (min + gap)))) : 1;
  const itemWidth = cols === 1 ? '100%' : (w - gap * (cols - 1)) / cols;
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {Children.toArray(children).map((child, i) => (
        <View key={i} style={{ width: itemWidth as number }}>
          {child}
        </View>
      ))}
    </View>
  );
}

/** Two panes on wide screens (filters | results), stacked on phones and small tablets. */
export function Split({ left, right, leftWidth = 380 }: { left: ReactNode; right: ReactNode; leftWidth?: number }) {
  const { isWide } = useLayout();
  if (!isWide)
    return (
      <>
        {left}
        {right}
      </>
    );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 20 }}>
      <View style={{ width: leftWidth, gap: 14 }}>{left}</View>
      <View style={{ flex: 1, gap: 12 }}>{right}</View>
    </View>
  );
}

export const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.row, style]}>{children}</View>;
export const Between = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.row, s.between, style]}>{children}</View>;

// ---------------------------------------------------------------- text
type Variant = 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'muted' | 'label';
export function Txt({ children, variant = 'body', style, bold, color, numberOfLines, accessibilityRole }: { children: ReactNode; variant?: Variant; style?: StyleProp<TextStyle>; bold?: boolean; color?: string; numberOfLines?: number; accessibilityRole?: 'header' }) {
  const { c } = useTheme();
  return (
    <Text accessibilityRole={accessibilityRole} numberOfLines={numberOfLines} style={[{ color: c.text, fontSize: 14, lineHeight: 20 }, textStyles[variant], variant === 'muted' || variant === 'small' ? { color: c.muted } : null, bold ? { fontWeight: '700' } : null, color ? { color } : null, style]}>
      {children}
    </Text>
  );
}
const textStyles: Record<Variant, TextStyle> = {
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '800' },
  h2: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  h3: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  body: {},
  label: { fontSize: 13, fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 17 },
  muted: { fontSize: 13, lineHeight: 18 },
};

// ---------------------------------------------------------------- buttons & inputs
type BtnVariant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost' | 'light' | 'mint' | 'outlineLight' | 'ghostLight';
export function Btn({ title, onPress, variant = 'primary', disabled, loading, small, style }: { title: string; onPress?: () => void; variant?: BtnVariant; disabled?: boolean; loading?: boolean; small?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const look: Record<BtnVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.forest, fg: '#fff', border: c.forest },
    accent: { bg: c.accent, fg: c.onAccent, border: c.accent },
    secondary: { bg: c.surface, fg: c.text, border: c.line },
    danger: { bg: c.surface, fg: c.danger, border: c.danger },
    ghost: { bg: 'transparent', fg: c.muted, border: 'transparent' },
    light: { bg: '#fff', fg: c.forest, border: '#fff' },
    mint: { bg: '#A6E1C8', fg: c.forest, border: '#A6E1C8' },
    outlineLight: { bg: 'transparent', fg: '#fff', border: '#8FB3A8' },
    ghostLight: { bg: 'transparent', fg: '#B9CFC8', border: 'transparent' },
  };
  const v = look[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      hitSlop={3}
      onPress={onPress}
      style={({ pressed: isPressed }) => [s.btn, small && s.btnSmall, { minHeight: sc(small ? 34 : 42) }, { backgroundColor: v.bg, borderColor: v.border, opacity: off ? 0.5 : 1 }, style, !off && pressed(isPressed)]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={{ color: v.fg, fontWeight: '700', fontSize: small ? 13 : 14 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, error, icon, style, ...rest }: TextInputProps & { label: string; hint?: string; error?: string | null; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Txt variant="label">{label}</Txt>
      <View>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.placeholder}
          {...rest}
          style={[s.input, { minHeight: sc(42) }, { backgroundColor: c.surface, borderColor: error ? c.danger : c.line, color: c.text }, icon ? { paddingRight: 44 } : null, rest.multiline && { minHeight: 92, textAlignVertical: 'top' }, style]}
        />
        {/* a small icon on the right edge of the field (clock, people, pin…) */}
        {icon ? <Ionicons name={icon} size={22} color={c.muted} style={{ position: 'absolute', right: 14, top: 13 }} pointerEvents="none" /> : null}
      </View>
      {hint && !error ? <Txt variant="small">{hint}</Txt> : null}
      {error ? <Txt variant="small" color={c.danger}>{error}</Txt> : null}
    </View>
  );
}

/** A date typed as digits: the dashes are put in for you (YYYY-MM-DD), on every phone's number keypad. */
export function DateField({ onChangeText, ...rest }: Omit<React.ComponentProps<typeof Field>, 'keyboardType' | 'maxLength'>) {
  return <Field {...rest} keyboardType="number-pad" maxLength={10} autoComplete="off" onChangeText={(v) => onChangeText?.(formatDay(v))} />;
}

/** A tinted rounded square holding an icon: the leading element of list rows. */
export function IconTile({ name, size: base = 36 }: { name: React.ComponentProps<typeof Ionicons>['name']; size?: number }) {
  const { c } = useTheme();
  const size = base * useScale();
  return (
    <View style={{ width: size, height: size, borderRadius: 11, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size * 0.5} color={c.forest} />
    </View>
  );
}

/** Flat list row: icon tile, title, subtitle, optional trailing element, hairline below. */
export function ListRow({ icon, title, subtitle, right, onPress, last }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; last?: boolean }) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.line }}>
      <IconTile name={icon} />
      <View style={{ flex: 1 }}>
        <Txt variant="h3" style={{ fontSize: 14, lineHeight: 19 }}>{title}</Txt>
        {subtitle ? <Txt variant="small" numberOfLines={2}>{subtitle}</Txt> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>{body}</Pressable>
  ) : (
    body
  );
}

/** Thin filled bar: "4 of 6 approved". */
export function ProgressBar({ value, max }: { value: number; max: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max, now: value }} style={{ height: 8, borderRadius: 4, backgroundColor: c.accentSoft, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%`, height: 8, backgroundColor: c.green }} />
    </View>
  );
}

/** Rounded search field with a magnifier, no visible label (the accessibility label still names it). */
export function SearchBar({ value, onChangeText, placeholder, onFilter, filterActive }: { value: string; onChangeText: (v: string) => void; placeholder: string; /** shows a round filter button at the right end */ onFilter?: () => void; filterActive?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[s.search, { minHeight: sc(42), backgroundColor: c.surface, borderColor: c.line }]}>
      <Ionicons name="search-outline" size={17} color={c.muted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.placeholder}
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={{ flex: 1, fontSize: 14, color: c.text, paddingVertical: 0, minHeight: 24 }}
      />
      {onFilter ? (
        <Pressable accessibilityRole="button" accessibilityLabel={filterActive ? 'Filters, on' : 'Filters'} onPress={onFilter} hitSlop={6} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: filterActive ? c.forest : c.sand, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="options-outline" size={18} color={filterActive ? '#fff' : c.forest} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Section title with an optional action on the right ("Happening soon" … "Next 2 hours ⌄"). */
export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={[s.row, s.between]}>
      <Txt variant="h2" accessibilityRole="header">{title}</Txt>
      {right}
    </View>
  );
}

export function Pill({ label, active, onPress, icon }: { label: string; active?: boolean; onPress: () => void; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} hitSlop={6} onPress={onPress} style={({ pressed: isPressed }) => [s.pill, { minHeight: sc(32), backgroundColor: active ? c.forest : c.surface, borderColor: active ? c.forest : c.line }, pressed(isPressed)]}>
      {icon ? <Ionicons name={icon} size={15} color={active ? '#fff' : c.text} style={{ marginRight: 6 }} /> : null}
      <Text style={{ color: active ? '#fff' : c.text, fontWeight: '600', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** Horizontal scrolling row of pills (category filters, time chips…). */
export function PillRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !!disabled }} disabled={disabled} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', opacity: disabled ? 0.6 : 1 }}>
      <View style={[s.check, { borderColor: checked ? c.forest : c.muted, backgroundColor: checked ? c.forest : 'transparent' }]}>{checked ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string }) {
  const { c } = useTheme();
  const bump = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <View style={{ gap: 4 }}>
      <Txt variant="label">{label}</Txt>
      <View style={[s.row, { gap: 14 }]}>
        <Pressable accessibilityLabel={`Decrease ${label}`} onPress={() => bump(-1)} style={[s.stepBtn, { borderColor: c.line, backgroundColor: c.surface }]}><Text style={s.stepTxt}>−</Text></Pressable>
        <Txt variant="h2">{value}</Txt>
        <Pressable accessibilityLabel={`Increase ${label}`} onPress={() => bump(1)} style={[s.stepBtn, { borderColor: c.line, backgroundColor: c.surface }]}><Text style={s.stepTxt}>+</Text></Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- surfaces
export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const { c } = useTheme();
  const look = [s.card, { backgroundColor: c.surface, borderColor: c.line }, style];
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed: isPressed }) => [look, pressed(isPressed)]}>
      {children}
    </Pressable>
  ) : (
    <View style={look}>{children}</View>
  );
}

type Tone = 'info' | 'ok' | 'warn' | 'bad';
export function Banner({ children, tone = 'info', onPress }: { children: ReactNode; tone?: Tone; onPress?: () => void }) {
  const { c } = useTheme();
  const t = { info: [c.infoBg, c.infoFg], ok: [c.okBg, c.okFg], warn: [c.warnBg, c.warnFg], bad: [c.badBg, c.badFg] }[tone];
  const body = <Text style={{ color: t[1], fontSize: 14, lineHeight: 20 }}>{children}</Text>;
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={[s.banner, { backgroundColor: t[0] }]}>{body}</Pressable>
  ) : (
    <View accessibilityRole={tone === 'bad' ? 'alert' : undefined} style={[s.banner, { backgroundColor: t[0] }]}>{body}</View>
  );
}
export const ErrorBanner = ({ message }: { message?: string | null }) => (message ? <Banner tone="bad">{message}</Banner> : null);

export function Chip({ label, tone = 'info' }: { label: string; tone?: Tone | 'neutral' }) {
  const { c } = useTheme();
  const t = { neutral: [c.infoBg, c.infoFg], info: [c.infoBg, c.infoFg], ok: [c.okBg, c.okFg], warn: [c.warnBg, c.warnFg], bad: [c.badBg, c.badFg] }[tone];
  return (
    <View style={[s.chip, { backgroundColor: t[0] }]}>
      <Text style={{ color: t[1], fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[s.empty, { borderColor: c.line }]}>
      <Txt variant="h3">{title}</Txt>
      {children ? <Txt variant="muted" style={{ textAlign: 'center' }}>{children}</Txt> : null}
    </View>
  );
}

/** What every page shows while its content loads: grey blocks in the shape of the content, never a spinner. */
export const Spinner = ({ rows = 4 }: { rows?: number; label?: string }) => <SkeletonRows count={rows} />;

/** Soft green-led tints behind the initial, picked from the name so each person keeps the same colour everywhere. */
const AVATAR_TINTS = ['#D9EBE2', '#CFE3DA', '#DCE8D2', '#D3E4E6', '#E2E4EF', '#E6E9D8'];
/** A person's picture when they have one, otherwise their initial. */
export function Avatar({ name, size: base = 44, uri }: { name?: string; size?: number; uri?: string | null }) {
  const { c } = useTheme();
  const size = base * useScale();
  const [failed, setFailed] = useState(false);
  const tint = AVATAR_TINTS[[...(name ?? '?')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TINTS.length];
  const src = photoSrc(uri);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src && !failed ? (
        <Image source={{ uri: src }} resizeMode="cover" onError={() => setFailed(true)} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ color: c.forest, fontWeight: '800', fontSize: size * 0.42 }}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
      )}
    </View>
  );
}

/** Bottom sheet. Closes on backdrop tap, the Android back button, a tap on its top edge, or by dragging that edge down. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();
  const { height } = useWindowDimensions();
  // like a page: the sheet ends where the keyboard begins, and the field being typed in scrolls into view above it
  const keyboard = useKeyboardInset();
  const typing = useKeyboardShown();
  const body = useRef<ScrollViewInstance>(null);
  const bodyY = useRef(0);
  useScrollFieldIntoView(body, bodyY, visible, true);
  const [mounted, setMounted] = useState(visible);
  const slide = useRef(new Animated.Value(0)).current; // 0 away, 1 in place
  const shade = useRef(new Animated.Value(0)).current; // the dark backdrop, separate from the sheet
  const reduce = useRef(false);
  // what the sheet showed while open, so it does not change or empty out while it slides away
  const shown = useRef({ title, children });
  if (visible) shown.current = { title, children };
  // how far the reader has pulled the sheet down with a finger (on top of its slide-in position)
  const drag = useRef(new Animated.Value(0)).current;
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  // the top edge (grab bar and title) is the handle: a tap or a pull down past ~80px (or a quick flick) closes the sheet
  const handle = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8 || (Math.abs(g.dy) < 6 && Math.abs(g.dx) < 6)) closeNow.current();
        else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    }),
  ).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => (reduce.current = r))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const t = (ms: number) => (reduce.current ? 1 : ms);
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      slide.setValue(0);
      shade.setValue(0);
      Animated.parallel([
        // the sheet rises from the bottom edge...
        Animated.timing(slide, { toValue: 1, duration: t(300), easing: Easing.bezier(0.22, 0.9, 0.28, 1), useNativeDriver: true }),
        // ...and the dark shade only fades in during its last stretch, so nothing dark slides up with it
        Animated.timing(shade, { toValue: 1, duration: t(200), delay: reduce.current ? 0 : 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slide, { toValue: 0, duration: t(230), easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(shade, { toValue: 0, duration: t(170), useNativeDriver: true }),
      ]).start(({ finished }) => finished && setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;
  const rise = isTablet ? slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) : slide.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={{ flex: 1, justifyContent: isTablet ? 'center' : 'flex-end', paddingBottom: keyboard }}>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,20,17,0.45)', opacity: shade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        {/* a bottom sheet on phones; a centred dialog on tablets and desktops */}
        <Animated.View
          style={[
            s.sheet,
            { backgroundColor: c.surface, paddingBottom: typing ? 16 : insets.bottom + 16, transform: [{ translateY: isTablet ? rise : Animated.add(rise, drag) }] },
            isTablet && { alignSelf: 'center', width: 560, maxWidth: '92%', borderRadius: 22, paddingBottom: 18, opacity: slide },
          ]}
        >
          {isTablet ? (
            <Txt variant="h2">{shown.current.title}</Txt>
          ) : (
            // grab bar plus title: the part to tap or pull down. Padding makes the touch area generous.
            <View {...handle.panHandlers} accessible accessibilityRole="button" accessibilityLabel="Close" style={{ marginTop: -18, paddingTop: 10, paddingBottom: 4, gap: 10 }}>
              <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line }} />
              <Txt variant="h2">{shown.current.title}</Txt>
            </View>
          )}
          <ScrollView ref={body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" scrollEventThrottle={16} onScroll={(e) => (bodyY.current = e.nativeEvent.contentOffset.y)} contentContainerStyle={{ gap: 12 }}>{shown.current.children}</ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/** Navigate by path string, e.g. go(`/activity/${id}`). */
export function useGo() {
  const r = useRouter();
  return (path: string) => r.push(path as never);
}

const s = StyleSheet.create({
  screen: { paddingHorizontal: 16, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { justifyContent: 'space-between' },
  btn: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 34, paddingVertical: 5, paddingHorizontal: 12 },
  input: { minHeight: 42, borderWidth: 1.5, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  pill: { minHeight: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  stepBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 22, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  banner: { padding: 12, borderRadius: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12, maxHeight: '88%' },
});
