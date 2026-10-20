import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Btn, Field, Sheet, Txt } from './ui';

/** "📍 Milan · Around you ▾". Picking a city manually means location permission is never needed to browse. */
export function CityPicker({ city, onPick }: { city: string; onPick: (c: string) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(city);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`City: ${city}. Change city`} onPress={() => (setV(city), setOpen(true))} hitSlop={8}>
        <Text style={{ color: c.green, fontWeight: '700' }}>📍 {city} · Around you ▾</Text>
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
