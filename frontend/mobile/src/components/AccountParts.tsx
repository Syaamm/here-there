import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { Screen, pressed } from './ui';

/**
 * The account and safety pages in HERE's new look (Figma): a plain back chevron with the page title beside it, big rounded cards,
 * small status tags. Colours come from the theme tokens; in THERE the cards and pill buttons are white on the ivory page.
 */

/** The page: the default header is hidden and the design's own title row is drawn instead. */
export function AcctScreen({ title, children, onRefresh, refreshing, maxWidth }: { title: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; maxWidth?: number }) {
  // both products draw the design's own title row (back chevron + title), so the stack header is hidden in both
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen hasHeader={false} onRefresh={onRefresh} refreshing={refreshing} maxWidth={maxWidth ?? 520}>
        <AcctTitle title={title} />
        {children}
      </Screen>
    </>
  );
}

function AcctTitle({ title }: { title: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Back')}
        hitSlop={8}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings' as never))}
        style={({ pressed: p }) => [{ width: 44, height: 44, alignItems: 'flex-start', justifyContent: 'center', paddingLeft: 4 }, pressed(p)]}
      >
        <Svg width={10} height={16} viewBox="0 0 10 16" fill="none">
          <Path d="M8.5 1.5L2 8l6.5 6.5" stroke={c.text} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>
      <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '600', marginLeft: 8 }}>{title}</Text>
    </View>
  );
}

/** A big rounded white card with a hairline rim. */
export function AcctCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c, mode } = useTheme();
  return <View style={[{ borderWidth: 1, borderColor: mode === 'there' ? 'rgba(16,47,41,0.08)' : c.line, backgroundColor: mode === 'there' ? '#fff' : c.surface, borderRadius: 28, paddingHorizontal: 24, paddingVertical: 20, gap: 12 }, style]}>{children}</View>;
}

/** The small heading above a card ("Privacy Controls"). */
export function AcctLabel({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.text, fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 8 }}>{children}</Text>;
}

/** The label above a field group that the design keeps in the deep green (for hints under a pill field). */
export function AcctHint({ children, error }: { children: ReactNode; error?: boolean }) {
  const { c } = useTheme();
  return <Text style={{ color: error ? c.danger : c.muted, fontSize: 13, lineHeight: 18, paddingLeft: 4 }}>{children}</Text>;
}

/** A small status pill. The state is always said in words, never by colour alone. */
export function StatusTag({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const { c } = useTheme();
  const look = { ok: [c.okBg, c.okFg], warn: [c.warnBg, c.warnFg], bad: [c.badBg, c.badFg], neutral: [c.okBg, c.okFg] }[tone];
  return (
    <View style={{ backgroundColor: look[0], borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: look[1], fontSize: 10, lineHeight: 13, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

/** The white pill button with a hairline rim (the design's second button). */
export function AcctOutlineButton({ title, onPress, icon, loading, disabled, style }: { title: string; onPress: () => void; icon?: React.ComponentProps<typeof Ionicons>['name']; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c, mode } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: sc(52), borderRadius: 32, borderWidth: 1, borderColor: c.line, backgroundColor: mode === 'there' ? '#fff' : c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20, opacity: off ? 0.5 : 1 }, style, !off && pressed(p)]}
    >
      {icon ? <Ionicons name={icon} size={20} color={c.text} /> : null}
      <Text style={{ color: c.text, fontSize: 15, fontWeight: '500' }}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

/** An icon, a title, a quiet line under it, and anything on the right. */
export function AcctRow({ icon, title, subtitle, right, onPress, last }: { icon?: React.ComponentProps<typeof Ionicons>['name']; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; last?: boolean }) {
  const { c, mode } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14, minHeight: 44, borderBottomWidth: last ? 0 : 1, borderBottomColor: mode === 'there' ? 'rgba(16,47,41,0.09)' : c.line }}>
      {icon ? <Ionicons name={icon} size={22} color={c.text} style={{ marginTop: 1 }} /> : null}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '500' }}>{title}</Text>
        {subtitle ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed: p }) => pressed(p)}>{body}</Pressable> : body;
}
