import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBanner } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useTheme, type Mode } from '@/lib/theme';


/** Each product has its own welcome screen: photo that fades into the page colour, big name, two buttons. */
const LOOK = {
  here: {
    bg: '#0F2F28',
    photo: require('../../../assets/welcome/here.webp'),
    title: 'HERE.',
    titleColor: '#FFFFFF',
    line1: 'Be here. Be together.',
    line2: 'Make something happen today.',
    line1Color: '#FFFFFF',
    line2Color: '#B7C7C1',
    btnBg: '#FFFFFF',
    btnText: '#0F2F28',
    footer: '18+ only · Privacy first · Terms apply',
    footerColor: '#9FB3AC',
    barStyle: 'light' as const,
  },
  there: {
    bg: '#E9E5DD',
    photo: require('../../../assets/welcome/there.webp'),
    title: 'THERE.',
    titleColor: '#143A30',
    line1: 'Go there. Together.',
    line2: 'Your next trip starts with people.',
    line1Color: '#16201D',
    line2Color: '#4A524E',
    btnBg: '#143A30',
    btnText: '#FFFFFF',
    footer: '18+ only · Verified traveler community',
    footerColor: '#6B726E',
    barStyle: 'dark' as const,
  },
};

type Look = (typeof LOOK)[Mode];

/** A faint, out-of-focus name of the other product. Tapping it switches. The blur is a text shadow, so it costs nothing. */
function OtherName({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Switch to ${label}`} hitSlop={14} onPress={onPress} style={{ paddingBottom: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: `${color}40`, textShadowColor: `${color}40`, textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } }}>{label}</Text>
    </Pressable>
  );
}

/** One complete welcome page. Both are always mounted; switching only cross-fades their opacity. */
function Page({ mode, active, onSwitch, onCreate, onSignIn, onExplore, busy, error }: { mode: Mode; active: boolean; onSwitch: () => void; onCreate: () => void; onSignIn: () => void; onExplore: () => void; busy: boolean; error?: string | null }) {
  const look: Look = LOOK[mode];
  const insets = useSafeAreaInsets();
  const other = mode === 'here' ? LOOK.there : LOOK.here;
  const button = (title: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} style={{ height: 52, borderRadius: 14, backgroundColor: look.btnBg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: look.btnText, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: look.bg }} pointerEvents={active ? 'auto' : 'none'} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!active}>
      <View style={{ flex: 1, width: '100%', maxWidth: 520 }}>
        {/* the photo melts into the page colour */}
        <View style={{ flex: 1, overflow: 'hidden', backgroundColor: look.bg }}>
          <Image source={look.photo} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} accessibilityLabel="" />
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']} locations={[0, 1]} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + 90 }} />
          <LinearGradient pointerEvents="none" colors={[`${look.bg}00`, `${look.bg}00`, `${look.bg}CC`, look.bg]} locations={[0, 0.4, 0.8, 0.97]} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: -2 }} />
        </View>
        <View style={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 48, gap: 16 }}>
          <View style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
              <Text accessibilityRole="header" style={{ color: look.titleColor, fontSize: 52, lineHeight: 58, fontWeight: '800', letterSpacing: -1.5 }}>{look.title}</Text>
              <OtherName label={other.title.replace('.', '')} color={look.titleColor} onPress={onSwitch} />
            </View>
            <Text style={{ color: look.line1Color, fontSize: 16, fontWeight: '600', marginTop: 6 }}>{look.line1}</Text>
            <Text style={{ color: look.line2Color, fontSize: 16 }}>{look.line2}</Text>
          </View>
          <View style={{ gap: 12 }}>
            <ErrorBanner message={error} />
            {button('Create an account', onCreate)}
            {button(busy ? 'One moment…' : 'Explore the demo', onExplore)}
          </View>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="link" hitSlop={12} onPress={onSignIn} style={{ minHeight: 32, justifyContent: 'center' }}>
              <Text style={{ color: look.titleColor, fontSize: 14, fontWeight: '700' }}>I already have an account</Text>
            </Pressable>
            <Text style={{ color: look.footerColor, fontSize: 12 }}>{look.footer}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** First screen: HERE and THERE under one roof, 18+ only. Tap the faint other name to cross-fade to it. */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notice, signIn } = useMe();
  const { mode, setMode } = useTheme();
  const demo = useAction();
  // "Explore the demo": a temporary read-only guest session. No account, no personal data.
  const explore = () => demo.run(async () => signIn((await post<{ token: string }>('/v1/auth/guest')).token));
  // 0 = HERE, 1 = THERE. Only opacity animates, on the native thread.
  const fade = useRef(new Animated.Value(mode === 'there' ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: mode === 'there' ? 1 : 0, duration: 900, easing: Easing.bezier(0.45, 0, 0.2, 1), useNativeDriver: true }).start();
  }, [mode, fade]);
  // the old page fades away first, then the new one fades in (no ghosting of the two together)
  const hereOpacity = fade.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const thereOpacity = fade.interpolate({ inputRange: [0.45, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const common = { onCreate: () => router.push('/register'), onSignIn: () => router.push('/login'), onExplore: explore, busy: demo.busy, error: notice ?? demo.error };
  const look = LOOK[mode];
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar style="light" />
      {/* needsOffscreenAlphaCompositing: on Android, fading a view with overlapping children fades each child on its own, which let the photo's hard lower edge show through its colour fade. This fades the page as one picture. */}
      <Animated.View needsOffscreenAlphaCompositing pointerEvents={mode === 'here' ? 'auto' : 'none'} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: hereOpacity }}>
        <Page mode="here" active={mode === 'here'} onSwitch={() => setMode('there')} {...common} />
      </Animated.View>
      <Animated.View needsOffscreenAlphaCompositing pointerEvents={mode === 'there' ? 'auto' : 'none'} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: thereOpacity }}>
        <Page mode="there" active={mode === 'there'} onSwitch={() => setMode('here')} {...common} />
      </Animated.View>
    </View>
  );
}
