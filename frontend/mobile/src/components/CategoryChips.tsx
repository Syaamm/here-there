import { Pressable, ScrollView } from 'react-native';
import { CAT_COLORS, CAT_IMAGES, CATS } from '@/lib/constants';
import { useCategories } from '@/lib/categories';
import { useLayout } from '@/lib/layout';
import { useT } from '@/lib/i18n';
import { sc, sp, sph } from '@/lib/scale';
import { BTN } from '@/lib/buttons';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { RoundPhoto } from './CreateParts';
import { pressed } from './ui';
import { keyboardTaps } from '@/lib/keyboard';

/** The row of round-photo category chips under the search (Figma "HOME"). Tap one to show only that kind; tap it again to clear. */
export function CategoryChips({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { t } = useT();
  const { here: ORDER } = useCategories();
  const { c } = useTheme();
  const { gutter } = useLayout();
  return (
    <ScrollView horizontal overScrollMode="never" showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: sp(10), paddingVertical: sc(3) }}>
      {ORDER.map((k) => {
        const on = value === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t(CATS[k]?.label ?? k)}
            onPress={() => onChange(on ? null : k)}
            style={({ pressed: p }) => [{ borderRadius: sc(999), borderWidth: 1, borderColor: on ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: sp(8), paddingVertical: sc(3), paddingLeft: sc(3), paddingRight: sph(14) }, pressed(p)]}
          >
            <RoundPhoto source={CAT_IMAGES[k]} emoji={CATS[k]?.emoji} tint={CAT_COLORS[k]} size={sc(36)} ring={on} />
            <Text style={{ color: on ? '#fff' : c.forest, ...BTN.text }}>{t(CATS[k]?.label ?? k)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
