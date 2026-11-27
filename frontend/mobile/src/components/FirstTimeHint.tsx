import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useGo } from '@/components/ui';
import { Text } from '@/components/ScaledText';
import { useT } from '@/lib/i18n';
import { sc, sp, sph } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

const key = (id: string) => `ht_hint_${id}`;

/**
 * A small one-time card that explains a thing where it first shows up (attendance, friends). "Got it" hides it for good on this
 * phone; "How it works" opens the full guide. It stays out of the way: nothing shows until the phone has answered that it was not
 * seen yet, and a phone with no storage simply shows nothing.
 */
export function FirstTimeHint({ id, title, text }: { id: string; title: string; text: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const go = useGo();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(key(id)).then(
      (v) => live && setShow(v !== '1'),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [id]);
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    AsyncStorage.setItem(key(id), '1').catch(() => undefined);
  };
  return (
    <View accessibilityRole="summary" style={{ backgroundColor: c.accentSoft, borderRadius: sc(14), padding: sp(12), gap: sp(6) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(8) }}>
        <Ionicons name="information-circle-outline" size={sc(20)} color={c.forest} />
        <Text style={{ flex: 1, color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{title}</Text>
      </View>
      <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{text}</Text>
      <View style={{ flexDirection: 'row', gap: sph(16), marginTop: sp(2) }}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={dismiss} style={{ minHeight: sc(36), justifyContent: 'center' }}>
          <Text style={{ color: c.forest, fontSize: 14, fontWeight: '700' }}>{t('Got it')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => {
            dismiss();
            go('/how-it-works');
          }}
          style={{ minHeight: sc(36), justifyContent: 'center' }}
        >
          <Text style={{ color: c.forest, fontSize: 14, fontWeight: '700' }}>{t('How it works ›')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
