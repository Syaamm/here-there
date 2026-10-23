import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InnerHeader, Logo } from '@/components/TabHeader';
import { AuthProvider, useMe } from '@/lib/auth';
import { PhoneFrame } from '@/components/PhoneFrame';
import { ScaleProvider } from '@/lib/scale';
import { installWebScrolling } from '@/lib/webScroll';
import { restoreLoadCache } from '@/lib/hooks';
import { trackPath } from '@/lib/nav';
import { ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
  useEffect(() => installWebScrolling(), []);
  return (
    <PhoneFrame>
    <SafeAreaProvider>
      <ScaleProvider>
        <ThemeProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </ThemeProvider>
      </ScaleProvider>
    </SafeAreaProvider>
    </PhoneFrame>
  );
}

/** Signed-out people only ever see the (auth) screens; signed-in people never do. */
/** Options of a page with the app header (wordmark, HERE | THERE, back arrow) and its own title under it. */
const inner = (title: string) => ({ title, header: ({ options }: { options: any }) => <InnerHeader options={options} /> });

function Gate() {
  const { me, ready } = useMe();
  trackPath(usePathname()); // remembers where the person came from (see lib/nav)
  const { c } = useTheme();
  // what this person's pages showed last time is loaded before the first screen, so the app opens on its last view
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    if (me?.id) void restoreLoadCache(me.id).finally(() => setRemembered(me.id));
    else setRemembered(null);
  }, [me?.id]);

  if (!ready || (me && remembered !== me.id))
    return (
      <WebFrame>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.forest, gap: 16 }}>
          <Logo size={40} light />
          <ActivityIndicator color="#fff" />
        </View>
      </WebFrame>
    );

  return (
    <WebFrame>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          // SDK 58 makes iOS headers transparent by default; keep ours solid so content sits below them.
          headerTransparent: false,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: c.bg },
          headerTintColor: c.text,
          headerBackTitle: 'Back',
          // pages pushed on top (verify) slide in smoothly
          animation: 'slide_from_right',
          animationDuration: 240,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Protected guard={!!me}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Every page opened from another page is a screen of its own above the tabs, like in any iPhone app: dragging it
              away from the left edge shows the page it came from underneath, already there, and going back never reloads it. */}
          <Stack.Screen name="activity/[id]" options={inner('Activity')} />
          <Stack.Screen name="trip/[id]" options={inner('Trip')} />
          <Stack.Screen name="join/[id]" options={inner('Request to join')} />
          <Stack.Screen name="apply/[id]" options={inner('Apply to join')} />
          <Stack.Screen name="host/[id]" options={inner('Manage join requests')} />
          <Stack.Screen name="review/[id]" options={inner('Review travelers')} />
          <Stack.Screen name="group/[id]" options={inner('Group info')} />
          <Stack.Screen name="user/[id]" options={inner('Profile')} />
          <Stack.Screen name="safety" options={inner('Safety & privacy')} />
          <Stack.Screen name="settings" options={inner('Settings')} />
          <Stack.Screen name="activities" options={inner('All activities')} />
          <Stack.Screen name="edit-profile" options={inner('Edit profile')} />
          <Stack.Screen name="my-activities" options={inner('My activities')} />
          {/* a chat is its own screen above the tabs, like a chat in any messaging app: the iPhone's own swipe-back shows the inbox underneath as you drag */}
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="verify" options={{ title: 'Verify your identity', header: ({ options }) => <InnerHeader options={options} /> }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!me}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </WebFrame>
  );
}

/**
 * In a browser the app is responsive, like a website: phone layout in a narrow window, tablet layout in a
 * medium one, and a side navigation rail with multi-column screens when wide. On very large monitors it stops
 * growing at 1440 px and is centred. On iOS and Android this does nothing and the app fills the screen.
 */
function WebFrame({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 1440, overflow: 'hidden', backgroundColor: c.bg }}>{children}</View>
    </View>
  );
}
