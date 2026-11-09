import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useIsFocused, useRoute, useRouter } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { Children, createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Modal, type NativeScrollEvent, type NativeSyntheticEvent, PanResponder, Platform, Pressable, RefreshControl, ScrollView, type ScrollViewInstance, StyleSheet, useWindowDimensions, View, type StyleProp, type TextInput as RNTextInputType, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { Text, TextInput } from './ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { photoSrc } from '@/lib/api';
import { tap } from '@/lib/haptics';
import { headerGap, statusTop, useLayout } from '@/lib/layout';
import { sc, useScale } from '@/lib/scale';
import { PageTransition } from './PageTransition';
import { SkeletonRows } from './Skeleton';
import { useDockSpace } from '@/lib/dock';
import { setScrollPage } from '@/lib/pageScroll';
import { formatDay, useKeyboardOverlap, useKeyboardShown, useScrollFieldIntoView, keyboardTaps } from '@/lib/keyboard';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { PAGE_TITLES, PLAIN_PAGES } from '@/lib/pageTitles';

// ---------------------------------------------------------------- layout
/** Shared press feedback: a crisp 3% shrink and a light dim. Transform and opacity only, so it never reflows. */
/**
 * Android buttons: a 1.5 px border draws heavier there than on iPhone, and the text sits a little tight in the 42 px box, so the
 * border is a fine 1 px and the button has a little more room (it is a pill-like, easy target). iPhone is untouched.
 */
const android = Platform.OS === 'android' ? StyleSheet.create({ btn: { borderWidth: 1, borderRadius: 12, paddingVertical: 8 }, btnSmall: { paddingVertical: 5, borderRadius: 12 } }) : { btn: null, btnSmall: null };

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

/** How far the white sheet rises over a coloured header band (see Screen's headerBg). */
export const SHEET_OVERLAP = 30;
/** Radius of the sheet's rounded top corners. */
const SHEET_RADIUS = 40;
/** Extra band of the home screens, in points: the Figma band is about 50 taller than a title band (22 above the wordmark, 28 under the switch). */
const BAND_TALL_TOP = 22;
const BAND_TALL_BOTTOM = 28;

// Pages that sit on the dark band need light clock and battery. Counted, so whichever page opens or closes first the bar ends right.
let bandPages = 0;
/** Light status-bar text while a page with the dark band is in front; dark again when none is. */
export function useLightStatusBar(on = true, bandDark?: boolean) {
  const { c } = useTheme();
  const dark = bandDark ?? c.bandIsDark; // the band follows the mode: dark green in HERE (light clock), sand in THERE (dark clock)
  useFocusEffect(
    useCallback(() => {
      if (!on) return;
      bandPages += 1;
      setStatusBarStyle(dark ? 'light' : 'dark');
      return () => {
        bandPages -= 1;
        if (bandPages <= 0) setStatusBarStyle('dark');
      };
    }, [on, dark]),
  );
}

/** The round back button of the band: a soft disc with a chevron, both from the band's tokens (44px target). */
export function BandBack({ onBack }: { onBack?: () => void }) {
  const router = useRouter();
  const { t } = useT();
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Go back')}
      hitSlop={6}
      onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/' as never)))}
      style={({ pressed: p }) => [{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.bandBack, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}
    >
      <Ionicons name="chevron-back" size={22} color={c.onBand} />
    </Pressable>
  );
}

/** The static title row of every inner page, for the band: round back button, centred white title, optional action on the right. */
export function BandTitle({ title, onBack, right, custom }: { title?: string; onBack?: () => void; right?: ReactNode; custom?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
      <BandBack onBack={onBack} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {custom ?? <Text accessibilityRole="header" numberOfLines={1} style={{ color: c.onBand, fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' }}>{title}</Text>}
      </View>
      <View style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>{right}</View>
    </View>
  );
}

/** The plain back button of the Figma pages (Settings and what lives inside it, the create wizards): a white disc, a very faint rim, a dark chevron. 44px target. */
export function PlainBack({ onBack }: { onBack?: () => void }) {
  const router = useRouter();
  const { t } = useT();
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Go back')}
      hitSlop={6}
      onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/' as never)))}
      style={({ pressed: p }) => [{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.09)', alignItems: 'center', justifyContent: 'center' }, pressed(p)]}
    >
      <Ionicons name="chevron-back" size={22} color={c.text} />
    </Pressable>
  );
}

/** The plain static header on the page's own background: round back button, centred title in the text colour, optional action at the right. */
export function PlainTitle({ title, onBack, right, custom }: { title?: string; onBack?: () => void; right?: ReactNode; custom?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8 }}>
      <PlainBack onBack={onBack} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {custom ?? <Text accessibilityRole="header" numberOfLines={1} style={{ color: c.text, fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' }}>{title}</Text>}
      </View>
      <View style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}>{right}</View>
    </View>
  );
}

/** the rounded top edge of the card that slides over a fixed picture */
const FIXED_CARD_RADIUS = 28;
/** how far a photo page is pulled down, from its top, before letting go refreshes it (iPhone); the spinner starts to show at PULL_SHOW */
const PULL_TO_REFRESH = 90;
const PULL_SHOW = 45;

export function Screen({
  header, headerBg, plain, bandFade, bandDark, bandTall, title, onBack, right, children,
  hasHeader = false,
  scroll = true,
  tabBar = false,
  wide = false,
  maxWidth,
  hero,
  stickyHero,
  fixedHero,
  onRefresh,
  refreshing = false,
  onScrollY,
  bottomRoom,
  style,
}: {
  children: ReactNode;
  /** a full-bleed picture area above the padded content (detail screens) */
  hero?: ReactNode;
  /** a picture area in two pieces: `scrolling` scrolls away with the page, `pinned` scrolls until it reaches the top and then stays there while the rest of the page slides under it. Both are laid out by the system's own sticky header, so they never lag the scroll. */
  stickyHero?: { scrolling: ReactNode; pinned: ReactNode };
  /** a picture that never moves: it stays at the top, and the page (a card with rounded top corners) slides up over it as it scrolls. `height` is the picture's full height. */
  fixedHero?: { photo: ReactNode; height: number; /** where the card stops rising: its distance from the top of the screen (below the buttons) */ stop: number };
  /** stays put at the top while the content scrolls beneath it (the HERE/THERE header on the main tabs) */
  header?: ReactNode;
  /** a plain header on the page's own background (no band, no sheet; dark status bar). Pages listed in PLAIN_PAGES get it without passing this. */
  plain?: boolean;
  /** a coloured band behind the header (HERE's dark green): the page then rises over it as a white sheet with rounded top corners */
  headerBg?: string;
  /** the taller band of the home screens (Figma): more air above the wordmark and more band under the switch */
  bandTall?: boolean;
  /** the band fades from this colour at the top into headerBg at the bottom (white to mint in the profile design) */
  bandFade?: string;
  /** whether the band is dark (light clock and battery on it); by default it follows the mode */
  bandDark?: boolean;
  /** an inner page's title: draws the shared band (round back button + white title) as the static header. Pages listed in lib/pageTitles get it without passing this. */
  title?: string;
  /** where the band's back button goes (default: back) */
  onBack?: () => void;
  /** an action at the right end of the band's title row */
  right?: ReactNode;
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
  /** height of a fixed bottom bar (BottomBar, safe area included): the content ends just above it instead of the usual bottom padding */
  bottomRoom?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const { t } = useT();
  const routeName = useRoute().name;
  // a page listed in PAGE_TITLES gets the band by itself (its stack header is hidden in the layout)
  const listed = !header && !hero && !stickyHero && !fixedHero ? PAGE_TITLES[routeName] : undefined;
  const bandTitle = !header ? (title ?? (listed ? t(listed) : undefined)) : undefined;
  const isPlain = plain ?? PLAIN_PAGES.has(routeName);
  const bandHeader = header ?? (bandTitle !== undefined ? (isPlain ? <PlainTitle title={bandTitle} onBack={onBack} right={right} /> : <BandTitle title={bandTitle} onBack={onBack} right={right} />) : undefined);
  const bg = bandHeader && !isPlain ? (headerBg ?? c.band) : undefined; // every static header sits on the mode's band (forest in HERE, sand in THERE)
  useLightStatusBar(!!bg, bandDark);
  // never closer to the top than a phone's status bar needs (a browser reports no inset, a real phone does)
  const top = statusTop(insets.top);
  const typing = useKeyboardShown();
  const { inset: keyboard, box: pageBox, onLayout: pageLayout } = useKeyboardOverlap(); // the page ends at the bottom edge: the keyboard pushes it up by what it covers
  const scroller = useRef<ScrollViewInstance>(null);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const lastFire = useRef(0);
  const fireEnd = () => {
    if (onScreen) endListeners.forEach((f) => f());
  };
  const scrolled = useRef(0);
  const fixedY = useRef(new Animated.Value(0)).current; // the scroll position, for the fixed picture's little effects
  const pullFromTop = useRef(false); // the current drag began at the top of a photo page (pull to refresh)
  const savedTop = useRef(0);
  const onScreen = useIsFocused();
  useScrollFieldIntoView(scroller, scrolled, onScreen);
  // the page in front can be scrolled to a field that was missed (see lib/pageScroll)
  useEffect(() => {
    if (!onScreen) return;
    setScrollPage({ scrollTo: (y) => scroller.current?.scrollTo({ y, animated: true }), offset: () => scrolled.current, measureTop: (cb) => (scroller.current ? scroller.current.measureInWindow((_x, y) => cb(y)) : undefined) });
    return () => setScrollPage(null);
  }, [onScreen]);
  useEffect(() => {
    // the page came back into front: if the phone dropped its scroll position meanwhile, put it back
    if (onScreen && savedTop.current > 40) requestAnimationFrame(() => scrolled.current < savedTop.current - 40 && scroller.current?.scrollTo({ y: savedTop.current, animated: false }));
  }, [onScreen]); // and the field being typed in is scrolled above it
  const dockRoom = useDockSpace();
  const dock = typing ? 0 : dockRoom; // the floating dock covers the bottom of the page, so leave room under the content (it hides while typing)
  const pad = { paddingTop: bandHeader ? (bg ? 20 : 8) : hasHeader ? 12 : top + 8, paddingBottom: bottomRoom !== undefined ? bottomRoom + 16 : (tabBar ? 24 : insets.bottom + 24) + dock, paddingHorizontal: gutter };
  // The content sits in a centred column: full width on phones, a comfortable measure on tablets and desktops.
  const columnWidth = maxWidth ?? (wide ? 1180 : 760);
  const column: ViewStyle = { width: '100%', maxWidth: columnWidth, alignSelf: 'center', gap: 16 };
  // a fixed-picture page feeds the scroll position straight to the native side (Animated.event with the native driver), so the picture's
  // grow and dim follow the finger on the UI thread and never wait for the JS thread (which is what lags on a weaker Android)
  const ScrollBox = (fixedHero ? Animated.ScrollView : ScrollView) as typeof ScrollView;
  // every pull-to-refresh in the app comes through here: a light tap the moment the pull is let go and the refresh starts
  const pullRefresh = onRefresh
    ? () => {
        tap('Light');
        onRefresh();
      }
    : undefined;
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrolled.current = e.nativeEvent.contentOffset.y;
    const m = e.nativeEvent;
    if (m.contentSize.height - m.contentOffset.y - m.layoutMeasurement.height < 600 && Date.now() - lastFire.current > 150) {
      lastFire.current = Date.now();
      fireEnd(); // near the end: the next batch is shown before the reader gets there
    }
    if (onScreen) savedTop.current = scrolled.current; // only while the page is in front: a reset after it left must not overwrite it
    onScrollY?.(scrolled.current);
  };
  const body = scroll ? (
    <ScrollBox
      ref={scroller}
      // a page too short to scroll (a big screen, a short list) asks for more at once, until it is full. Both sizes are
      // needed, and either can arrive first, so the check runs when either one is known.
      onLayout={(e) => {
        viewH.current = e.nativeEvent.layout.height;
        if (contentH.current && contentH.current < viewH.current) fireEnd();
      }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ flexGrow: 1 }, hero || stickyHero || fixedHero ? { paddingBottom: pad.paddingBottom } : pad, style]}
      keyboardShouldPersistTaps={keyboardTaps}
     
      stickyHeaderIndices={stickyHero ? [1] : undefined}
      // a picture page starts at the very top edge: iOS must not push the content down by a navigation bar's height (it did, leaving a white band above the photo)
      // a picture page does not stretch when pulled down at the top (no bounce on iPhone, no glow on Android): the picture stays put and only scrolls up. A fixed-picture page is the exception: it gives a little springy pull (and the picture eases larger) so it feels alive even at the top
      {...(hero || stickyHero || fixedHero ? { bounces: !!fixedHero, overScrollMode: fixedHero ? ('always' as const) : ('never' as const), contentInsetAdjustmentBehavior: 'never' as const, automaticallyAdjustContentInsets: false, automaticallyAdjustsScrollIndicatorInsets: false, contentInset: { top: 0, left: 0, bottom: 0, right: 0 }, contentOffset: { x: 0, y: 0 } } : null)}
      scrollEventThrottle={16}
      onScroll={fixedHero ? Animated.event([{ nativeEvent: { contentOffset: { y: fixedY } } }], { useNativeDriver: true, listener: handleScroll as never }) : handleScroll}
      // a photo page: the phone's own spinner would sit on the photo, so it is hidden there and the page's own one shows at the top
      // of the white card instead (below); pulling down still refreshes as anywhere else
      // A photo page refreshes from the white card, not the photo. iPhone: a short pull (about 50 pt, the system's own needs much
      // more) is enough, with the page's own spinner fading in at the top of the card as it is pulled. Android: its pull circle,
      // placed at the top of the card instead of over the photo.
      refreshControl={
        pullRefresh && !(fixedHero && Platform.OS === 'ios') ? (
          <RefreshControl refreshing={!!refreshing} onRefresh={pullRefresh} {...(fixedHero ? { colors: [c.forest], progressViewOffset: Math.max(0, fixedHero.height - FIXED_CARD_RADIUS - fixedHero.stop) } : null)} />
        ) : undefined
      }
      // only a pull that started at the very top counts (a flick back up from further down never refreshes), and only past the line
      onScrollBeginDrag={fixedHero && Platform.OS === 'ios' && onRefresh ? (e) => void (pullFromTop.current = e.nativeEvent.contentOffset.y <= 1) : undefined}
      onScrollEndDrag={fixedHero && Platform.OS === 'ios' && onRefresh ? (e) => void (!refreshing && pullFromTop.current && e.nativeEvent.contentOffset.y < -PULL_TO_REFRESH && pullRefresh?.()) : undefined}
    >
      {/* an array, not a fragment: the ScrollView counts its direct children to find the sticky one */}
      {stickyHero ? [
        <View key="scrolling" style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>
          {stickyHero.scrolling}
        </View>,
        <View key="pinned" style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>{stickyHero.pinned}</View>,
      ] : fixedHero ? [
        // empty room where the fixed picture shows through; the card below it scrolls up over the picture
        <View key="room" pointerEvents="none" style={{ height: fixedHero.height - FIXED_CARD_RADIUS - fixedHero.stop }} />,
        // the card's rounded top edge: it rises with the page, then stays at the stop line while the content scrolls under it
        <View key="edge" pointerEvents="none" style={{ height: FIXED_CARD_RADIUS }} />,
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
        style={[column, hero || stickyHero ? { paddingHorizontal: gutter, paddingTop: 16 } : null, fixedHero ? { flexGrow: 1, backgroundColor: c.bg, paddingHorizontal: gutter, paddingTop: 0, maxWidth: undefined } : null]}
      >
        {fixedHero && onRefresh && Platform.OS === 'ios' ? (
          // the photo page's own pull-to-refresh spinner: floats in the card's rounded top edge (out of the layout, so the content
          // never moves), fades in while pulling and stays while refreshing
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: -FIXED_CARD_RADIUS + 2, left: 0, right: 0, alignItems: 'center', opacity: refreshing ? 1 : fixedY.interpolate({ inputRange: [-PULL_TO_REFRESH, -PULL_SHOW], outputRange: [1, 0], extrapolate: 'clamp' }) }}>
            <ActivityIndicator size="small" color={c.forest} accessibilityLabel={refreshing ? t('Refreshing') : undefined} />
          </Animated.View>
        ) : null}
        {children}
      </View>
    </ScrollBox>
  ) : (
    <View style={[{ flex: 1 }, pad, style]}>
      <View style={[column, { flex: 1 }]}>{children}</View>
    </View>
  );
  return (
    <Animated.View ref={pageBox} onLayout={pageLayout} style={{ flex: 1, backgroundColor: c.bg, paddingBottom: keyboard }}>
      {bandHeader ? (
        <View style={{ paddingTop: top + headerGap + (bandTall && bg ? BAND_TALL_TOP : 0), paddingBottom: (bg ? SHEET_OVERLAP + 6 : 6) + (bandTall && bg ? BAND_TALL_BOTTOM : 0), paddingHorizontal: gutter + 6, backgroundColor: bg ?? c.bg, zIndex: bg ? 0 : 2 }}>
          {/* the fade ends where the sheet's corners start, so the corner pieces (flat `bg`) sit on exactly the same colour */}
          {bg && bandFade ? <LinearGradient pointerEvents="none" colors={[bandFade, bg]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: SHEET_OVERLAP }} /> : null}
          <View style={{ width: '100%', maxWidth: columnWidth, alignSelf: 'center' }}>{bandHeader}</View>
        </View>
      ) : null}
      {bandHeader && bg ? (
        // the page rises over the coloured band as a sheet. It is a plain rectangle (no clip, which left a faint fringe along the curve):
        // the rounded top corners are two band-coloured corner pieces drawn over it, so the curve joins the band exactly.
        <View style={{ flex: 1, marginTop: -SHEET_OVERLAP, zIndex: 1, backgroundColor: c.bg }}>
          <PageTransition>{body}</PageTransition>
          {/* content melts away as it passes under the header: a static overlay (no scroll work), the page colour fading to nothing */}
          <LinearGradient pointerEvents="none" colors={[c.bg, c.fadeFrom]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 26 }} />
          <View pointerEvents="none" style={{ position: 'absolute', top: -1, left: 0, width: SHEET_RADIUS, height: SHEET_RADIUS + 1 }}>
            <Svg width={SHEET_RADIUS} height={SHEET_RADIUS + 1} viewBox={`0 -1 ${SHEET_RADIUS} ${SHEET_RADIUS + 1}`}>
              <Path d={`M0 -1 H${SHEET_RADIUS} V0 A${SHEET_RADIUS} ${SHEET_RADIUS} 0 0 0 0 ${SHEET_RADIUS} Z`} fill={bg} />
            </Svg>
          </View>
          <View pointerEvents="none" style={{ position: 'absolute', top: -1, right: 0, width: SHEET_RADIUS, height: SHEET_RADIUS + 1 }}>
            <Svg width={SHEET_RADIUS} height={SHEET_RADIUS + 1} viewBox={`0 -1 ${SHEET_RADIUS} ${SHEET_RADIUS + 1}`}>
              <Path d={`M0 -1 H${SHEET_RADIUS} V${SHEET_RADIUS} A${SHEET_RADIUS} ${SHEET_RADIUS} 0 0 0 0 0 Z`} fill={bg} />
            </Svg>
          </View>
        </View>
      ) : fixedHero ? (
        <View style={{ flex: 1 }}>
          {/* as the card rises the picture grows downward (its top edge stays put) and dims */}
          <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: fixedHero.height, transform: [{ translateY: fixedY.interpolate({ inputRange: [-200, 0, 400], outputRange: [0, 0, fixedHero.height * 0.06], extrapolate: 'clamp' }) }, { scale: fixedY.interpolate({ inputRange: [-200, 0, 400], outputRange: [1.15, 1, 1.12], extrapolate: 'clamp' }) }] }}>
            {fixedHero.photo}
            <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', opacity: fixedY.interpolate({ inputRange: [-200, 0, 300], outputRange: [0, 0, 0.3], extrapolate: 'clamp' }) }} />
          </Animated.View>
          <View style={{ flex: 1, marginTop: fixedHero.stop, overflow: 'hidden', borderTopLeftRadius: FIXED_CARD_RADIUS, borderTopRightRadius: FIXED_CARD_RADIUS }}>
            {/* the card itself (its colour and rounded top): it rises with the scroll to the stop line and never moves when the page is pulled down, so only the contents spring */}
            <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg, borderTopLeftRadius: FIXED_CARD_RADIUS, borderTopRightRadius: FIXED_CARD_RADIUS, transform: [{ translateY: fixedY.interpolate({ inputRange: [0, Math.max(1, fixedHero.height - FIXED_CARD_RADIUS - fixedHero.stop)], outputRange: [Math.max(1, fixedHero.height - FIXED_CARD_RADIUS - fixedHero.stop), 0], extrapolate: 'clamp' }) }] }} />
            <PageTransition>{body}</PageTransition>
            {/* content melts away as it slides up into the card's rounded top edge: the same soft fade as the Profile page (a fixed overlay, no scroll work) */}
            {/* shown only once the card has risen to its stop line (scroll = the empty room above the card); before that it would wash over the picture */}
            <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 34, opacity: fixedY.interpolate({ inputRange: [fixedHero.height - FIXED_CARD_RADIUS - fixedHero.stop - 1, fixedHero.height - FIXED_CARD_RADIUS - fixedHero.stop + 24], outputRange: [0, 1], extrapolate: 'clamp' }) }}>
              <LinearGradient colors={[c.bg, c.fadeFrom]} style={{ flex: 1 }} />
            </Animated.View>
          </View>
        </View>
      ) : (
        <PageTransition>{body}</PageTransition>
      )}
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
/**
 * The fixed action bar at the bottom of a detail page: one opaque block down to the screen's edge (the safe-area inset is inside it),
 * with a soft fade above it so the scrolling page melts away instead of being cut. It reports its own height (`onHeight`) for
 * Screen's `bottomRoom`, so the last item can scroll fully clear of it.
 */
export function BottomBar({ children, onHeight }: { children: ReactNode; onHeight: (h: number) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  return (
    <View onLayout={(e) => onHeight(Math.round(e.nativeEvent.layout.height))} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: c.bg, paddingTop: 8, paddingBottom: insets.bottom + 8, paddingHorizontal: gutter, alignItems: 'center' }}>
      <LinearGradient pointerEvents="none" colors={[c.fadeFrom, c.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', height: 26 }} />
      <View style={{ width: '100%', maxWidth: 760, gap: 6 }}>{children}</View>
    </View>
  );
}

type BtnVariant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost' | 'light' | 'mint' | 'outlineLight' | 'ghostLight' | 'off';
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
    // not ready yet: plainly grey (not a faded green), so it reads as "not yet" at a glance
    off: { bg: '#E3E3E0', fg: '#9A9F9C', border: '#E3E3E0' },
  };
  const v = look[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      hitSlop={3}
      onPress={() => {
        tap(variant === 'primary' || variant === 'accent' || variant === 'light' || variant === 'mint' ? 'Medium' : 'Light');
        onPress?.();
      }}
      style={({ pressed: isPressed }) => [s.btn, small && s.btnSmall, { minHeight: sc(small ? 34 : 42) }, android.btn, small && android.btnSmall, { backgroundColor: v.bg, borderColor: v.border, opacity: off && variant !== 'off' ? 0.5 : 1 }, style, !off && pressed(isPressed)]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text numberOfLines={2} style={{ color: v.fg, fontWeight: '700', fontSize: small ? 13 : 14, textAlign: 'center' }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, error, icon, style, inputRef, ...rest }: TextInputProps & { label: string; hint?: string; error?: string | null; icon?: React.ComponentProps<typeof Ionicons>['name']; /** to focus the field from outside (the page then scrolls it into view) */ inputRef?: React.Ref<React.ComponentRef<typeof RNTextInputType>> }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Txt variant="label">{label}</Txt>
      <View>
        <TextInput
          ref={inputRef}
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
      {/* every longer text box says its real limit, the same way everywhere ("120/500"): the limit is the server's */}
      {rest.multiline && rest.maxLength && !hint && !error ? (
        <Txt variant="small" style={{ alignSelf: 'flex-end', marginRight: 6 }} color={(rest.value ?? '').length >= rest.maxLength ? c.text : c.muted}>
          {`${(rest.value ?? '').length}/${rest.maxLength}`}
        </Txt>
      ) : null}
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
    <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max, now: value }} style={{ height: 8, borderRadius: 4, backgroundColor: c.accentSoft, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%`, height: 8, backgroundColor: c.green }} />
    </View>
  );
}

/** Rounded search field with a magnifier, no visible label (the accessibility label still names it). */
export function SearchBar({ value, onChangeText, placeholder, onFilter, filterActive }: { value: string; onChangeText: (v: string) => void; placeholder: string; /** shows a round filter button at the right end */ onFilter?: () => void; filterActive?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={[s.search, { flex: 1, minHeight: sc(49), borderRadius: 25, paddingHorizontal: 16, backgroundColor: c.surface, borderColor: c.line }]}>
        <Ionicons name="search-outline" size={18} color={c.muted} />
        <TextInput
          accessibilityLabel={placeholder}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.placeholder}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ flex: 1, fontSize: 15, color: c.text, paddingVertical: 0, minHeight: 24 }}
        />
      </View>
      {/* the filter button sits outside the field: a dark round button; a small dot says a filter is on */}
      {onFilter ? (
        <Pressable accessibilityRole="button" accessibilityLabel={filterActive ? t('Filters, on') : t('Filters')} onPress={onFilter} hitSlop={4} style={({ pressed: p }) => [{ width: 45, height: 45, borderRadius: 23, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}>
          <Ionicons name="options-outline" size={21} color="#fff" />
          {filterActive ? <View style={{ position: 'absolute', top: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: c.accent, borderWidth: 2, borderColor: c.surface }} /> : null}
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
    <ScrollView horizontal overScrollMode="never" showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }} keyboardShouldPersistTaps={keyboardTaps}>
      {children}
    </ScrollView>
  );
}

export function CheckRow({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled: !!disabled }} disabled={disabled} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center', opacity: disabled ? 0.6 : 1 }}>
      {/* the box is centred on its text (one line or several), so it always sits level with what it confirms */}
      <View style={[s.check, { borderColor: checked ? c.forest : c.muted, backgroundColor: checked ? c.forest : 'transparent' }]}>{checked ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function Stepper({ value, onChange, min, max, label }: { value: number; onChange: (n: number) => void; min: number; max: number; label: string }) {
  const { c } = useTheme();
  const { t } = useT();
  const bump = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <View style={{ gap: 4 }}>
      <Txt variant="label">{label}</Txt>
      <View style={[s.row, { gap: 14 }]}>
        <Pressable accessibilityRole="button" hitSlop={6} accessibilityLabel={t('Decrease {label}', { label })} onPress={() => bump(-1)} style={[s.stepBtn, { borderColor: c.line, backgroundColor: c.surface }]}><Text style={s.stepTxt}>−</Text></Pressable>
        <Txt variant="h2">{value}</Txt>
        <Pressable accessibilityRole="button" hitSlop={6} accessibilityLabel={t('Increase {label}', { label })} onPress={() => bump(1)} style={[s.stepBtn, { borderColor: c.line, backgroundColor: c.surface }]}><Text style={s.stepTxt}>+</Text></Pressable>
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
  const src = photoSrc(uri, size);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src && !failed ? (
        // the address carries the upload time, so a kept copy never goes stale; expo-image keeps it on disk and in memory
        <Image source={{ uri: src }} contentFit="cover" cachePolicy="memory-disk" recyclingKey={src} transition={120} onError={() => setFailed(true)} style={{ width: size, height: size }} />
      ) : (
        <Text style={{ color: c.forest, fontWeight: '800', fontSize: size * 0.42 }}>{name?.[0]?.toUpperCase() ?? '?'}</Text>
      )}
    </View>
  );
}

/** Bottom sheet. Closes on backdrop tap, the Android back button, a tap on its top edge, or by dragging that edge down. */
export function Sheet({ visible, title, onClose, children, bg, onClosed }: { /** the sheet's own colour (the THERE design's ivory sheet with white fields); the card colour when left out */ bg?: string; visible: boolean; title: string; onClose: () => void; children: ReactNode; /** runs once the sheet is fully gone (another sheet or alert may open safely then) */ onClosed?: () => void }) {
  const { c } = useTheme();
  const { t: tr } = useT();
  const insets = useSafeAreaInsets();
  const { isTablet } = useLayout();
  const { height } = useWindowDimensions();
  // like a page: the sheet ends where the keyboard begins, and the field being typed in scrolls into view above it
  const { inset: keyboard, box: sheetBox, onLayout: sheetLayout } = useKeyboardOverlap(0); // the sheet sits right on the keyboard (it pads its own bottom while typing)
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
      ]).start(({ finished }) => {
        if (!finished) return;
        setMounted(false);
        // iPhone cannot show a new pop-up while this one is still leaving the screen: let it go first
        if (onClosed) setTimeout(onClosed, Platform.OS === 'ios' ? 120 : 0);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!mounted) return null;
  const rise = isTablet ? slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) : slide.interpolate({ inputRange: [0, 1], outputRange: [height, 0] });
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View ref={sheetBox} onLayout={sheetLayout} style={{ flex: 1, justifyContent: isTablet ? 'center' : 'flex-end', paddingBottom: keyboard }}>
        <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,20,17,0.45)', opacity: shade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={tr('Close')} />
        </Animated.View>
        {/* a bottom sheet on phones; a centred dialog on tablets and desktops */}
        <Animated.View
          accessibilityViewIsModal
          style={[
            s.sheet,
            { backgroundColor: bg ?? c.surface, paddingBottom: typing ? 16 : insets.bottom + 16, transform: [{ translateY: isTablet ? rise : Animated.add(rise, drag) }] },
            isTablet && { alignSelf: 'center', width: 560, maxWidth: '92%', borderRadius: 22, paddingBottom: 18, opacity: slide },
          ]}
        >
          {isTablet ? (
            <Txt variant="h2">{shown.current.title}</Txt>
          ) : (
            // grab bar plus title: the part to tap or pull down. Padding makes the touch area generous.
            <View {...handle.panHandlers} accessible accessibilityRole="button" accessibilityLabel={tr('Close')} style={{ marginTop: -18, paddingTop: 10, paddingBottom: 4, gap: 10 }}>
              <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.line }} />
              <Txt variant="h2">{shown.current.title}</Txt>
            </View>
          )}
          <ScrollView ref={body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps} scrollEventThrottle={16} onScroll={(e) => (bodyY.current = e.nativeEvent.contentOffset.y)} contentContainerStyle={{ gap: 12 }}>{shown.current.children}</ScrollView>
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
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 42, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12 },
  stepBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  stepTxt: { fontSize: 22, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  banner: { padding: 12, borderRadius: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  empty: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 12, maxHeight: '88%' },
});
