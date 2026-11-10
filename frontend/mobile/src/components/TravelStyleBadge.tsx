import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { useT } from '@/lib/i18n';
import { meetsThere } from '@/lib/travelStyle';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';

/**
 * How a trip's group gets there, as a label you notice at a glance, the same everywhere (cards, the trip page):
 *  - Travel together: deep green with white letters and a people icon (companions leave from one city);
 *  - Meet at destination: light sand with deep green letters and a pin icon (everyone travels on their own and meets there).
 * `onPhoto` adds a soft shadow so it reads on any picture; `small` is the compact size for row cards.
 */
export function TravelStyleBadge({ trip, onPhoto, small }: { trip: { travelStyle?: string; originCity: string }; onPhoto?: boolean; small?: boolean }) {
  const { t } = useT();
  const { c } = useTheme();
  const meet = meetsThere(trip);
  const bg = meet ? '#F1E7D3' : c.forest;
  const ink = meet ? c.forest : '#FFFFFF';
  const label = meet ? t('Meet at destination') : t('Travel together');
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: small ? 4 : 6, backgroundColor: bg, borderRadius: 999, paddingHorizontal: small ? 9 : 12, paddingVertical: small ? 3 : 5 },
        meet && !onPhoto ? { borderWidth: 1, borderColor: 'rgba(16,47,41,0.14)' } : null,
        onPhoto ? { shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 } : null,
      ]}
    >
      <Ionicons name={meet ? 'location' : 'people'} size={small ? 12 : 14} color={ink} />
      <Text style={{ color: ink, fontSize: small ? 11 : 12.5, lineHeight: small ? 15 : 17, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}
