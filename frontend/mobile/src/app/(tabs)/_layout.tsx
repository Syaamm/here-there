import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { useEffect } from 'react';
import { View, type ColorValue } from 'react-native';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { CreateButton, DockBackground, DockButton, DockSpace, useDockMetrics } from '@/lib/dock';
import { startLive, stopLive, useLiveEvents } from '@/lib/live';
import { useCity } from '@/lib/city';
import { resyncPush, usePushTaps } from '@/lib/push';
import { bumpUnread, onUnreadRefresh, refreshUnread, setUnread, useUnread } from '@/lib/unread';
import { prefetchApp } from '@/lib/prefetch';
import { HomeIcon, MessageIcon, ProfileGlyph, SearchIcon, svgTabIcon } from '@/components/DockIcons';
import { useTheme } from '@/lib/theme';
import { useT } from '@/lib/i18n';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
/** Side-rail only: the Create item is a normal icon there (the phone dock draws its own round + button). */
const railIcon = (on: IconName, off: IconName) =>
  function RailIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? on : off} size={size} color={color as string} />;
  };

/** Same five tabs in both products, so switching HERE/THERE never changes where things are. */
export default function TabsLayout() {
  const { t } = useT();
  const { mode, c } = useTheme();
  const { onboarding } = useMe();
  // sizes and the per-platform bottom spacing (iPhone home indicator, Android gesture or 3-button bar) live in lib/dock
  const { isWide, barHeight, bottom: dockBottom, space: dockSpace } = useDockMetrics();
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
    <View style={{ flex: 1 }}>
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
            { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: barHeight, paddingTop: 0, paddingBottom: dockBottom, paddingHorizontal: 18 },
        tabBarBackground: isWide ? undefined : () => <DockBackground bottom={dockBottom} />,
        // icons only on the phone dock (screen readers still hear each tab's name); the side rail keeps its words
        tabBarShowLabel: isWide,
        tabBarLabelStyle: { fontWeight: '600', fontSize: isWide ? 14 : 11 },
        tabBarBadgeStyle: { backgroundColor: c.danger, color: '#fff' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('Home'), tabBarAccessibilityLabel: t('Home'), tabBarIcon: svgTabIcon(HomeIcon) }} />
      <Tabs.Screen name="discover" options={{ title: mode === 'here' ? t('Map') : t('Explore'), tabBarAccessibilityLabel: mode === 'here' ? t('Map') : t('Explore'), tabBarIcon: svgTabIcon(SearchIcon) }} />
      <Tabs.Screen
        name="create"
        options={{
          title: t('Create'),
          tabBarAccessibilityLabel: t('Create'),
          tabBarIcon: railIcon('add-circle', 'add-circle-outline'),
          // phones: the round raised "+" in the middle of the dock; the side rail keeps a normal item
          tabBarButton: (p) => (isWide ? <DockButton {...p} glass={false} /> : <CreateButton onPress={p.onPress as (...args: any[]) => void} />),
        }}
      />
      <Tabs.Screen name="inbox" options={{ title: t('Message'), tabBarAccessibilityLabel: t('Messages'), tabBarIcon: svgTabIcon(MessageIcon), tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined }} />
      <Tabs.Screen name="profile" options={{ title: t('Profile'), tabBarAccessibilityLabel: t('Profile'), tabBarIcon: ({ focused }) => <ProfileGlyph focused={focused} /> }} />
    </Tabs>
    </View>
    </DockSpace.Provider>
  );
}
