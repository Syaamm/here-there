import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

import { sc, sp } from '@/lib/scale';
/** The rounded white card on a profile, in HERE and in THERE: Hosted | Joined | Trips, with big numbers and small labels. */
export function StatsCard({ hosted, joined, trips }: { hosted?: number; joined?: number; trips?: number }) {
  const { t } = useT();
  const { mode, c } = useTheme();
  const there = mode === 'there';
  const rows = [
    [hosted, t('Hosted')],
    [joined, t('Joined')],
    [trips, t('Trips')],
  ] as const;
  return (
    <View style={{ flexDirection: 'row', borderRadius: sc(32), paddingVertical: sp(18), marginTop: sp(14), shadowColor: '#102F29', shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: sc(4) }, elevation: 3, backgroundColor: there ? '#fff' : c.surface }}>
      {rows.map(([n, l], i) => (
        <View key={l} style={{ flex: 1, alignItems: 'center', gap: 2, borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line }}>
          <Text style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700' }}>{n ?? '–'}</Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{l}</Text>
        </View>
      ))}
    </View>
  );
}
