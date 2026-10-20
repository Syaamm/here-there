import { Pressable, Text, View } from 'react-native';
import { useMe } from '@/lib/auth';
import { type Mode, useTheme } from '@/lib/theme';
import { Between, Row, useGo } from './ui';

/** Switches the whole app between HERE (activities now) and THERE (trips later). */
export function ModeSwitch() {
  const { mode, switchMode, c } = useTheme();
  const opts: [Mode, string][] = [['here', 'HERE'], ['there', 'THERE']];
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 999, borderWidth: 1, borderColor: c.line, padding: 3 }}>
      {opts.map(([m, label]) => {
        const on = mode === m;
        return (
          <Pressable key={m} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`Switch to ${label}`} onPress={() => switchMode(m)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: on ? c.forest : 'transparent' }}>
            <Text style={{ color: on ? '#fff' : c.muted, fontWeight: '800', fontSize: 12, letterSpacing: 0.5 }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The wordmark shows only the product you are in: HERE or THERE, with the green accent dot. */
export function Wordmark({ size = 28, light }: { size?: number; light?: boolean }) {
  const { c, mode } = useTheme();
  const ink = light ? '#fff' : c.forest;
  const name = mode === 'here' ? 'HERE' : 'THERE';
  return (
    <Text accessibilityRole="header" accessibilityLabel={name} style={{ fontSize: size, fontWeight: '800', letterSpacing: -0.8, color: ink }}>
      {name}<Text style={{ color: light ? '#5FC29F' : c.accent }}>.</Text>
    </Text>
  );
}

/** Kept for the splash screen. */
export function Logo({ size = 28, light }: { size?: number; light?: boolean }) {
  return <Wordmark size={size} light={light} />;
}

/** The round profile button: dark green with the person's initial. */
export function ProfileButton() {
  const { me } = useMe();
  const go = useGo();
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Your profile" onPress={() => go('/profile')} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>{me?.profile?.displayName?.[0]?.toUpperCase() ?? '?'}</Text>
    </Pressable>
  );
}

/**
 * Top of the five main tabs: the wordmark, the HERE | THERE switch and the profile button, with an optional
 * line underneath (the city picker in HERE, a tagline elsewhere).
 */
export function TabHeader({ subtitle, children }: { subtitle?: string; children?: React.ReactNode }) {
  const { mode, c } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Between>
        <Wordmark />
        <ProfileButton />
      </Between>
      {/* second line: where you are on the left, the HERE | THERE switch on the right */}
      <Between>
        <View style={{ flexShrink: 1 }}>{children ?? <Text style={{ color: c.muted, fontSize: 14 }}>{subtitle ?? (mode === 'here' ? 'Be here. Be together.' : 'Go there. Together.')}</Text>}</View>
        <ModeSwitch />
      </Between>
    </View>
  );
}
