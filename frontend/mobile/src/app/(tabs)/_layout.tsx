import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, View, type ColorValue } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { DockSpace } from '@/lib/dock';
import { startLive, stopLive, useLiveEvents } from '@/lib/live';
import { useCity } from '@/lib/city';
import { resyncPush, usePushTaps } from '@/lib/push';
import { bumpUnread, onUnreadRefresh, refreshUnread, setUnread, useUnread } from '@/lib/unread';
import { useLayout } from '@/lib/layout';
import { prefetchApp } from '@/lib/prefetch';
import { scBase, useTextBoost } from '@/lib/scale';
import { HomeIcon, MessageIcon, SearchIcon } from '@/components/DockIcons';
import { Avatar } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
/**
 * Dock icon that fills in when its tab opens: it rests as an outline; on selection the solid version rises from the
 * bottom, and leaving the tab drains it again. `render(true)` is the solid icon. (The press squash is in DockButton.)
 */
function TabGlyph({ size, focused, render }: { size: number; focused: boolean; render: (solid: boolean) => React.ReactElement }) {
  const fill = useRef(new Animated.Value(focused ? 1 : 0)).current; // height of the solid layer, 0..1 (JS-driven)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.timing(fill, { toValue: focused ? 1 : 0, duration: focused ? 340 : 200, delay: focused ? 120 : 0, easing: focused ? Easing.out(Easing.cubic) : Easing.in(Easing.quad), useNativeDriver: true }).start();
  }, [focused, fill]);
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      {/* the outline fades as the solid rises, so its lines never show through the solid's cut-outs (the + in Create) */}
      <Animated.View renderToHardwareTextureAndroid style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>{render(false)}</Animated.View>
      {/* the solid rises from the bottom: a window slides up while the icon inside slides down by the same amount, so the icon stays put. Both are transforms, so they run on the native thread (a height animation would run on the JS thread and lag on Android). */}
      <Animated.View renderToHardwareTextureAndroid style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'hidden', transform: [{ translateY: fill.interpolate({ inputRange: [0, 1], outputRange: [size, 0] }) }] }}>
        <Animated.View style={{ width: size, height: size, transform: [{ translateY: fill.interpolate({ inputRange: [0, 1], outputRange: [-size, 0] }) }] }}>{render(true)}</Animated.View>
      </Animated.View>
    </View>
  );
}
/** The same fill, for the hand-drawn SVG icons in DockIcons. */
const svgIcon = (Custom: (p: { size: number; color: string; focused: boolean }) => React.ReactElement) =>
  function TabSvgIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <TabGlyph size={size} focused={focused} render={(solid) => <Custom size={size} color={color as string} focused={solid} />} />;
  };
/** Profile tab: the member's own round photo (initial when there is none), ringed while the tab is open. */
function ProfileGlyph({ focused, size }: { focused: boolean; size: number }) {
  const { c } = useTheme();
  const { me } = useMe();
  return (
    <View style={{ borderRadius: 99, borderWidth: 2, borderColor: focused ? c.text : 'transparent', padding: 1.5 }}>
      <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={size - 4} />
    </View>
  );
}
const icon = (on: IconName, off: IconName) =>
  function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <TabGlyph size={size} focused={focused} render={(solid) => <Ionicons name={solid ? on : off} size={size} color={color as string} />} />;
  };

/**
 * Every dock item reacts to a touch, in one motion: while the finger is down the icon squashes flat from the top;
 * on release it springs a little taller than normal, jumps up, and drops back to rest with a small bounce.
 * (The selected tab's icon also fills in, see TabGlyph.)
 */
function DockButton(props: any) {
  const { children, onPress, onLongPress, style, accessibilityLabel, accessibilityState, testID, glass } = props;
  const { c } = useTheme(); // the capsule follows the product's colours
  // this navigator reports the open tab as `aria-selected` (older ones used accessibilityState)
  const selected = !!(props['aria-selected'] ?? accessibilityState?.selected);
  // the liquid-glass highlight behind the open tab: it swells in with a little overshoot, like a drop settling
  const drop = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const seen = useRef(selected);
  useEffect(() => {
    if (seen.current === selected) return;
    seen.current = selected;
    Animated.spring(drop, { toValue: selected ? 1 : 0, friction: selected ? 5 : 9, tension: selected ? 150 : 200, useNativeDriver: true }).start();
  }, [selected, drop]);
  const squash = useRef(new Animated.Value(1)).current; // vertical scale: below 1 squashed, above 1 stretched
  const lift = useRef(new Animated.Value(0)).current; // 0 on the ground, 1 at the top of the jump
  const down = () => {
    lift.stopAnimation();
    squash.stopAnimation();
    Animated.timing(squash, { toValue: 0.88, duration: 60, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };
  // quick and stiff: back to rest in about a tenth of a second, with just a hint of bounce (a soft spring felt laggy on Android)
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
      // Android: let the press animation draw its first frame before the new page starts rendering (which keeps the JS thread busy)
      onPress={Platform.OS === 'android' && onPress ? (e: unknown) => requestAnimationFrame(() => onPress(e)) : onPress}
      onLongPress={onLongPress}
      onPressIn={down}
      onPressOut={up}
      style={style}
    >
      {glass ? (
        <Animated.View
          renderToHardwareTextureAndroid
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: drop.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ scaleX: drop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }, { scaleY: drop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
        >
          {/* liquid glass: a tall frosted capsule filling the tab, with a fine rim, a bright top edge and a green glow below */}
          <View style={{ position: 'absolute', left: 2, right: 2, top: 5, bottom: 5, borderRadius: 999, borderWidth: 1, borderColor: c.glassRim, backgroundColor: c.glassFill, shadowColor: c.glassGlow, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
            <View style={{ flex: 1, margin: 1, borderRadius: 999, overflow: 'hidden', borderWidth: 1, borderColor: c.glassEdge }}>
              <LinearGradient colors={[c.glassShine, 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.6 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
              <LinearGradient colors={[c.glassTint, c.glassTintEnd]} start={{ x: 0.5, y: 0.35 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            </View>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View renderToHardwareTextureAndroid style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transformOrigin: 'center bottom', transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }, { scaleY: squash }] }}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * The round "+" in the middle of the bar, raised above it. Phones only; the side rail uses a normal item.
 * It rests small, swells while it is being pressed, and stays bigger (with the plus turned) while Create is the open tab.
 */
function CreateButton({ onPress }: { onPress?: (...args: any[]) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  const boost = useTextBoost(); // the label under the + is part of the dock: it keeps its own size
  // the open tab, read from the address (the tab bar does not hand this button its selected state reliably)
  const selected = usePathname() === '/create';
  const grow = useRef(new Animated.Value(0)).current; // 0 resting, 1 selected
  const press = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, { toValue: selected ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [selected, grow]);
  // driven straight from the touch (no React state), so a press never re-renders anything on the JS thread
  const setDown = (isDown: boolean) =>
    Animated.timing(press, { toValue: isDown ? 1 : 0, duration: isDown ? 110 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  const scale = Animated.add(grow.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.06] }), press.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }));
  const turn = grow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Create')} accessibilityState={{ selected }} onPress={onPress} onPressIn={() => setDown(true)} onPressOut={() => setDown(false)} style={{ flex: 1, alignItems: 'center' }}>
      <Animated.View
        renderToHardwareTextureAndroid
        style={{
          marginTop: -20,
          width: 52,
          height: 52,
          borderRadius: 26,
          backgroundColor: selected ? c.green : c.forest,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 4,
          borderColor: c.surface,
          elevation: 6,
          shadowColor: '#0B2620',
          shadowOpacity: 0.22,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          transform: [{ scale }],
        }}
      >
        <Animated.View style={{ transform: [{ rotate: turn }] }}>
          <Ionicons name="add" size={30} color="#fff" />
        </Animated.View>
      </Animated.View>
      <Text style={{ marginTop: 3, fontSize: 10 / boost, fontWeight: selected ? '800' : '600', color: selected ? c.green : c.muted }}>{t('Create')}</Text>
    </Pressable>
  );
}

/** Same five tabs in both products, so switching HERE/THERE never changes where things are. */
export default function TabsLayout() {
  const { t } = useT();
  const { mode, c } = useTheme();
  const { onboarding } = useMe();
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();
  // lift the dock a little off the bottom edge: a phone's gesture bar, home indicator and rounded corners sit there
  // (on iPhones the home-indicator inset is large, so the dock sits closer to the edge and is a touch taller)
  const ios = Platform.OS === 'ios';
  const dockBottom = ios ? Math.max(insets.bottom - 6, 12) : Math.max(insets.bottom, 12) + 6;
  const dockH = Math.max(ios ? 58 : 56, scBase(ios ? 58 : 56)); // the dock does not grow with the text size
  // the dock floats over the pages (phones), so they leave this much room at the bottom
  const dockSpace = isWide ? 0 : dockH + dockBottom;
  // the Message badge: asked of the server every minute (the live connection moves it at once when something arrives), and changed at once by the screens that read things (lib/unread)
  const polled = useLoad(() => get<{ unreadCount: number }>('/v1/notifications?unread=true'), [], 60_000, undefined, { live: true });
  useEffect(() => {
    if (polled.data) setUnread(polled.data.unreadCount);
  }, [polled.data]);
  useEffect(() => onUnreadRefresh(() => void polled.reload()), [polled.reload]);
  const unread = useUnread();

  // live connection while signed in: new alerts move the badge at once; push is re-registered quietly
  const { me: signedIn } = useMe();
  useCity(); // keeps the live connection told which city the feeds show
  useEffect(() => {
    if (!signedIn) return;
    startLive();
    void resyncPush();
    return () => stopLive();
  }, [signedIn?.id]);
  useLiveEvents((e) => {
    if (e.type === 'notification') bumpUnread(1);
    if (e.type === 'notification' || e.type === 'ready' || e.type === 'alerts-changed') refreshUnread();
  });
  usePushTaps();
  // the first visit to Messages, Profile or the feeds should already have its content: load them quietly now
  useEffect(() => {
    if (signedIn) void prefetchApp(signedIn).catch(() => {});
  }, [signedIn?.id]);

  // right after sign-up: confirm email + profile once, then the tabs
  if (onboarding) return <Redirect href={'/onboarding' as never} />;

  return (
    <DockSpace.Provider value={dockSpace}>
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // the dock steps aside while someone is typing, so it never rides on top of the keyboard
        tabBarHideOnKeyboard: true,
        // no cross-fade: with two pages fading at once the old one shows through the new one as a ghost.
        // The page you leave disappears, and the new one eases in by itself (PageTransition).
        animation: 'none',
        sceneStyle: { backgroundColor: c.bg }, // what shows behind a page being swiped away
        tabBarButton: (p) => <DockButton {...p} glass={!isWide} />,
        freezeOnBlur: true,
        // bottom tabs on phones; a navigation rail down the left edge on iPads, tablets and desktop browsers
        tabBarPosition: isWide ? 'left' : 'bottom',
        // active item is dark and bold (filled icon), the rest soft grey
        tabBarActiveTintColor: isWide ? c.green : c.text,
        tabBarInactiveTintColor: c.muted,
        // The active item gets a soft green highlight on the side rail (never the system blue).
        tabBarActiveBackgroundColor: isWide ? c.accentSoft : 'transparent',
        tabBarItemStyle: isWide ? { borderRadius: 12, marginVertical: 2, paddingVertical: 4 } : undefined,
        tabBarStyle: isWide
          ? { backgroundColor: c.surface, borderRightColor: c.line, width: 232, minWidth: 232, maxWidth: 232, flexGrow: 0, flexShrink: 0, paddingTop: 16, paddingHorizontal: 10 }
          : // a floating pill: the bar itself is see-through, the pill is drawn by tabBarBackground below.
            // Room for the raised Create button and for the labels, plus the phone's home-indicator inset.
            { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: dockH + dockBottom, paddingTop: 0, paddingBottom: dockBottom, paddingHorizontal: 18 },
        tabBarBackground: isWide
          ? undefined
          : () => (
              <>
              <LinearGradient pointerEvents="none" colors={[c.fadeFrom, c.fadeTo]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 14,
                  right: 14,
                  top: 0,
                  bottom: dockBottom,
                  borderRadius: 999,
                  // frosted glass: slightly see-through white with a fine rim, so the capsule inside it reads as glass on glass
                  backgroundColor: c.dockFill,
                  borderWidth: 1,
                  borderColor: 'rgba(16,47,41,0.08)',
                  elevation: 10,
                  shadowColor: '#0B2620',
                  shadowOpacity: 0.12,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 4 },
                }}
              />
              </>
            ),
        // icons only on the phone dock (screen readers still hear each tab's name); the side rail keeps its words
        tabBarShowLabel: isWide,
        tabBarLabelStyle: { fontWeight: '600', fontSize: isWide ? 14 : 11 },
        tabBarBadgeStyle: { backgroundColor: c.danger, color: '#fff' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('Home'), tabBarAccessibilityLabel: t('Home'), tabBarIcon: svgIcon(HomeIcon) }} />
      <Tabs.Screen name="discover" options={{ title: mode === 'here' ? t('Map') : t('Explore'), tabBarAccessibilityLabel: mode === 'here' ? t('Map') : t('Explore'), tabBarIcon: svgIcon(SearchIcon) }} />
      <Tabs.Screen
        name="create"
        options={{
          title: t('Create'),
          tabBarAccessibilityLabel: t('Create'),
          tabBarIcon: icon('add-circle', 'add-circle-outline'),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: t('Message'), tabBarAccessibilityLabel: t('Messages'), tabBarIcon: svgIcon(MessageIcon), tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined }} />
      <Tabs.Screen name="profile" options={{ title: t('Profile'), tabBarAccessibilityLabel: t('Profile'), tabBarIcon: ({ size, focused }) => <ProfileGlyph focused={focused} size={size} /> }} />
    </Tabs>
    </DockSpace.Provider>
  );
}
