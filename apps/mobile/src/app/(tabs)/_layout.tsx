import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { Pressable, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const icon = (on: IconName, off: IconName) =>
  function TabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? on : off} size={size} color={color as string} />;
  };

/** Header back arrow for the inner screens. */
function BackArrow() {
  const router = useRouter();
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ paddingHorizontal: 12 }}>
      <Ionicons name="chevron-back" size={26} color={c.text} />
    </Pressable>
  );
}

/** The round green "+" in the middle of the bar, raised above it. Phones only; the side rail uses a normal item. */
function CreateButton({ onPress, selected }: { onPress?: (...args: any[]) => void; selected: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Create" accessibilityState={{ selected }} onPress={onPress} style={{ flex: 1, alignItems: 'center' }}>
      <View
        style={{
          marginTop: -26,
          width: 62,
          height: 62,
          borderRadius: 31,
          backgroundColor: c.forest,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 5,
          borderColor: c.surface,
          elevation: 6,
          shadowColor: '#0B2620',
          shadowOpacity: 0.22,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Ionicons name="add" size={36} color="#fff" />
      </View>
      <Text style={{ marginTop: 3, fontSize: 11, fontWeight: selected ? '800' : '600', color: selected ? c.text : c.muted }}>Create</Text>
    </Pressable>
  );
}

/** Same five tabs in both products, so switching HERE/THERE never changes where things are. */
export default function TabsLayout() {
  const { mode, c } = useTheme();
  const { onboarding } = useMe();
  const { isWide } = useLayout();
  const insets = useSafeAreaInsets();
  const unread = useLoad(() => get<{ unreadCount: number }>('/v1/notifications?unread=true'), [], 30_000).data?.unreadCount ?? 0;

  // right after sign-up: confirm email + profile once, then the tabs
  if (onboarding) return <Redirect href={'/onboarding' as never} />;

  // Inner screens have no tab button, but stay navigable (href: null would make them unreachable).
  const hidden = { tabBarButton: () => null, tabBarItemStyle: { display: 'none' as const } };

  /** Options for a screen that has a header with a back arrow but no tab of its own. */
  const inner = (title: string) => ({
    ...hidden,
    headerShown: true,
    title,
    headerStyle: { backgroundColor: c.bg },
    headerShadowVisible: false,
    headerTintColor: c.text,
    headerTitleStyle: { fontWeight: '800' as const, fontSize: 18 },
    headerLeft: () => <BackArrow />,
  });

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // switching tabs cross-fades instead of cutting, and screens that are off-screen stop rendering
        animation: 'fade',
        freezeOnBlur: true,
        // bottom tabs on phones; a navigation rail down the left edge on iPads, tablets and desktop browsers
        tabBarPosition: isWide ? 'left' : 'bottom',
        tabBarActiveTintColor: c.forest,
        tabBarInactiveTintColor: c.muted,
        // The active item gets a soft green highlight on the side rail (never the system blue).
        tabBarActiveBackgroundColor: isWide ? c.accentSoft : 'transparent',
        tabBarItemStyle: isWide ? { borderRadius: 12, marginVertical: 2, paddingVertical: 4 } : undefined,
        tabBarStyle: isWide
          ? { backgroundColor: c.surface, borderRightColor: c.line, width: 232, minWidth: 232, maxWidth: 232, flexGrow: 0, flexShrink: 0, paddingTop: 16, paddingHorizontal: 10 }
          : // room for the raised Create button and for the labels, plus the phone's home-indicator inset
            { backgroundColor: c.surface, borderTopColor: c.line, height: 72 + insets.bottom, paddingTop: 8, paddingBottom: insets.bottom + 8 },
        tabBarLabelStyle: { fontWeight: '600', fontSize: isWide ? 15 : 11 },
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
          tabBarButton: isWide ? undefined : (p) => <CreateButton onPress={p.onPress ?? undefined} selected={!!p.accessibilityState?.selected} />,
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarIcon: icon('mail', 'mail-outline'), tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person', 'person-outline') }} />

      {/* Inner screens: no tab of their own (href: null), but the tab bar stays visible underneath them. */}
      <Tabs.Screen name="activity/[id]" options={hidden} />
      <Tabs.Screen name="trip/[id]" options={hidden} />
      <Tabs.Screen name="join/[id]" options={inner('Request to join')} />
      <Tabs.Screen name="apply/[id]" options={inner('Apply to join')} />
      <Tabs.Screen name="host/[id]" options={inner('Manage join requests')} />
      <Tabs.Screen name="review/[id]" options={inner('Review travelers')} />
      <Tabs.Screen name="chat/[id]" options={inner('Chat')} />
      <Tabs.Screen name="safety" options={inner('Safety & privacy')} />
      <Tabs.Screen name="activities" options={inner('All activities')} />
    </Tabs>
  );
}
