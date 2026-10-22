import Ionicons from '@expo/vector-icons/Ionicons';
import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout } from '@/lib/layout';
import { type Mode, useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { Between } from './ui';

const MAIN_TABS = ['/', '/discover', '/create', '/inbox', '/profile'];

/** Switches the whole app between HERE (activities now) and THERE (trips later). */
export function ModeSwitch() {
  const { mode, switchMode, c } = useTheme();
  const router = useRouter();
  const path = usePathname();
  const flip = (m: Mode) => {
    if (m === mode) return;
    switchMode(m);
    // from a page inside HERE or THERE (an activity, a chat...) land on the other product's Explore once the wave covers the screen
    if (!MAIN_TABS.includes(path)) setTimeout(() => router.replace('/'), 800);
  };
  const opts: [Mode, string][] = [['here', 'HERE'], ['there', 'THERE']];
  // In THERE the switch is inverted: a dark pill with light text (in HERE it is a light pill with dark text).
  const dark = mode === 'there';
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 999, borderWidth: 1, borderColor: dark ? c.forest : c.line, backgroundColor: dark ? c.forest : 'transparent', padding: 2 }}>
      {opts.map(([m, label]) => {
        const on = mode === m;
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Switch to ${label}`} hitSlop={6} onPress={() => flip(m)} style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: on ? (dark ? 'rgba(255,255,255,0.22)' : c.accentSoft) : 'transparent' }}>
            <Text style={{ color: dark ? (on ? '#fff' : 'rgba(255,255,255,0.62)') : on ? c.forest : c.muted, fontWeight: on ? '800' : '600', fontSize: 10, letterSpacing: 0.6 }}>{label}</Text>
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
  const router = useRouter();
  const path = usePathname();
  const flip = (m: Mode) => {
    if (m === mode) return;
    switchMode(m);
    if (!MAIN_TABS.includes(path)) setTimeout(() => router.replace('/'), 800);
  };
  const opts: [Mode, string, string][] = [['here', 'HERE', 'Today & tomorrow'], ['there', 'THERE', 'Plan a trip']];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 3 }}>
      {opts.map(([m, label, sub]) => {
        const on = mode === m;
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Switch to ${label}: ${sub}`} onPress={() => flip(m)} style={{ flex: 1, minHeight: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : 'transparent' }}>
            <Text style={{ color: on ? c.forest : c.muted, fontWeight: on ? '800' : '600', fontSize: 12, letterSpacing: 0.8, lineHeight: 16 }}>{label}</Text>
            <Text style={{ color: c.muted, fontSize: 10, lineHeight: 13 }}>{sub}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The wordmark shows only the product you are in: HERE or THERE, with the green accent dot. */
export function Wordmark({ size = 20, light }: { size?: number; light?: boolean }) {
  const { c, mode } = useTheme();
  const ink = light ? '#fff' : c.forest;
  const name = mode === 'here' ? 'HERE' : 'THERE';
  return (
    <Text accessibilityRole="header" accessibilityLabel={name} style={{ fontSize: size, fontWeight: '800', letterSpacing: -0.8, color: ink }}>
      {name}<Text style={{ color: light ? '#5FC29F' : c.accent }}>.</Text>
    </Text>
  );
}

/** The wordmark with its tagline under it: "Be here. Be together." in HERE, "Go there. Together." in THERE. */
export function Brand() {
  const { mode, c } = useTheme();
  return (
    <View style={{ gap: 1 }}>
      <Wordmark />
      <Text style={{ color: c.muted, fontSize: 11, lineHeight: 14 }}>{mode === 'here' ? 'Be here. Be together.' : 'Go there. Together.'}</Text>
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
export function TabHeader({ subtitle, children, compact }: { subtitle?: string; children?: React.ReactNode; /** only the wordmark and the switch, no line underneath */ compact?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {/* top row: the wordmark and its tagline on the left, a small quiet HERE | THERE switch in the top-right corner */}
      <Between>
        <Brand />
        <ModeSwitch />
      </Between>
      {compact ? null : (children ?? (subtitle ? <Text style={{ color: c.muted, fontSize: 12 }}>{subtitle}</Text> : null))}
    </View>
  );
}

/** A header bar that stays put at the top, clear of the phone's status bar. */
export function HeaderBar({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  return (
    <View style={{ paddingTop: Math.max(insets.top, 20) + 14, paddingBottom: 6, paddingHorizontal: gutter + 6, backgroundColor: c.bg, zIndex: 2 }}>
      {children}
    </View>
  );
}

/** Header back arrow. */
export function BackArrow() {
  const router = useRouter();
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={10} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ paddingRight: 8, paddingVertical: 2 }}>
      <Ionicons name="chevron-back" size={24} color={c.text} />
    </Pressable>
  );
}

/**
 * The header of every page inside HERE and THERE (an activity, a chat, someone's profile...): the same wordmark and
 * HERE | THERE switch as the main tabs, with a back arrow, and under it the page's own title and actions.
 */
export function InnerHeader({ options }: { options: { title?: string; headerTitle?: any; headerRight?: any } }) {
  const { c } = useTheme();
  const { gutter } = useLayout();
  const title = options.title;
  const custom = typeof options.headerTitle === 'function' ? options.headerTitle({ children: title ?? '', tintColor: c.text }) : null;
  const right = typeof options.headerRight === 'function' ? options.headerRight({ tintColor: c.text, canGoBack: true }) : null;
  return (
    <View style={{ backgroundColor: c.bg, zIndex: 2 }}>
      {/* the app header: back arrow, wordmark and switch, with the line under it */}
      <HeaderBar>
        <Between>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <BackArrow />
            <Brand />
          </View>
          <ModeSwitch />
        </Between>
      </HeaderBar>
      {/* the page's own title and actions sit below that line */}
      {custom || title || right ? (
        <View style={{ paddingHorizontal: gutter + 6, paddingTop: 6, paddingBottom: 4 }}>
          <Between>
            <View style={{ flex: 1 }}>{custom ?? <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{title}</Text>}</View>
            {right}
          </Between>
        </View>
      ) : null}
    </View>
  );
}
