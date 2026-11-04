import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { headerGap, statusTop, useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';
import { type Mode, useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { Between, BandTitle, useLightStatusBar } from './ui';

const MAIN_TABS = ['/', '/discover', '/create', '/inbox', '/profile'];

const SWITCH_PAD = 3;
const SWITCH_SEG = 32;

/** Switches the whole app between HERE (activities now) and THERE (trips later). */
export function ModeSwitch(_props: { onDark?: boolean } = {}) {
  const { mode, switchMode, c } = useTheme();
  const { t } = useT();
  const router = useRouter();
  const path = usePathname();
  const flip = (m: Mode) => {
    if (m === mode) return;
    switchMode(m);
    // from a page inside HERE or THERE (an activity, a chat...) land on the other product's Explore once the wave covers the screen
    if (!MAIN_TABS.includes(path)) setTimeout(() => router.dismissTo('/' as never), 800);
  };
  const opts: [Mode, string][] = [['here', 'HERE'], ['there', 'THERE']];
  // One look in both products (the Figma THERE switch): a white pill, the open side a deep-forest pill with white text, the other word in forest.
  // 3 + 32 + 3 = 38px visible; hitSlop lifts the touch target to 44px.
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 999, backgroundColor: c.surface, padding: SWITCH_PAD, shadowColor: '#102F29', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 }}>
      {opts.map(([m, label]) => {
        const on = mode === m;
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t('Switch to {name}', { name: label })} hitSlop={{ top: 3, bottom: 3, left: 4, right: 4 }} onPress={() => flip(m)} style={{ minHeight: SWITCH_SEG, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : 'transparent' }}>
            <Text style={{ color: on ? '#fff' : c.forest, fontWeight: on ? '700' : '500', fontSize: 12, lineHeight: 16, letterSpacing: 0.6, includeFontPadding: false }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The big two-part switch under the home header: HERE (Today & tomorrow) and THERE (Plan a trip), the open one filled.
 * It does what the small HERE | THERE switch does.
 */
export function ModeTabs() {
  const { mode, switchMode, c } = useTheme();
  const { t } = useT();
  const router = useRouter();
  const path = usePathname();
  const flip = (m: Mode) => {
    if (m === mode) return;
    switchMode(m);
    if (!MAIN_TABS.includes(path)) setTimeout(() => router.dismissTo('/' as never), 800);
  };
  const opts: [Mode, string, string][] = [['here', 'HERE', 'Today & tomorrow'], ['there', 'THERE', 'Plan a trip']];
  if (mode === 'there') {
    // THERE (Figma): a soft off-white pill with a shadow, one word per side, the open one a deep green pill with white letters
    return (
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 40, backgroundColor: '#F6F4EF', padding: 8, gap: 4, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
        {opts.map(([m, label, sub]) => {
          const on = mode === m;
          return (
            <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t('Switch to {name}: {sub}', { name: label, sub: t(sub) })} onPress={() => flip(m)} style={({ pressed: p }) => [{ flex: 1, minHeight: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: on ? c.forest : 'transparent' }, p && { opacity: 0.85 }]}>
              <Text style={{ color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 14, letterSpacing: 1.2, lineHeight: 18 }}>{label}</Text>
              <Text style={{ color: on ? 'rgba(255,255,255,0.8)' : c.muted, fontSize: 12, lineHeight: 16 }}>{t(sub)}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    // a soft white pill with a shadow; the open product sits in a tinted pill inside it
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 37, backgroundColor: c.surface, padding: 9, gap: 8, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
      {opts.map(([m, label, sub]) => {
        const on = mode === m;
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t('Switch to {name}: {sub}', { name: label, sub: t(sub) })} onPress={() => flip(m)} style={({ pressed: p }) => [{ flex: 1, minHeight: 55, borderRadius: 28, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: on ? c.sand : 'transparent' }, p && { opacity: 0.85 }]}>
            <Text style={{ color: c.text, fontWeight: on ? '700' : '600', fontSize: 12, letterSpacing: 1.2, lineHeight: 16 }}>{label}</Text>
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{t(sub)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The wordmark shows only the product you are in: HERE or THERE, with the green accent dot. */
export function Wordmark({ size = 20, light }: { size?: number; light?: boolean }) {
  const { c, mode } = useTheme();
  const ink = light ? c.onBand : c.forest;
  const name = mode === 'here' ? 'HERE' : 'THERE';
  return (
    <Text accessibilityRole="header" accessibilityLabel={name} style={{ fontSize: size, fontWeight: '800', letterSpacing: -0.8, color: ink }}>
      {name}<Text style={{ color: light ? c.bandDotAlt : c.accent }}>.</Text>
    </Text>
  );
}

/** The wordmark with its tagline under it: "Be here. Be together." in HERE, "Go there. Together." in THERE. */
export function Brand({ light }: { light?: boolean } = {}) {
  const { mode, c } = useTheme();
  const { t } = useT();
  return (
    <View style={{ gap: 1 }}>
      <Wordmark light={light} />
      <Text style={{ color: light ? c.onBandMuted : c.muted, fontSize: 11, lineHeight: 14 }}>{mode === 'here' ? t('Be here. Be together.') : t('Go there. Together.')}</Text>
    </View>
  );
}

/** Kept for the splash screen. */
export function Logo({ size = 28, light }: { size?: number; light?: boolean }) {
  return <Wordmark size={size} light={light} />;
}

/**
 * Top of the five main tabs: the wordmark and the HERE | THERE switch (Profile lives in the tab bar), with an optional
 * line underneath (the city picker in HERE, a tagline elsewhere).
 */
export function TabHeader({ subtitle, children, compact, plain }: { subtitle?: string; children?: React.ReactNode; /** only the wordmark and the switch, no line underneath */ compact?: boolean; /** on the page's own colour (no band): dark wordmark */ plain?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {/* top row (on the dark band): the wordmark and its tagline on the left, a small HERE | THERE switch in the top-right corner */}
      <Between>
        <Brand light={!plain} />
        <ModeSwitch onDark={!plain} />
      </Between>
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
    <View style={{ paddingTop: statusTop(insets.top) + headerGap, paddingBottom: 6, paddingHorizontal: gutter + 6, backgroundColor: c.bg, zIndex: 2 }}>
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
    <Pressable accessibilityRole="button" accessibilityLabel={t('Go back')} hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ paddingRight: 8, paddingVertical: 2 }}>
      <Ionicons name="chevron-back" size={24} color={c.text} />
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
    <View style={{ backgroundColor: c.band, paddingTop: statusTop(insets.top) + headerGap, paddingBottom: 14, paddingHorizontal: gutter + 6, zIndex: 2 }}>
      <BandTitle title={title} custom={custom} right={right} />
    </View>
  );
}
