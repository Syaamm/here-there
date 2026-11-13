import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs, useFocusEffect, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BackHandler, Keyboard, Platform, View, type ColorValue } from 'react-native';
import { showToast } from '@/lib/toast';
import { get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useLoad } from '@/lib/hooks';
import { CreateButton, DOCK, DockBackground, DockButton, DockSpace, dockHide, setDockAway, setDockKeyboardHidden, tabSwitched, useDockMetrics } from '@/lib/dock';
import { startLive, stopLive, useLiveEvents } from '@/lib/live';
import { useCity } from '@/lib/city';
import { askPushOnce, resyncPush, usePushTaps } from '@/lib/push';
import { bumpUnread, onUnreadRefresh, refreshUnread, setUnread, useUnread } from '@/lib/unread';
import { prefetchApp } from '@/lib/prefetch';
import { backFromMain, currentPath } from '@/lib/nav';
import { HomeIcon, MessageIcon, ProfileGlyph, SearchIcon, svgTabIcon } from '@/components/DockIcons';
import { useTheme } from '@/lib/theme';
import { fontOf } from '@/lib/fonts';
import { useT } from '@/lib/i18n';

import { sc, sp, sph } from '@/lib/scale';
type IconName = React.ComponentProps<typeof Ionicons>['name'];
const MAIN_TAB_PATHS = ['/', '/discover', '/create', '/inbox', '/profile'];
/** Side-rail only: the Create item is a normal icon there (the phone dock draws its own round + button). */
const railIcon = (on: IconName, off: IconName) =>
  function RailIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return <Ionicons name={focused ? on : off} size={size} color={color as string} />;
  };

/** Same five tabs in both products, so switching HERE/THERE never changes where things are. */
export default function TabsLayout() {
  const { t } = useT();
  const router = useRouter();
  const { mode, c } = useTheme();
  const { onboarding } = useMe();
  // sizes and the per-platform bottom spacing (iPhone home indicator, Android gesture or 3-button bar) live in lib/dock
  const { isWide, barHeight, bottom: dockBottom, space: dockSpace } = useDockMetrics();
  // the Message badge: asked of the server every minute (the live connection moves it at once when something arrives), and changed at once by the screens that read things (lib/unread)
  const polled = useLoad(() => get<{ unreadCount: number }>('/v1/notifications?unread=true&limit=1'), [], 60_000, undefined, { live: true });
  useEffect(() => {
    if (polled.data) setUnread(polled.data.unreadCount);
  }, [polled.data]);
  useEffect(() => onUnreadRefresh(() => void polled.reload()), [polled.reload]);
  const unread = useUnread();
  // the dock slides down out of sight (scrolling down a home page, or the keyboard up) and back: past its own height and the raised + button
  const dockSlide = useMemo(() => dockHide.interpolate({ inputRange: [0, 1], outputRange: [0, barHeight + DOCK.raise + 24] }), [barHeight]);
  // a different dock tab opened (pages opened from a tab, like an activity, do not count): the home pages go back to the top
  const path = usePathname();
  const lastTab = useRef(path);
  // The dock is away on Create and on your own Profile (phones), and stays away while an inner page (Settings, a form...) is open over
  // them: it is judged by the last main page you were on, so it never shows for a moment when you come back.
  const mainRef = useRef(path);
  if (MAIN_TAB_PATHS.includes(path)) mainRef.current = path;
  const dockIsAway = !isWide && (mainRef.current === '/create' || mainRef.current === '/profile');
  useEffect(() => setDockAway(dockIsAway), [dockIsAway]);
  useEffect(() => {
    if (!MAIN_TAB_PATHS.includes(path) || path === lastTab.current) return;
    lastTab.current = path;
    tabSwitched();
  }, [path]);
  useEffect(() => {
    // the dock's own keyboard hiding is replaced by the slide above (one transform on the bar), so the keyboard drives it here
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setDockKeyboardHidden(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setDockKeyboardHidden(false));
    return () => (show.remove(), hide.remove(), setDockKeyboardHidden(false));
  }, []);

  // live connection while signed in: new alerts move the badge at once; push is re-registered quietly
  const { me: signedIn } = useMe();
  useCity(); // keeps the live connection told which city the feeds show
  useEffect(() => {
    if (!signedIn) return;
    startLive();
    // guests are never asked; a signed-up person is asked for notifications once (then just kept registered)
    void (signedIn.role === 'guest' ? resyncPush() : askPushOnce());
    return () => stopLive();
  }, [signedIn?.id]);
  useLiveEvents((e) => {
    if (e.type === 'notification') bumpUnread(1);
    if (e.type === 'notification' || e.type === 'ready' || e.type === 'alerts-changed') refreshUnread();
  });
  usePushTaps();
  // Android: Back on any page that shows the dock does not move to another tab: it asks to press again, then leaves the app.
  // (A page opened from a tab, and a form that is on a later step, handle Back themselves first.)
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;
      let last = 0;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // any main page but Home (Search, Create, Inbox, Profile, with or without the dock): Back goes to the main page you came
        // from, or to Home when you came from an inner page. Only on Home does it ask to press again, and then close the app.
        if (currentPath() !== '/') {
          router.navigate(backFromMain() as never);
          return true;
        }
        if (Date.now() - last < 2000) {
          BackHandler.exitApp();
          return true;
        }
        last = Date.now();
        showToast(t('Press back again to exit'), 'ok', 1800);
        return true;
      });
      return () => sub.remove();
    }, [t, router]),
  );
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
        tabBarItemStyle: isWide ? { borderRadius: sc(12), marginVertical: 2, paddingVertical: sp(4) } : undefined,
        tabBarStyle: isWide
          ? { backgroundColor: c.surface, borderRightColor: c.line, width: sc(232), minWidth: sc(232), maxWidth: sc(232), flexGrow: 0, flexShrink: 0, paddingTop: sp(16), paddingHorizontal: sph(10) }
          : // a floating pill: the bar itself is see-through, the pill is drawn by tabBarBackground below.
            // Room for the raised Create button and for the labels, plus the phone's home-indicator inset.
            ({ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent', borderTopWidth: 0, elevation: 0, height: barHeight, paddingTop: 0, paddingBottom: dockBottom, paddingHorizontal: sph(18), transform: [{ translateY: dockSlide }] } as never),
        tabBarBackground: isWide ? undefined : () => <DockBackground bottom={dockBottom} />,
        // icons only on the phone dock (screen readers still hear each tab's name); the side rail keeps its words
        tabBarShowLabel: isWide,
        tabBarLabelStyle: { ...fontOf('600'), fontSize: isWide ? 16 : 12 },
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
