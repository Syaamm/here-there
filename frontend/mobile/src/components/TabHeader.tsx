import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { headerGap, statusTop, useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';
import { type Mode, useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { BandTitle, useLightStatusBar } from './ui';
import { LamisWordmark } from './LamisWordmark';

import { sc, sp, sph } from '@/lib/scale';
const MAIN_TABS = ['/', '/discover', '/create', '/inbox', '/profile'];

/**
 * The big two-part switch under the home header: HERE and THERE, the open one filled.
 * The only HERE | THERE switch in the app: it is on the home pages.
 */
export function ModeTabs() {
  const { mode, switchMode, c } = useTheme();
  const { t } = useT();
  const router = useRouter();
  const path = usePathname();
  const flip = (m: Mode) => {
    if (m === mode) return;
    // from a page inside HERE or THERE, land on the other product's Home once the switch has covered the screen
    switchMode(m, MAIN_TABS.includes(path) ? undefined : () => router.dismissTo('/' as never));
  };
  const opts: [Mode, string][] = [['here', 'HERE'], ['there', 'THERE']];
  // Two looks, one per product (the designs): HERE is a white bar whose open side is a soft light-green-grey pill with dark letters;
  // THERE is an off-white bar whose open side is a deep green pill with white letters. A soft shadow on both, one word per side.
  const hereLook = mode === 'here';
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: sc(40), backgroundColor: hereLook ? '#FFFFFF' : '#F6F4EF', padding: sp(8), gap: sp(4), shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
      {opts.map(([m, label]) => {
        const on = mode === m;
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t('Switch to {name}', { name: label })} onPress={() => flip(m)} style={({ pressed: p }) => [{ flex: 1, minHeight: sc(48), borderRadius: sc(24), alignItems: 'center', justifyContent: 'center', backgroundColor: on ? (hereLook ? '#E9EDEA' : c.forest) : 'transparent' }, p && { opacity: 0.85 }]}>
            <Text style={{ color: on && !hereLook ? '#fff' : c.text, fontWeight: '700', fontSize: 16, letterSpacing: 1.2, lineHeight: 21 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The LAMIS wordmark: the light logo on a dark page or band, the dark logo on a light one. `size` is the old text size; the logo is a bit taller. */
export function Wordmark({ size = 20, light }: { size?: number; light?: boolean }) {
  return <LamisWordmark onDark={light} height={Math.round(size * 1.15)} />;
}

/** The LAMIS wordmark with the one tagline under it: "Be here. Go there." */
export function Brand({ light }: { light?: boolean } = {}) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View style={{ gap: sp(6) }}>
      <Wordmark size={24} light={light} />
      <Text style={{ color: light ? c.onBandMuted : c.muted, fontSize: 12, lineHeight: 15 }}>{t('Be here. Go there.')}</Text>
    </View>
  );
}

/**
 * Top of the main tabs that have no header of their own: the wordmark, with an optional line underneath.
 */
export function TabHeader({ subtitle, children, compact, plain }: { subtitle?: string; children?: React.ReactNode; /** only the wordmark and the switch, no line underneath */ compact?: boolean; /** on the page's own colour (no band): dark wordmark */ plain?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: sp(6) }}>
      {/* the wordmark and its tagline (switching HERE | THERE is on the home page only) */}
      <Brand light={!plain} />
      {compact ? null : (children ?? (subtitle ? <Text style={{ color: c.onBandMuted, fontSize: 12 }}>{subtitle}</Text> : null))}
    </View>
  );
}

/** A header bar that stays put at the top, clear of the phone's status bar. */
export function HeaderBar({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  return (
    <View style={{ paddingTop: statusTop(insets.top) + headerGap, paddingBottom: sp(6), paddingHorizontal: gutter + 6, backgroundColor: c.bg, zIndex: 2 }}>
      {children}
    </View>
  );
}

/** Header back arrow. */
export function BackArrow() {
  const router = useRouter();
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Go back')} hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ paddingRight: sph(8), paddingVertical: 2 }}>
      <Ionicons name="chevron-back" size={sc(24)} color={c.text} />
    </Pressable>
  );
}

/**
 * The stack header of the pages that keep a native header (an activity, a trip, a group, someone's profile while they load...):
 * the same deep-forest band as Screen's, with the round back button and the title in white. The page's own picture follows below.
 */
export function InnerHeader({ options }: { options: { title?: string; headerTitle?: any; headerRight?: any } }) {
  const { c } = useTheme();
  const { t } = useT();
  const { gutter } = useLayout();
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  const title = options.title ? t(options.title) : options.title; // layouts keep the English title; it is translated here
  const custom = typeof options.headerTitle === 'function' ? options.headerTitle({ children: title ?? '', tintColor: c.onBand }) : null;
  const right = typeof options.headerRight === 'function' ? options.headerRight({ tintColor: c.onBand, canGoBack: true }) : null;
  return (
    <View style={{ backgroundColor: c.band, paddingTop: statusTop(insets.top) + headerGap, paddingBottom: sp(14), paddingHorizontal: gutter + 6, zIndex: 2 }}>
      <BandTitle title={title} custom={custom} right={right} />
    </View>
  );
}
