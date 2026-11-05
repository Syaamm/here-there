import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { Avatar, pressed } from './ui';
import { VerifiedTick } from './ActivityParts';

/** Pieces of the THERE trip screens (from the Figma design): white cards and circles on the ivory page. */

/** The white card on ivory (the design's own white, whatever the page colour is). */
export const WHITE = '#FFFFFF';
export const softShadow = { shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: Platform.OS === 'android' ? 1.5 : 3 } as const;

/** The white card showing who organises the trip. */
export function TripHostCard({ name, uri, verified, onPress, label, children }: { name: string; uri?: string | null; verified: boolean; onPress: () => void; label: string; children: ReactNode }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed: p }) => [{ backgroundColor: WHITE, borderRadius: 24, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18 }, softShadow, pressed(p)]}>
      <View>
        <Avatar name={name} uri={uri} size={46} />
        {verified ? (
          <View style={{ position: 'absolute', right: -4, bottom: -2, backgroundColor: WHITE, borderRadius: 9, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' }}>
            <VerifiedTick size={16} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 4 }}>{children}</View>
    </Pressable>
  );
}

type Slot = { id: string; name?: string; uri?: string | null; host?: boolean };

/** "Who's going" for a trip: a bar segment per place (at most five drawn), a face or an open white circle under each; more going than fit shows a "+N". */
export function TripGoingGrid({ people, capacity, total, a11y }: { people: Slot[]; capacity: number; total: number; a11y: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const slots = Math.max(1, Math.min(capacity, 5));
  const overflow = total > slots;
  const faces = overflow ? people.slice(0, slots - 1) : people.slice(0, slots);
  const open = overflow ? 0 : Math.max(0, slots - faces.length);
  const cells: { key: string; kind: 'person' | 'open' | 'more'; p?: Slot }[] = [
    ...faces.map((p) => ({ key: p.id, kind: 'person' as const, p })),
    ...(overflow ? [{ key: 'more', kind: 'more' as const }] : []),
    ...Array.from({ length: open }, (_, i) => ({ key: `o${i}`, kind: 'open' as const })),
  ];
  return (
    <View accessible accessibilityLabel={a11y} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {cells.map((x) => (
          <View key={x.key} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: x.kind === 'open' ? WHITE : c.forest }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {cells.map((x) => (
          <View key={x.key} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
            {x.kind === 'person' ? (
              <View style={{ borderRadius: 999, borderWidth: 2, borderColor: x.p?.host ? c.green : c.bg }}>
                <Avatar name={x.p?.name} uri={x.p?.uri} size={52} />
              </View>
            ) : x.kind === 'more' ? (
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>+{total - (slots - 1)}</Text>
              </View>
            ) : (
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="person-add-outline" size={20} color={c.forest} />
              </View>
            )}
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 16 }}>{x.kind === 'open' ? t('Open') : x.kind === 'more' ? t('More') : x.p?.host ? t('Host') : (x.p?.name ?? '').split(' ')[0]}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
