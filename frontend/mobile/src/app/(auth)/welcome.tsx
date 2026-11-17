import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LamisWordmark } from '@/components/LamisWordmark';
import { ErrorBanner } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { tap } from '@/lib/haptics';
import { useAction } from '@/lib/hooks';
import { useTheme, type Mode } from '@/lib/theme';
import { useT } from '@/lib/i18n';
import { tracking, sc, sp, sph } from '@/lib/scale';

const FOREST = '#102F29';
const PANEL = '#112F2B';
const IVORY = '#E9E5DD';

/**
 * Each product has its own welcome page, drawn the same way (Figma "iPhone 17 - 2" for HERE, "iPhone 17 - 16" for THERE):
 * a photo that melts into the page colour, the big name with the other product's name faint beside it, and a white sheet
 * with the actions. Only the colours, the photo and a few offsets differ.
 */
const LOOK = {
  here: {
    bg: PANEL,
    fill: true, // the photo fills its box (cropped; `anchor` = which part of the picture stays in view, 0 top .. 1 bottom)
    anchor: 0.3,
    photo: require('../../../assets/welcome/lamis.jpg'),
    photoRatio: 1, // height / width of the picture
    photoW: 1.109, // the picture is a little wider than the screen, nudged up and left (all as a share of the screen width)
    photoLeft: -0.055,
    photoTop: -0.047,
    fadeTop: 0.33, // where the photo starts to melt into the page colour (share of the screen height)
    fadeH: 0.09,
    fadeColors: ['rgba(17,47,43,0)', 'rgba(17,47,43,0.6)', PANEL] as const,
    fadeAt: [0, 0.45, 1] as const,
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
    fill: true,
    anchor: 0.62,
    photo: require('../../../assets/welcome/there.jpg'),
    photoRatio: 1.339,
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
function Page({ mode, sheetH }: { mode: Mode; sheetH: number }) {
  const { t } = useT();
  const look = LOOK[mode];
  const insets = useSafeAreaInsets();
  const { width: screenW, height } = useWindowDimensions();
  const width = Math.min(screenW, 520);
  const fadeTop = Math.round(height * look.fadeTop);
  const fadeH = Math.round(height * look.fadeH);
  const boxH = fadeTop + fadeH; // the photo's box
  return (
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: look.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: sc(520), backgroundColor: look.bg }}>
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: fadeTop + fadeH, overflow: 'hidden' }}>
          <Image source={look.photo} resizeMode="cover" accessibilityLabel="" style={look.fill ? { position: 'absolute', left: 0, width, height: Math.max(boxH, width * look.photoRatio), top: -(Math.max(boxH, width * look.photoRatio) - boxH) * look.anchor } : { position: 'absolute', left: width * look.photoLeft, top: width * look.photoTop, width: width * look.photoW, height: width * look.photoW * look.photoRatio }} />
          {look.scrim ? <LinearGradient colors={['rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + 90 }} /> : null}
          <LinearGradient colors={look.fadeColors} locations={look.fadeAt} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: fadeH }} />
        </View>
        <View style={{ flex: 1 }} />
        {/* the name, then the line under it */}
        <View style={{ paddingHorizontal: sph(20), marginBottom: sp(40) }}>
          {/* the official wordmark */}
          <View style={{ alignSelf: 'flex-start' }}>
            <LamisWordmark height={Math.round((width * 0.47 * 276) / 947)} onDark={mode === 'here'} />
          </View>
          <Text style={{ color: look.taglineColor, fontSize: 20, fontWeight: '500', marginTop: sp(8) }}>{t(look.tagline)}</Text>
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
  const pill = { minHeight: sc(58), borderRadius: sc(32), borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View onLayout={(e) => onHeight(e.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
      <View style={{ width: '100%', maxWidth: sc(520) }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: sc(54), borderTopRightRadius: sc(54), paddingTop: Math.round(height * 0.055), paddingHorizontal: sph(22), paddingBottom: insets.bottom + 14, minHeight: height * 0.44 }}>
          <ErrorBanner message={error} />
          <Pressable accessibilityRole="button" onPress={() => { tap('Medium'); onLogin(); }} style={({ pressed: p }) => [pill, { backgroundColor: FOREST }, p && { opacity: 0.88 }]}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '500' }}>{t('Log in')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => { tap('Light'); onExplore(); }} style={({ pressed: p }) => [pill, { marginTop: sp(10), opacity: busy ? 0.5 : 1 }, p && { opacity: 0.88 }]}>
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '500' }}>{busy ? t('One moment…') : t('Explore')}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(10), marginTop: sp(37) }}>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.09)' }} />
            <Text style={{ color: 'rgba(0,0,0,0.6)', fontSize: 12 }}>{t("Don't have an account?")}</Text>
            <Pressable accessibilityRole="link" hitSlop={12} onPress={() => { tap('Light'); onSignUp(); }} style={{ minHeight: sc(32), justifyContent: 'center' }}>
              <Text style={{ color: FOREST, fontSize: 12, fontWeight: '500' }}>{t('Sign up')}</Text>
            </Pressable>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(0,0,0,0.09)' }} />
          </View>
          <View style={{ flex: 1 }} />
          <Text style={{ color: 'rgba(0,0,0,0.6)', fontSize: 12, textAlign: 'center', marginTop: sp(24) }}>{t(FOOTER)}</Text>
        </View>
      </View>
    </View>
  );
}

/** First screen: the green LAMIS page, 18+ only. There is no HERE / THERE switch here (the product is chosen inside the app). */
export default function Welcome() {
  const router = useRouter();
  const { notice, signIn } = useMe();
  const demo = useAction();
  const { height: screenH } = useWindowDimensions();
  const [sheetH, setSheetH] = useState(Math.round(screenH * 0.44)); // measured once the sheet is drawn (an error line makes it taller)
  // "Explore": a temporary read-only guest session. No account, no personal data.
  const explore = () => demo.run(async () => signIn(await post<{ token: string }>('/v1/auth/guest')));
  const common = { onLogin: () => router.push('/login'), onSignUp: () => router.push('/register'), onExplore: explore, busy: demo.busy, error: notice ?? demo.error };
  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar style={LOOK.here.bar} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        <Page mode="here" sheetH={sheetH} />
      </View>
      <Sheet {...common} onHeight={setSheetH} />
    </View>
  );
}
