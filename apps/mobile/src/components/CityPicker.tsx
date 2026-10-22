import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Sheet, Txt } from './ui';

/** "📍 Milan · Around you ▾". Picking a city manually means location permission is never needed to browse. */
export function CityPicker({ city, onPick, subtitle, pill }: { city: string; onPick: (c: string) => void; /** drawn as a bordered pill: pin, "Milan · Around you", chevron (home header) */ pill?: boolean; /** when given, the trigger is drawn as a pin with the city in bold and this line under it (map header) */ subtitle?: string }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(city);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`City: ${city}. Change city`} onPress={() => (setV(city), setOpen(true))} hitSlop={8}>
        {pill ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface }}>
            <Ionicons name="location-outline" size={15} color={c.green} />
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 12 }}>{city} · Around you</Text>
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
          <Text style={{ color: c.green, fontWeight: '700' }}>📍 {city} · Around you ▾</Text>
        )}
      </Pressable>
      <Sheet visible={open} title="Choose your city" onClose={() => setOpen(false)}>
        <Field label="City" value={v} onChangeText={setV} autoFocus />
        <Txt variant="small">You never need to share your device location to browse. Pick a city instead.</Txt>
        <Btn
          title="Use this city"
          disabled={v.trim().length < 2}
          onPress={() => {
            onPick(v.trim());
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}
