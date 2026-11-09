import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBanner } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { tap } from '@/lib/haptics';
import { useAction } from '@/lib/hooks';
import { useTheme, type Mode } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { INTRO_KEY } from './intro';
import { tracking } from '@/lib/scale';

const FOREST = '#102F29';
const IVORY = '#E9E5DD';

/**
 * Each product has its own welcome page, drawn the same way (Figma "iPhone 17 - 2" for HERE, "iPhone 17 - 16" for THERE):
 * a photo that melts into the page colour, the big name with the other product's name faint beside it, and a white sheet
 * with the actions. Only the colours, the photo and a few offsets differ.
 */
const LOOK = {
  here: {
    bg: FOREST,
    photo: require('../../../assets/welcome/here.webp'),
    photoRatio: 1, // height / width of the picture
    photoW: 1.109, // the picture is a little wider than the screen, nudged up and left (all as a share of the screen width)
    photoLeft: -0.055,
    photoTop: -0.047,
    fadeTop: 0.28, // where the photo starts to melt into the page colour (share of the screen height)
    fadeH: 0.09,
    fadeColors: ['rgba(16,47,41,0)', 'rgba(30,89,77,0.59)', FOREST] as const,
    fadeAt: [0, 0.3, 1] as const,
    scrim: true, // a soft dark band behind the white status bar
    name: 'HERE',
    other: 'THERE',
    nameColor: '#FFFFFF',
    otherColor: 'rgba(255,255,255,0.35)',
    dot: '#67A987',
    tagline: 'Be here. Go there.',
    taglineColor: '#FFFFFF',
    sheetTop: 56,
    dividerGap: 37,
    bar: 'light' as const,
  },
  there: {
    bg: IVORY,
    photo: require('../../../assets/welcome/there.webp'),
    photoRatio: 0.826,
    photoW: 1.154,
    photoLeft: -0.077,
    photoTop: -0.047,
    fadeTop: 0.264,
    fadeH: 0.148,
    fadeColors: ['rgba(233,229,221,0)', 'rgba(233,229,221,0.59)', IVORY] as const,
    fadeAt: [0, 0.58, 1] as const,
    scrim: false,
    name: 'THERE',
    other: 'HERE',
    nameColor: '#000000',
    otherColor: 'rgba(0,0,0,0.27)',
    dot: FOREST,
    tagline: 'Be here. Go there.',
    taglineColor: '#000000',
    sheetTop: 56, // the same as HERE, so the buttons do not jump when switching (Figma has them 11 px higher here)
    dividerGap: 37,
    bar: 'dark' as const,
  },
};

const FOOTER = '18+ only · Privacy first · Terms apply';

/** The coloured half of a welcome page: the photo, the page colour and the name. Both are always mounted; switching only cross-fades their opacity. The white sheet below is not part of it. */
function Page({ mode, active, onSwitch, sheetH }: { mode: Mode; active: boolean; onSwitch: () => void; sheetH: number }) {
  const { t } = useT();
  const look = LOOK[mode];
  const insets = useSafeAreaInsets();
  const { width: screenW, height } = useWindowDimensions();
  const width = Math.min(screenW, 520);
  const fadeTop = Math.round(height * look.fadeTop);
  const fadeH = Math.round(height * look.fadeH);
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: look.bg }} pointerEvents={active ? 'auto' : 'none'} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!active}>
      <View style={{ flex: 1, width: '100%', maxWidth: 520, backgroundColor: look.bg }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: fadeTop + fadeH, overflow: 'hidden' }}>
          <Image source={look.photo} resizeMode="cover" accessibilityLabel="" style={{ position: 'absolute', left: width * look.photoLeft, top: width * look.photoTop, width: width * look.photoW, height: width * look.photoW * look.photoRatio }} />
          {look.scrim ? <LinearGradient colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + 90 }} /> : null}
          <LinearGradient colors={look.fadeColors} locations={look.fadeAt} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fadeH }} />
        </View>
        <View style={{ flex: 1 }} />
        {/* the name, then the line under it */}
        <View style={{ paddingHorizontal: 20, marginBottom: 50 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <Text accessibilityRole="header" style={{ color: look.nameColor, fontSize: 62, lineHeight: 68, fontWeight: '700', letterSpacing: tracking(-2.5) }}>{look.name}</Text>
            <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: look.dot, marginLeft: 8, marginRight: 16, marginBottom: 14 }} />
            {/* the faint name of the other product: tapping it switches */}
            <Pressable accessibilityRole="button" accessibilityLabel={t('Switch to {name}', { name: look.other })} hitSlop={14} onPress={onSwitch} style={{ marginBottom: 10 }}>
              <Text style={{ color: look.otherColor, fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: tracking(-1.2) }}>{look.other}</Text>
            </Pressable>
          </View>
          <Text style={{ color: look.taglineColor, fontSize: 16, fontWeight: '500', marginTop: 10 }}>{t(look.tagline)}</Text>
        </View>
        {/* the white sheet is drawn once by Welcome and never animates: this only keeps its room */}
        <View style={{ height: sheetH }} />
      </View>
    </View>
  );
}

/** The white sheet with the actions. Drawn once and shared by both products, so it stays still while the photo and colour above it change. */
function Sheet({ onLogin, onSignUp, onExplore, busy, error, onHeight }: { onLogin: () => void; onSignUp: () => void; onExplore: () => void; busy: boolean; error?: string | null; onHeight: (h: number) => void }) {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const pill = { minHeight: 58, borderRadius: 32, borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View onLayout={(e) => onHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: 520 }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 54, borderTopRightRadius: 54, paddingTop: 56, paddingHorizontal: 22, paddingBottom: insets.bottom + 14, minHeight: height * 0.44 }}>
          <ErrorBanner message={error} />
          <Pressable accessibilityRole="button" onPress={() => { tap('Medium'); onLogin(); }} style={({ pressed: p }) => [pill, { backgroundColor: FOREST }, p && { opacity: 0.88 }]}>
            <Text style={{ color: '#fff', fontSize: 15.6, fontWeight: '500' }}>{t('Log in')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { tap('Light'); onExplore(); }} style={({ pressed: p }) => [pill, { marginTop: 10, opacity: busy ? 0.5 : 1 }, p && { opacity: 0.88 }]}>
            <Text style={{ color: '#000', fontSize: 16.4, fontWeight: '500' }}>{busy ? t('One moment…') : t('Explore the demo')}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 37 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.09)' }} />
            <Text style={{ color: 'rgba(0,0,0,0.6)', fontSize: 12 }}>{t("Don't have an account?")}</Text>
            <Pressable accessibilityRole="link" hitSlop={12} onPress={() => { tap('Light'); onSignUp(); }} style={{ minHeight: 32, justifyContent: 'center' }}>
              <Text style={{ color: FOREST, fontSize: 12, fontWeight: '500' }}>{t('Sign up')}</Text>
            </Pressable>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.09)' }} />
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ color: 'rgba(0,0,0,0.6)', fontSize: 12, textAlign: 'center', marginTop: 24 }}>{t(FOOTER)}</Text>
        </View>
      </View>
    </View>
  );
}

/** First screen: HERE and THERE under one roof, 18+ only. Tap the faint other name to cross-fade to it. */
export default function Welcome() {
  const router = useRouter();
  const { notice, signIn } = useMe();
  const { mode, setMode } = useTheme();
  const demo = useAction();
  const { height: screenH } = useWindowDimensions();
  const [sheetH, setSheetH] = useState(Math.round(screenH * 0.44)); // measured once the sheet is drawn (an error line makes it taller)
  // a first-time visitor sees the intro pictures first (once); until that is known, nothing of this page is drawn
  const [introSeen, setIntroSeen] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(INTRO_KEY)
      .then((v) => (v === '1' ? setIntroSeen(true) : router.replace('/intro' as never)))
      .catch(() => setIntroSeen(true));
  }, [router]);
  // "Explore the demo": a temporary read-only guest session. No account, no personal data.
  const explore = () => demo.run(async () => signIn(await post<{ token: string }>('/v1/auth/guest')));
  // 0 = HERE, 1 = THERE. Only opacity animates, on the native thread.
  const fade = useRef(new Animated.Value(mode === 'there' ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(fade, { toValue: mode === 'there' ? 1 : 0, duration: 900, easing: Easing.bezier(0.45, 0, 0.2, 1), useNativeDriver: true }).start();
  }, [mode, fade]);
  // the old page fades away first, then the new one fades in (no ghosting of the two together)
  const hereOpacity = fade.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const thereOpacity = fade.interpolate({ inputRange: [0.45, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  if (!introSeen) return <View style={{ flex: 1, backgroundColor: FOREST }} />;
  const common = { onLogin: () => router.push('/login'), onSignUp: () => router.push('/register'), onExplore: explore, busy: demo.busy, error: notice ?? demo.error };
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar style={LOOK[mode].bar} />
      {/* needsOffscreenAlphaCompositing: on Android, fading a view with overlapping children fades each child on its own, which let the photo's hard lower edge show through its colour fade. This fades the page as one picture. */}
      <Animated.View needsOffscreenAlphaCompositing pointerEvents={mode === 'here' ? 'auto' : 'none'} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: hereOpacity }}>
        <Page mode="here" active={mode === 'here'} onSwitch={() => setMode('there')} sheetH={sheetH} />
      </Animated.View>
      <Animated.View needsOffscreenAlphaCompositing pointerEvents={mode === 'there' ? 'auto' : 'none'} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: thereOpacity }}>
        <Page mode="there" active={mode === 'there'} onSwitch={() => setMode('here')} sheetH={sheetH} />
      </Animated.View>
      <Sheet {...common} onHeight={setSheetH} />
    </View>
  );
}
