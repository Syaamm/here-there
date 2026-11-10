import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { type Near, useCityPos } from '@/lib/city';
import { CitySearch } from './CitySearch';
import { Sheet } from './ui';

/** "📍 Milan · Around you ▾". Picking a city manually means location permission is never needed to browse. */
export function CityPicker({ city, onPick, subtitle, pill, onDark }: { city: string; onPick: (c: string, at?: Near) => void; /** drawn as a bordered pill: pin, "Milan · Around you", chevron (home header) */ pill?: boolean; /** when given, the trigger is drawn as a pin with the city in bold and this line under it (map header) */ subtitle?: string; /** a pill for a dark header: a tinted glass pill, green pin and the city in white */ onDark?: boolean }) {
  const { t } = useT();
  const { c, mode } = useTheme();
  const [open, setOpen] = useState(false);
  const cityPos = useCityPos(); // places near the chosen city are listed first
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('City: {city}. Change city', { city })} onPress={() => setOpen(true)} hitSlop={8}>
        {onDark ? (
          // the home pages' pill: 36 tall like the profile photo beside it (HERE and THERE look the same), text centred on the photo's middle
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, paddingLeft: 11, paddingRight: 14, borderRadius: 18, backgroundColor: c.bandChip }}>
            <Ionicons name="location-outline" size={16} color={c.bandPin} />
            <Text numberOfLines={1} style={{ color: mode === 'there' ? c.forest : c.onBand, fontWeight: '600', fontSize: 14, lineHeight: 18, includeFontPadding: false, maxWidth: 110 }}>{city}</Text>
          </View>
        ) : pill ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
            <Ionicons name="location-outline" size={15} color={c.green} />
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 12, lineHeight: 16, includeFontPadding: false }}>{city} · {t('Around you')}</Text>
            <Ionicons name="chevron-down" size={14} color={c.muted} />
          </View>
        ) : subtitle ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="location-outline" size={22} color={c.text} />
            <View>
              <Text style={{ color: c.text, fontWeight: '700', fontSize: 14, lineHeight: 18 }}>{city}</Text>
              <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{subtitle}</Text>
            </View>
          </View>
        ) : (
          <Text style={{ color: c.green, fontWeight: '700' }}>📍 {city} · {t('Around you')} ▾</Text>
        )}
      </Pressable>
      <Sheet visible={open} title={t('Choose your city')} onClose={() => setOpen(false)}>
        <CitySearch
          near={cityPos}
          onPick={(name, at) => {
            onPick(name, at);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
