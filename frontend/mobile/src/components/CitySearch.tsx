import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { get } from '@/lib/api';
import type { Near } from '@/lib/city';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { Field, Spinner, Txt } from './ui';

import { sc, sp } from '@/lib/scale';
type Found = { id: string; name: string; address: string; lat: number; lng: number };

const DELAY_MS = 350; // wait for a pause in the typing before searching
const MIN_CHARS = 2;

/**
 * Search a city or region as you type and pick one from real places (the city picker's sheet). Places near `near` (the city
 * chosen now) are listed first. The pick comes with its position, so the app can show what is around it.
 */
export function CitySearch({ near, onPick }: { near?: Near | null; onPick: (name: string, at: Near) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const latest = useRef(0);

  useEffect(() => {
    const text = q.trim();
    const mine = ++latest.current;
    if (text.length < MIN_CHARS) {
      setFound(null);
      setState('idle');
      return;
    }
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: text, kind: 'city', ...(near && { lat: String(near.lat), lng: String(near.lng) }) });
        const r = await get<{ items: Found[] }>(`/v1/places/search?${params}`);
        if (mine !== latest.current) return;
        setFound(r.items);
        setState('done');
      } catch {
        if (mine !== latest.current) return;
        setState('error');
      }
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ gap: sp(10) }}>
      <Field label={t('City or region')} icon="search" value={q} onChangeText={setQ} placeholder={t('Search a city or region')} autoFocus autoCorrect={false} returnKeyType="search" />
      {state === 'searching' && !found ? <Spinner /> : null}
      {state === 'error' ? <Txt variant="muted">{t('City search is not available right now. Try again in a moment.')}</Txt> : null}
      {state === 'done' && found?.length === 0 ? <Txt variant="muted">{t('No city found with that name.')}</Txt> : null}
      {found?.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={p.address ? `${p.name}, ${p.address}` : p.name}
          onPress={() => onPick(p.name, { lat: p.lat, lng: p.lng })}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: sc(52), paddingVertical: sp(8), borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { opacity: 0.7 }]}
        >
          <View style={{ width: sc(34), height: sc(34), borderRadius: sc(17), backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="location-outline" size={sc(17)} color={c.forest} />
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{p.name}</Text>
            {p.address ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{p.address}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
