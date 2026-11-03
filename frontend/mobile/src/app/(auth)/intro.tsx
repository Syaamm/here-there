import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, PanResponder, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ScaledText';
import { useT } from '@/lib/i18n';

/** Set once the first-launch pictures have been seen; the welcome page sends a first-time visitor here until then. */
export const INTRO_KEY = 'ht_intro';

const PHOTOS = [require('../../../assets/intro/1.webp'), require('../../../assets/intro/2.webp'), require('../../../assets/intro/3.webp'), require('../../../assets/intro/4.webp')];
const EVERY_MS = 4000;
const KNOB_W = 116;
const TRACK_PAD = 5;

/**
 * First launch (Figma "Journeys Made Simple"): full-screen photos that change by themselves, a progress bar on top, the
 * line, and a "slide to continue" control. Tapping the white Continue button does the same as sliding it, so it works for
 * people who cannot drag.
 */
export default function Intro() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [at, setAt] = useState(0);
  const fade = useRef(PHOTOS.map((_, i) => new Animated.Value(i === 0 ? 1 : 0))).current;
  const reduce = useRef(false);
  const [trackW, setTrackW] = useState(0);
  const drag = useRef(new Animated.Value(0)).current;
  const maxDrag = Math.max(0, trackW - KNOB_W - TRACK_PAD * 2);
  const maxRef = useRef(0);
  maxRef.current = maxDrag;
  const going = useRef(false);

  const finish = () => {
    if (going.current) return;
    going.current = true;
    AsyncStorage.setItem(INTRO_KEY, '1').catch(() => {});
    router.replace('/choose' as never);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // the photos change by themselves (not when the person asked their phone for less motion)
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => (reduce.current = r))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (reduce.current) return;
      setAt((cur) => (cur + 1) % PHOTOS.length);
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    PHOTOS.forEach((_, i) => Animated.timing(fade[i], { toValue: i === at ? 1 : 0, duration: reduce.current ? 1 : 700, easing: Easing.out(Easing.quad), useNativeDriver: true }).start());
  }, [at, fade]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => drag.setValue(Math.min(maxRef.current, Math.max(0, g.dx))),
      onPanResponderRelease: (_, g) => {
        if (maxRef.current > 0 && g.dx > maxRef.current * 0.6) {
          Animated.timing(drag, { toValue: maxRef.current, duration: 120, useNativeDriver: true }).start(() => finishRef.current());
        } else Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
      onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
    }),
  ).current;

  const box = Math.min(width, 520);
  return (
    <View style={{ flex: 1, backgroundColor: '#0B1F1B', alignItems: 'center' }}>
      <StatusBar style="light" />
      <View style={{ width: '100%', maxWidth: 520, flex: 1 }}>
        {PHOTOS.map((src, i) => (
          <Animated.View key={i} pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: fade[i] }}>
            <Image source={src} resizeMode="cover" accessibilityLabel="" style={{ width: box, height }} />
          </Animated.View>
        ))}
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: insets.top + 110 }} />
        <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']} locations={[0, 1]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: height * 0.5 }} />

        {/* which picture, as a row of bars */}
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: PHOTOS.length, now: at + 1 }} style={{ position: 'absolute', left: 16, right: 16, top: insets.top + 18, flexDirection: 'row', gap: 8 }}>
          {PHOTOS.map((_, i) => (
            <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= at ? '#fff' : 'rgba(255,255,255,0.3)' }} />
          ))}
        </View>

        <View style={{ position: 'absolute', left: 14, right: 14, bottom: insets.bottom + 40 + 62 + 24 }}>
          <Text accessibilityRole="header" style={{ color: '#fff', fontSize: 48, lineHeight: 56, fontWeight: '400' }}>{t('Journeys')}{'\n'}{t('Made Simple')}</Text>
          <Text style={{ color: '#fff', fontSize: 16, marginTop: 20, marginLeft: 12 }}>{t('One community.')}</Text>
        </View>

        {/* slide to continue */}
        <View onLayout={(e) => setTrackW(e.nativeEvent.layout.width)} style={{ position: 'absolute', left: 16, right: 22, bottom: insets.bottom + 40, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.22)', justifyContent: 'center' }}>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', right: 40, color: '#fff', fontSize: 16 }}>{t('Slide')}</Text>
          <Animated.View {...pan.panHandlers} style={{ marginLeft: TRACK_PAD, width: KNOB_W, transform: [{ translateX: drag }] }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Continue')} accessibilityHint={t('Slide to continue')} onPress={finish} style={({ pressed }) => [{ height: 51, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.9 }]}>
              <Text style={{ color: '#000', fontSize: 16 }}>{t('Continue')}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
