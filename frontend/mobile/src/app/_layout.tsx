import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InnerHeader } from '@/components/TabHeader';
import { SplashLogo } from '@/components/SplashLogo';
import { AlertBanner } from '@/components/AlertBanner';
import { DialogHost } from '@/components/AppDialog';
import { Toast } from '@/components/Toast';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { AuthProvider, useMe } from '@/lib/auth';
import { useAppFonts } from '@/lib/fonts';
import { PhoneFrame } from '@/components/PhoneFrame';
import { LangProvider, useT } from '@/lib/i18n';
import { ScaleProvider } from '@/lib/scale';
import { installWebScrolling } from '@/lib/webScroll';
import { restoreLoadCache } from '@/lib/hooks';
import { forgetLink, takeLink } from '@/lib/shareLink';
import { trackPath } from '@/lib/nav';
import { ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
  useEffect(() => installWebScrolling(), []);
  return (
    <PhoneFrame>
    <SafeAreaProvider>
      <ScaleProvider>
        <LangProvider>
          <ThemeProvider>
            <AuthProvider>
              <Gate />
            </AuthProvider>
          </ThemeProvider>
        </LangProvider>
      </ScaleProvider>
    </SafeAreaProvider>
    </PhoneFrame>
  );
}

/** Signed-out people only ever see the (auth) screens; signed-in people never do. */
/** Options of a page with the app header (wordmark, HERE | THERE, back arrow) and its own title under it. */
const inner = (title: string) => ({ title, header: ({ options }: { options: any }) => <InnerHeader options={options} /> });
/** Pages listed in lib/pageTitles draw the curved band themselves (Screen), so their stack header is off. */
const banded = { headerShown: false };

function Gate() {
  const { t } = useT();
  const { me, ready } = useMe();
  const fontsDone = useAppFonts(); // the app's typeface, before the first screen draws any text
  trackPath(usePathname()); // remembers where the person came from (see lib/nav)
  const { c } = useTheme();
  // what this person's pages showed last time is loaded before the first screen, so the app opens on its last view
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    if (me?.id) void restoreLoadCache(me.id).finally(() => setRemembered(me.id));
    else setRemembered(null);
  }, [me?.id]);

  // A shared link tapped while signed out is kept (see +native-intent). When the app was opened signed in, the router has
  // already gone to it; when it was opened signed out, signing in carries on to it, once.
  const router = useRouter();
  const startedSignedIn = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready || startedSignedIn.current !== null) return;
    startedSignedIn.current = !!me;
    if (me) forgetLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    if (startedSignedIn.current !== false || !me || remembered !== me.id) return;
    const target = takeLink();
    if (target) router.push(target as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, remembered]);

  // the opening animation plays once per launch; the app waits for it to end (about 2.8 s) as well as for its data
  const [splashDone, setSplashDone] = useState(false);
  if (!splashDone || !ready || !fontsDone || (me && remembered !== me.id))
    return (
      <WebFrame>
        {/* the splash sits on the mode's band: light clock on HERE's dark green, dark on THERE's sand; the LAMIS dot hops across and spells the word */}
        <StatusBar style={c.bandIsDark ? 'light' : 'dark'} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.band }}>
          <SplashLogo ink={c.onBand} onDone={() => setSplashDone(true)} />
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
          headerBackTitle: t('Back'),
          // pages pushed on top (verify) slide in smoothly
          // iPhone: the system's slide, with the swipe back. Android: pages swap at once, and the page you come BACK to eases its
          // content in like a dock tab does (PageTransition), so there is no white fade between the two.
          animation: Platform.OS === 'android' ? 'none' : 'slide_from_right',
          animationDuration: 240,
          // a page that has another one open on top of it stops re-rendering (polls, live events) until you come back, so the slide stays smooth
          freezeOnBlur: true,
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        {/* signed out: the signed-in pages are not there, so go to the welcome page (the router has no default for a bare "/") */}
        <Stack.Protected guard={!!me} redirectTo="/welcome">
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* Every page opened from another page is a screen of its own above the tabs, like in any iPhone app: dragging it
              away from the left edge shows the page it came from underneath, already there, and going back never reloads it. */}
          <Stack.Screen name="activity/[id]" options={banded} />
          <Stack.Screen name="trip/[id]" options={banded} />
          <Stack.Screen name="join/[id]" options={banded} />
          <Stack.Screen name="apply/[id]" options={banded} />
          <Stack.Screen name="host/[id]" options={banded} />
          <Stack.Screen name="review/[id]" options={banded} />
          <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="user/[id]" options={banded} />
          <Stack.Screen name="safety" options={banded} />
          <Stack.Screen name="settings" options={banded} />
          <Stack.Screen name="activities" options={banded} />
          <Stack.Screen name="trips" options={banded} />
          <Stack.Screen name="edit-profile" options={banded} />
          <Stack.Screen name="change-password" options={banded} />
          <Stack.Screen name="my-data" options={banded} />
          <Stack.Screen name="retention" options={banded} />
          <Stack.Screen name="reliability" options={banded} />
          <Stack.Screen name="no-shows/[kind]/[id]" options={banded} />
          <Stack.Screen name="change-email" options={banded} />
          <Stack.Screen name="delete-account" options={banded} />
          <Stack.Screen name="my-activities" options={banded} />
          <Stack.Screen name="my-trips" options={banded} />
          <Stack.Screen name="drafts" options={banded} />
          <Stack.Screen name="notification-settings" options={banded} />
          <Stack.Screen name="reports-blocked" options={banded} />
          <Stack.Screen name="travel-match" options={banded} />
          <Stack.Screen name="trip-plan/[id]" options={banded} />
          <Stack.Screen name="appeal" options={banded} />
          <Stack.Screen name="favourites" options={banded} />
          <Stack.Screen name="connections" options={banded} />
          {/* a chat is its own screen above the tabs, like a chat in any messaging app: the iPhone's own swipe-back shows the inbox underneath as you drag */}
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="verify" options={banded} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!me}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
      {/* phones show alerts as their own banners (lib/push); the browser keeps this in-app strip */}
      {me && Platform.OS === 'web' ? <AlertBanner /> : null}
      <Toast />
      {/* pop-ups in the app's own look on Android (iPhone keeps its system alert) */}
      <DialogHost />
      <UpdatePrompt />
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
