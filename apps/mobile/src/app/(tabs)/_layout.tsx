import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, type ColorValue } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { useLayout } from '@/lib/layout';
import { sc } from '@/lib/scale';
import { InnerHeader } from '@/components/TabHeader';
import { useTheme } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
/** Tab icon that pops up a little when its tab becomes the selected one, and settles back when it is left. */
function TabGlyph({ on, off, color, size, focused }: { on: IconName; off: IconName; color: string; size: number; focused: boolean }) {
  const v = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: focused ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [focused, v]);
  return (
    <Animated.View style={{ transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }) }] }}>
      <Ionicons name={focused ? on : off} size={size} color={color} />
    </Animated.View>
  );
}
const icon = (on: IconName, off: IconName) =>
  function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <TabGlyph on={on} off={off} color={color as string} size={size} focused={focused} />;
  };

/**
 * Every dock item reacts to a touch: the icon and label swell a little while pressed and settle on release, the same
 * feel as the Create button. (The selected tab additionally pops, see TabGlyph.)
 */
function DockButton(props: any) {
  const { children, onPress, onLongPress, style, accessibilityLabel, accessibilityState, testID } = props;
  const press = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.timing(press, { toValue: v, duration: v ? 110 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      style={style}
    >
      <Animated.View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }}>{children}</Animated.View>
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
  const unread = useLoad(() => get<{ unreadCount: number }>('/v1/notifications?unread=true'), [], 30_000).data?.unreadCount ?? 0;

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
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // no cross-fade: with two pages fading at once the old one shows through the new one as a ghost.
        // The page you leave disappears, and the new one eases in by itself (PageTransition).
        animation: 'none',
        tabBarButton: (p) => <DockButton {...p} />,
        freezeOnBlur: true,
        // bottom tabs on phones; a navigation rail down the left edge on iPads, tablets and desktop browsers
        tabBarPosition: isWide ? 'left' : 'bottom',
        tabBarActiveTintColor: c.green,
        tabBarInactiveTintColor: c.muted,
        // The active item gets a soft green highlight on the side rail (never the system blue).
        tabBarActiveBackgroundColor: isWide ? c.accentSoft : 'transparent',
        tabBarItemStyle: isWide ? { borderRadius: 12, marginVertical: 2, paddingVertical: 4 } : undefined,
        tabBarStyle: isWide
          ? { backgroundColor: c.surface, borderRightColor: c.line, width: 232, minWidth: 232, maxWidth: 232, flexGrow: 0, flexShrink: 0, paddingTop: 16, paddingHorizontal: 10 }
          : // room for the raised Create button and for the labels, plus the phone's home-indicator inset
            { backgroundColor: c.surface, borderTopColor: c.line, height: Math.max(62, sc(62)) + dockBottom, paddingTop: 8, paddingBottom: dockBottom },
        tabBarLabelStyle: { fontWeight: '600', fontSize: isWide ? 14 : 10 },
        tabBarBadgeStyle: { backgroundColor: c.danger, color: '#fff' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Explore', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="discover" options={{ title: mode === 'here' ? 'Map' : 'Search', tabBarIcon: mode === 'here' ? icon('location', 'location-outline') : icon('search', 'search-outline') }} />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarIcon: icon('add-circle', 'add-circle-outline'),
          tabBarButton: isWide ? undefined : (p) => <CreateButton onPress={p.onPress ?? undefined} />,
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: icon('mail', 'mail-outline'), tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person', 'person-outline') }} />

      {/* Inner screens: no tab of their own (href: null), but the tab bar stays visible underneath them. */}
      <Tabs.Screen name="activity/[id]" options={inner('Activity')} />
      <Tabs.Screen name="trip/[id]" options={inner('Trip')} />
      <Tabs.Screen name="join/[id]" options={inner('Request to join')} />
      <Tabs.Screen name="apply/[id]" options={inner('Apply to join')} />
      <Tabs.Screen name="host/[id]" options={inner('Manage join requests')} />
      <Tabs.Screen name="review/[id]" options={inner('Review travelers')} />
      <Tabs.Screen name="chat/[id]" options={inner('Chat')} />
      <Tabs.Screen name="safety" options={inner('Safety & privacy')} />
      <Tabs.Screen name="activities" options={inner('All activities')} />
      <Tabs.Screen name="edit-profile" options={inner('Edit profile')} />
      <Tabs.Screen name="my-activities" options={inner('My activities')} />
      <Tabs.Screen name="group/[id]" options={inner('Group info')} />
      <Tabs.Screen name="user/[id]" options={inner('Profile')} />
    </Tabs>
  );
}
