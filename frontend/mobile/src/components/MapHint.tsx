import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { FS, LH } from '@/lib/type';
import { Text } from './ScaledText';

/**
 * A short "how to use this map" card, shown the first times a map is opened and gone for good once it is closed (the cross, or "Got
 * it"). Remembered on the phone, per map (`id`), so it never nags. Nothing is shown until the memory has been read.
 */
export function MapHint({ id, title, children }: { id: string; title: string; children: string }) {
  const { c } = useTheme();
  const { t } = useT();
  const key = `ht_map_hint_${id}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(key)
      .then((v) => setShow(v !== '1'))
      .catch(() => setShow(true));
  }, [key]);
  if (!show) return null;
  const close = () => {
    setShow(false);
    AsyncStorage.setItem(key, '1').catch(() => {});
  };
  return (
    <View style={{ width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: c.surface, borderRadius: 20, paddingVertical: 12, paddingLeft: 14, paddingRight: 6, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
      <Ionicons name="information-circle-outline" size={20} color={c.forest} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: FS.body, lineHeight: LH.body, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: FS.button, lineHeight: LH.button }}>{children}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Got it')} hitSlop={8} onPress={close} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={18} color={c.muted} />
      </Pressable>
    </View>
  );
}
