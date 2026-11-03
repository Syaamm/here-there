import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { Text } from './ScaledText';
import { Avatar, pressed } from './ui';

/** Pieces shared by the activity detail, join and host screens (from the Figma design). */

/** Round back button, a title and a hairline under them (the host's "Manage Join Requests" header). */
export function ActivityHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { c } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <AuthBack onPress={onBack} />
        <Text accessibilityRole="header" style={{ flex: 1, color: c.text, fontSize: 17, lineHeight: 22, fontWeight: '500' }}>{title}</Text>
      </View>
      <View style={{ height: 1, backgroundColor: c.line, marginTop: 10 }} />
    </View>
  );
}

/** A pill button: filled forest, or outlined. */
export function PillButton({ title, onPress, outline, disabled, loading, small, style, label }: { title: string; onPress: () => void; outline?: boolean; disabled?: boolean; loading?: boolean; small?: boolean; style?: StyleProp<ViewStyle>; label?: string }) {
  const { c } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed: p }) => [
        { minHeight: Math.max(44, sc(small ? 46 : 54)), borderRadius: 32, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, backgroundColor: outline ? c.surface : c.forest, borderWidth: 1, borderColor: outline ? c.line : c.forest, opacity: off ? 0.5 : 1 },
        style,
        !off && pressed(p),
      ]}
    >
      <Text style={{ color: outline ? c.text : '#fff', fontSize: small ? 13 : 14, fontWeight: '500', textAlign: 'center' }}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

/** The blue "verified" tick. */
export function VerifiedTick({ size = 16 }: { size?: number }) {
  return <Ionicons name="checkmark-circle" size={size} color="#2D81D4" />;
}

/** The soft card showing who hosts the activity. */
export function HostCard({ name, uri, verified, onPress, children, label }: { name: string; uri?: string | null; verified: boolean; onPress: () => void; children: ReactNode; label: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed: p }) => [{ borderRadius: 24, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }, pressed(p)]}>
      <LinearGradient colors={[c.surface, c.sand]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18 }}>
        <View>
          <Avatar name={name} uri={uri} size={46} />
          {verified ? (
            <View style={{ position: 'absolute', right: -4, bottom: -2, backgroundColor: '#fff', borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
              <VerifiedTick size={16} />
            </View>
          ) : null}
        </View>
        <View style={{ flex: 1, gap: 4 }}>{children}</View>
      </LinearGradient>
    </Pressable>
  );
}

/** An icon, a main line and a small line under it (place, time). */
export function InfoRow({ icon, title, sub, onPress, label, trailing }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; sub: string; onPress?: () => void; label?: string; trailing?: ReactNode }) {
  const { c } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, minHeight: 44 }}>
      <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 24, alignItems: 'center', paddingTop: 1 }}>
        <Ionicons name={icon} size={22} color={c.text} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>{sub}</Text>
      </View>
      {trailing}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress} style={({ pressed: p }) => pressed(p)}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

type Slot = { id: string; name?: string; uri?: string | null; host?: boolean };

/** "Who's going": one bar segment per place across the top, then a face (or an open circle) under each. At most five places are drawn. */
export function GoingGrid({ people, capacity, a11y }: { people: Slot[]; capacity: number; a11y: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const slots = Math.max(1, Math.min(capacity, 5));
  const shown = people.slice(0, slots);
  const open = Math.max(0, slots - shown.length);
  const cells = [...shown.map((p) => ({ kind: 'person' as const, p })), ...Array.from({ length: open }, (_, i) => ({ kind: 'open' as const, p: { id: `o${i}` } as Slot }))];
  return (
    <View accessible accessibilityLabel={a11y} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {cells.map((x) => (
          <View key={x.p.id} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: x.kind === 'person' ? c.forest : c.line }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {cells.map((x) => (
          <View key={x.p.id} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            {x.kind === 'person' ? (
              <View style={{ borderRadius: 999, borderWidth: 2, borderColor: x.p.host ? c.green : c.bg }}>
                <Avatar name={x.p.name} uri={x.p.uri} size={52} />
              </View>
            ) : (
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person-add-outline" size={20} color={c.forest} />
              </View>
            )}
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 16 }}>{x.kind === 'open' ? t('Open') : x.p.host ? t('Host') : (x.p.name ?? '').split(' ')[0]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
