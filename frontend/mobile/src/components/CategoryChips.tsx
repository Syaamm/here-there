import { Image } from 'expo-image';
import { Pressable, ScrollView } from 'react-native';
import { CAT_IMAGES, CATS } from '@/lib/constants';
import { useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { pressed } from './ui';

const ORDER = ['coffee', 'drinks', 'food', 'sports', 'culture'] as const;

/** The row of round-photo category chips under the search (Figma "HOME"). Tap one to show only that kind; tap it again to clear. */
export function CategoryChips({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const { gutter } = useLayout();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 14, paddingVertical: 3 }}>
      {ORDER.map((k) => {
        const on = value === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(CATS[k].label)}
            onPress={() => onChange(on ? null : k)}
            style={({ pressed: p }) => [{ minHeight: sc(54), borderRadius: 27, borderWidth: 1, borderColor: on ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 4, paddingRight: 20 }, pressed(p)]}
          >
            <Image source={CAT_IMAGES[k]} contentFit="cover" accessibilityElementsHidden importantForAccessibility="no" style={{ width: 46, height: 46, borderRadius: 23, borderWidth: on ? 2 : 0, borderColor: '#fff' }} />
            <Text style={{ color: on ? '#fff' : c.forest, fontSize: 16 }}>{t(CATS[k].label)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
