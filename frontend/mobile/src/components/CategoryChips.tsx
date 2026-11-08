import { Pressable, ScrollView } from 'react-native';
import { CAT_IMAGES, CATS } from '@/lib/constants';
import { useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { RoundPhoto } from './CreateParts';
import { pressed } from './ui';
import { keyboardTaps } from '@/lib/keyboard';

const ORDER = ['coffee', 'drinks', 'food', 'sports', 'culture'] as const;

/** The row of round-photo category chips under the search (Figma "HOME"). Tap one to show only that kind; tap it again to clear. */
export function CategoryChips({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const { gutter } = useLayout();
  return (
    <ScrollView horizontal overScrollMode="never" showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 10, paddingVertical: 3 }}>
      {ORDER.map((k) => {
        const on = value === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(CATS[k].label)}
            onPress={() => onChange(on ? null : k)}
            style={({ pressed: p }) => [{ borderRadius: 999, borderWidth: 1, borderColor: on ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: sc(8), paddingVertical: sc(3), paddingLeft: sc(3), paddingRight: sc(14) }, pressed(p)]}
          >
            <RoundPhoto source={CAT_IMAGES[k]} size={sc(36)} ring={on} />
            <Text style={{ color: on ? '#fff' : c.forest, fontSize: 14 }}>{t(CATS[k].label)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
