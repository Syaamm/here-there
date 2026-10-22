import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View, type ColorValue } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { DockSpace } from '@/lib/dock';
import { onUnreadRefresh, setUnread, useUnread } from '@/lib/unread';
import { useLayout } from '@/lib/layout';
import { sc } from '@/lib/scale';
import { InnerHeader } from '@/components/TabHeader';
import { HomeIcon, MessageIcon, SearchIcon } from '@/components/DockIcons';
import { Avatar } from '@/components/ui';
import { useTheme } from '@/lib/theme';

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
    Animated.timing(fill, { toValue: focused ? 1 : 0, duration: focused ? 340 : 200, delay: focused ? 120 : 0, easing: focused ? Easing.out(Easing.cubic) : Easing.in(Easing.quad), useNativeDriver: false }).start();
  }, [focused, fill]);
  return (
    <View style={{ width: size, height: size }}>
      {/* the outline fades as the solid rises, so its lines never show through the solid's cut-outs (the + in Create) */}
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>{render(false)}</Animated.View>
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fill.interpolate({ inputRange: [0, 1], outputRange: [0, size] }), overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, bottom: 0, width: size, height: size }}>{render(true)}</View>
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
    Animated.timing(squash, { toValue: 0.86, duration: 80, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  };
  const up = () => {
    Animated.sequence([
      Animated.timing(squash, { toValue: 1.04, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(squash, { toValue: 1, friction: 7, tension: 220, useNativeDriver: true }),
    ]).start();
    Animated.sequence([
      Animated.timing(lift, { toValue: 1, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(lift, { toValue: 0, friction: 7, tension: 200, useNativeDriver: true }),
    ]).start();
  };
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ ...accessibilityState, selected }}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={down}
      onPressOut={up}
      style={style}
    >
      {glass ? (
        <Animated.View
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
          <View style={{ position: 'absolute', left: 2, right: 2, top: 5, bottom: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(47,125,101,0.14)', backgroundColor: 'rgba(47,125,101,0.05)', shadowColor: '#2F7D65', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
            <View style={{ flex: 1, margin: 1, borderRadius: 999, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)' }}>
              <LinearGradient colors={['rgba(255,255,255,0.35)', 'rgba(255,255,255,0)']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.6 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
              <LinearGradient colors={['rgba(47,125,101,0)', 'rgba(47,125,101,0.09)']} start={{ x: 0.5, y: 0.35 }} end={{ x: 0.5, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            </View>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transformOrigin: 'center bottom', transform: [{ translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }, { scaleY: squash }] }}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * The round "+" in the middle of the bar, raised above it. Phones only; the side rail uses a normal item.
 * It rests small, swells while it is being pressed, and stays bigger (with the plus turned) while Create is the open tab.
 */
function CreateButton({ onPress }: { onPress?: (...args: any[]) => void }) {
  const { c } = useTheme();
  // the open tab, read from the address (the tab bar does not hand this button its selected state reliably)
  const selected = usePathname() === '/create';
  const [down, setDown] = useState(false);
  const grow = useRef(new Animated.Value(0)).current; // 0 resting, 1 selected
  const press = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, { toValue: selected ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [selected, grow]);
  useEffect(() => {
    Animated.timing(press, { toValue: down ? 1 : 0, duration: down ? 110 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [down, press]);
  const scale = Animated.add(grow.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.06] }), press.interpolate({ inputRange: [0, 1], outputRange: [0, 0.14] }));
  const turn = grow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Create" accessibilityState={{ selected }} onPress={onPress} onPressIn={() => setDown(true)} onPressOut={() => setDown(false)} style={{ flex: 1, alignItems: 'center' }}>
      <Animated.View
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
      <Text style={{ marginTop: 3, fontSize: 10, fontWeight: selected ? '800' : '600', color: selected ? c.green : c.muted }}>Create</Text>
    </Pressable>
  );
}

/** Same five tabs in both products, so switching HERE/THERE never changes where things are. */
export default function TabsLayout() {
  const { mode, c } = useTheme();
  const { onboarding } = useMe();
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();
  // lift the dock a little off the bottom edge: a phone's gesture bar, home indicator and rounded corners sit there
  const dockBottom = Math.max(insets.bottom, 12) + 6;
  // the dock floats over the pages (phones), so they leave this much room at the bottom
  const dockSpace = isWide ? 0 : Math.max(56, sc(56)) + dockBottom;
  // the Message badge: asked of the server every 10 s, and changed at once by the screens that read things (lib/unread)
  const polled = useLoad(() => get<{ unreadCount: number }>('/v1/notifications?unread=true'), [], 10_000);
  useEffect(() => {
    if (polled.data) setUnread(polled.data.unreadCount);
  }, [polled.data]);
  useEffect(() => onUnreadRefresh(() => void polled.reload()), [polled.reload]);
  const unread = useUnread();

  // right after sign-up: confirm email + profile once, then the tabs
  if (onboarding) return <Redirect href={'/onboarding' as never} />;

  // Inner screens have no tab button, but stay navigable (href: null would make them unreachable).
  const hidden = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } };

  /** Options for a screen that has a header with a back arrow but no tab of its own. */
  const inner = (title: string) => ({
    ...hidden,
    // the page slides itself in (PageTransition); the navigator adds no second fade on top
    animation: 'none' as const,
    headerShown: true,
    title,
    // the same HERE. / THERE. header as the main tabs, with a back arrow (see InnerHeader)
    header: ({ options }: { options: any }) => <InnerHeader options={options} />,
  });

  return (
    <DockSpace.Provider value={dockSpace}>
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // no cross-fade: with two pages fading at once the old one shows through the new one as a ghost.
        // The page you leave disappears, and the new one eases in by itself (PageTransition).
        animation: 'none',
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
            { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: Math.max(56, sc(56)) + dockBottom, paddingTop: 0, paddingBottom: dockBottom, paddingHorizontal: 18 },
        tabBarBackground: isWide
          ? undefined
          : () => (
              <>
              <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.78)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} />
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
                  backgroundColor: 'rgba(255,255,255,0.88)',
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
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: svgIcon(HomeIcon) }} />
      <Tabs.Screen name="discover" options={{ title: mode === 'here' ? 'Map' : 'Explore', tabBarIcon: svgIcon(SearchIcon) }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: icon('add-circle', 'add-circle-outline'),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: 'Message', tabBarIcon: svgIcon(MessageIcon), tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ size, focused }) => <ProfileGlyph focused={focused} size={size} /> }} />

      {/* Inner screens: no tab of their own (href: null), but the tab bar stays visible underneath them. */}
      <Tabs.Screen name="activity/[id]" options={inner('Activity')} />
      <Tabs.Screen name="trip/[id]" options={inner('Trip')} />
      <Tabs.Screen name="join/[id]" options={inner('Request to join')} />
      <Tabs.Screen name="apply/[id]" options={inner('Apply to join')} />
      <Tabs.Screen name="host/[id]" options={inner('Manage join requests')} />
      <Tabs.Screen name="review/[id]" options={inner('Review travelers')} />
      {/* inside a chat there is no app header: the conversation has its own back arrow and title */}
      <Tabs.Screen name="chat/[id]" options={{ ...inner('Chat'), headerShown: false }} />
      <Tabs.Screen name="safety" options={inner('Safety & privacy')} />
      <Tabs.Screen name="activities" options={inner('All activities')} />
      <Tabs.Screen name="edit-profile" options={inner('Edit profile')} />
      <Tabs.Screen name="my-activities" options={inner('My activities')} />
      <Tabs.Screen name="group/[id]" options={inner('Group info')} />
      <Tabs.Screen name="user/[id]" options={inner('Profile')} />
    </Tabs>
    </DockSpace.Provider>
  );
}
