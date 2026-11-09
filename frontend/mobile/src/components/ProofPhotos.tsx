import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { del, uploadProof } from '@/lib/api';
import { tap } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { ErrorBanner, Txt } from './ui';

type Item = { id: string; uri: string };

/**
 * "Add proof": up to 3 photos (a screenshot of the chat, say) sent along with an appeal or a dispute. Each one is shrunk on the
 * phone and again on the server, so it stays small. They are private (only you and the moderators handling it can open them).
 * Each is uploaded as soon as it is picked; `onChange` gives the ids to send with the form. Remount it (change its `key`) to clear it.
 */
export function ProofPhotos({ onChange, max = 3 }: { onChange: (ids: string[]) => void; max?: number }) {
  const { t } = useT();
  const { c } = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const held = useRef<Item[]>([]);
  held.current = items;

  useEffect(() => onChange(items.map((i) => i.id)), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  // a message under the photos goes away by itself after 4 seconds
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  const add = async () => {
    const room = max - held.current.length - busy;
    if (room <= 0) return;
    tap('Light');
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: room > 1, selectionLimit: room });
    if (r.canceled) return;
    for (const asset of r.assets.slice(0, room)) {
      setBusy((n) => n + 1);
      try {
        const { id } = await uploadProof(asset.uri);
        setItems((list) => [...list, { id, uri: asset.uri }]);
      } catch (e) {
        setError(e instanceof Error ? e.message : t('Could not add that photo.'));
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const remove = (item: Item) => {
    tap('Light');
    setItems((list) => list.filter((i) => i.id !== item.id));
    void del(`/v1/me/proofs/${item.id}`).catch(() => undefined); // a photo not sent is cleared by the server after a day anyway
  };

  const tile = { width: 84, height: 84, borderRadius: 16 } as const;
  return (
    <View style={{ gap: 8 }}>
      <Txt variant="label">{t('Add proof (optional)')}</Txt>
      <Txt variant="small" color={c.muted}>{t('For example a screenshot of the chat. Only you and the moderators who look at this can see it, and it is deleted a month after the decision. Up to {n} photos.', { n: max })}</Txt>
      <ErrorBanner message={error} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {items.map((i) => (
          <View key={i.id} style={tile}>
            <Image source={{ uri: i.uri }} accessibilityLabel={t('A photo you added')} contentFit="cover" style={{ ...tile, backgroundColor: c.sand }} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('Remove this photo')} hitSlop={8} onPress={() => remove(i)} style={{ position: 'absolute', top: -8, right: -8, width: 24, height: 24, borderRadius: 12, backgroundColor: c.text, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={14} color={c.bg} />
            </Pressable>
          </View>
        ))}
        {Array.from({ length: busy }, (_, k) => (
          <View key={`busy${k}`} style={{ ...tile, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.forest} />
          </View>
        ))}
        {items.length + busy < max ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Add a photo')} onPress={() => void add()} style={({ pressed }) => [{ ...tile, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.forest, alignItems: 'center', justifyContent: 'center', gap: 2 }, pressed && { opacity: 0.7 }]}>
            <Ionicons name="image-outline" size={22} color={c.forest} />
            <Text style={{ color: c.forest, fontSize: 12, fontWeight: '600' }}>{t('Add photo')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
