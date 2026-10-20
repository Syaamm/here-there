import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Logo } from '@/components/TabHeader';
import { AuthProvider, useMe } from '@/lib/auth';
import { ThemeProvider, useTheme } from '@/lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Signed-out people only ever see the (auth) screens; signed-in people never do. */
function Gate() {
  const { me, ready } = useMe();
  const { c } = useTheme();

  if (!ready)
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
          contentStyle: { backgroundColor: c.bg },
        }}
      >
        <Stack.Protected guard={!!me} redirectTo="/welcome">
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* activity, trip, join, apply, host, review, chat and safety live inside (tabs), so the tab bar stays visible */}
          <Stack.Screen name="verify" options={{ title: 'Verify your identity' }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!me} redirectTo="/">
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
  if (Platform.OS !== 'web') return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: '#EEF2EF' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 1440, overflow: 'hidden', backgroundColor: '#FFFFFF' }}>{children}</View>
    </View>
  );
}
