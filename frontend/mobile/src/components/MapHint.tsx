import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { tap } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { FS, LH } from '@/lib/type';
import { Text } from './ScaledText';

import { sc, sp, sph } from '@/lib/scale';
/**
 * A small "How the map works" tab at the top of a map (HERE and THERE alike). It is always there: the first times a map is opened it
 * starts open, and closing it only folds it into the small tab, which opens again with a tap. Remembered on the phone, per map
 * (`id`). The cross removes it for good (Settings > Show the tour again brings it back). Nothing is shown until the memory has been read,
 * so it never flashes.
 */
export function MapHint({ id, title, children }: { id: string; title: string; children: string }) {
  const { c } = useTheme();
  const { t } = useT();
  const key = `ht_map_hint_${id}`;
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(key), AsyncStorage.getItem(`${key}_off`)])
      .then(([folded, off]) => {
        setOpen(folded !== '1');
        setRemoved(off === '1');
      })
      .catch(() => setOpen(true))
      .finally(() => setReady(true));
  }, [key]);
  if (!ready || removed) return null;
  const remove = () => {
    tap('Light');
    setRemoved(true);
    AsyncStorage.setItem(`${key}_off`, '1').catch(() => {});
  };
  const toggle = () => {
    tap('Light');
    const next = !open;
    setOpen(next);
    // once it has been folded away, it starts folded on the next visit (opened again by a tap, as often as wanted)
    if (!next) AsyncStorage.setItem(key, '1').catch(() => {});
  };
  const label = t('How the map works');
  if (!open)
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: false }}
        hitSlop={6}
        onPress={toggle}
        style={({ pressed }) => [{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: sp(6), minHeight: sc(36), paddingHorizontal: sph(14), borderRadius: sc(999), backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }, pressed && { opacity: 0.88 }]}
      >
        <Ionicons name="information-circle-outline" size={sc(18)} color={c.forest} />
        <Text style={{ color: c.text, fontSize: FS.button, lineHeight: LH.button, fontWeight: '600' }}>{label}</Text>
        <Ionicons name="chevron-down" size={sc(16)} color={c.muted} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Remove')} hitSlop={8} onPress={remove} style={{ width: sc(26), height: sc(26), alignItems: 'center', justifyContent: 'center', marginRight: -sc(6) }}>
          <Ionicons name="close" size={sc(16)} color={c.muted} />
        </Pressable>
      </Pressable>
    );
  return (
    <View style={{ width: '100%', maxWidth: sc(560), backgroundColor: c.surface, borderRadius: sc(20), borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: true }} onPress={toggle} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(8), minHeight: sc(44), paddingLeft: sph(14), paddingRight: sph(10) }}>
        <Ionicons name="information-circle-outline" size={sc(20)} color={c.forest} />
        <Text style={{ flex: 1, color: c.text, fontSize: FS.body, lineHeight: LH.body, fontWeight: '600' }}>{label}</Text>
        <Ionicons name="chevron-up" size={sc(18)} color={c.muted} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Remove')} hitSlop={8} onPress={remove} style={{ width: sc(32), height: sc(32), alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={sc(18)} color={c.muted} />
        </Pressable>
      </Pressable>
      <View style={{ gap: 2, paddingLeft: sph(14), paddingRight: sph(14), paddingBottom: sp(12) }}>
        <Text style={{ color: c.text, fontSize: FS.button, lineHeight: LH.button, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: FS.button, lineHeight: LH.button }}>{children}</Text>
      </View>
    </View>
  );
}
