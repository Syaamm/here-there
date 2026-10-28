import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { get } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Field, Row, Txt } from './ui';

/** A real place found on the map: where it is, and what to call it. */
export type Place = { id: string; name: string; address: string; lat: number; lng: number };

const MIN_CHARS = 3;
const DELAY_MS = 500; // wait for a pause in typing, so one search is made per word, not per letter

/**
 * "Public meeting location" with map search: type a name or an address, pick one of the places that come back. Once a
 * place is picked it shows as a card with a Change button. The typed text stays usable as a plain name when the search
 * finds nothing or is not available, so a person is never stuck.
 */
export function PlaceSearch({ label, text, onText, place, onPlace, city }: { label: string; text: string; onText: (v: string) => void; place: Place | null; onPlace: (p: Place | null) => void; city: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const [found, setFound] = useState<Place[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const latest = useRef(0); // only the newest search may update the screen

  useEffect(() => {
    const q = text.trim();
    if (place || q.length < MIN_CHARS) {
      latest.current++;
      setFound(null);
      setState('idle');
      return;
    }
    const mine = ++latest.current;
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const r = await get<{ items: Place[] }>(`/v1/places/search?${new URLSearchParams({ q, ...(city.trim() && { city: city.trim() }) })}`);
        if (mine !== latest.current) return;
        setFound(r.items);
        setState('done');
      } catch {
        if (mine !== latest.current) return;
        setFound(null);
        setState('error');
      }
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, city, place]);

  if (place) {
    return (
      <View style={{ gap: 4 }}>
        <Txt variant="label">{t(label)}</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface }}>
          <Ionicons name="location" size={22} color={c.forest} />
          <View style={{ flex: 1 }}>
            <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{place.name}</Txt>
            {place.address ? <Txt variant="small" numberOfLines={2}>{place.address}</Txt> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Change location, now {name}', { name: place.name })} hitSlop={8} onPress={() => onPlace(null)}>
            <Txt variant="h3" color={c.forest} style={{ fontSize: 12 }}>{t('Change')}</Txt>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <Field label={t(label)} icon="search-outline" placeholder={t('Search a place')} value={text} onChangeText={onText} maxLength={100} autoCorrect={false} />
      {state === 'searching' ? <Txt variant="small">{t('Searching…')}</Txt> : null}
      {state === 'error' ? <Txt variant="small">{t('Search unavailable. Type the place name.')}</Txt> : null}
      {state === 'done' && found && found.length === 0 ? <Txt variant="small">{t('No place found.')}</Txt> : null}
      {found && found.length > 0 ? (
        <View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {found.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={t('Use {name}, {address}', { name: p.name, address: p.address })}
              onPress={() => onPlace(p)}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, pressed && { backgroundColor: c.sand }]}
            >
              <Ionicons name="location-outline" size={18} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Txt variant="h3" numberOfLines={1} style={{ fontSize: 13, lineHeight: 17 }}>{p.name}</Txt>
                {p.address ? <Txt variant="small" numberOfLines={1}>{p.address}</Txt> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {state === 'done' || state === 'error' ? (
        <Row style={{ gap: 6, alignItems: 'flex-start' }}>
          <Ionicons name="information-circle-outline" size={13} color={c.muted} style={{ marginTop: 2 }} />
          <Txt variant="small" style={{ flex: 1 }}>{t('Pick a place to show it on the map.')}</Txt>
        </Row>
      ) : null}
    </View>
  );
}
