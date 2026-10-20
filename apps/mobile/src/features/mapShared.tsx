import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CatPhoto } from '@/components/CatPhoto';
import { CityPicker } from '@/components/CityPicker';
import { Banner, Btn, ErrorBanner, Row, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { catColor, CATS, CITY_CENTERS } from '@/lib/constants';
import { feedRange } from '@/lib/feed';
import { when } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

export type Pin = Activity & { lat: number; lng: number };
/** Every activity at (about) the same place: one icon on the map, however many are there. */
export type Group = { key: string; lat: number; lng: number; items: Pin[] };

export type Fix = { lat: number; lng: number };

/**
 * One approximate location fix, taken only because the person just asked for it. Permission is requested on every call
 * (the system only shows a prompt when it needs to), the fix is a single low-accuracy reading rounded to about 1 km,
 * and there is no tracking: nothing watches, stores or sends the position.
 */
export async function approximateFix(): Promise<({ ok: true } & Fix) | { ok: false; reason: 'denied' | 'error' }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    return { ok: true, lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/** Straight-line distance in km (haversine). */
export function kmBetween(a: Fix, b: Fix) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
/** The fix is rounded to ~1 km, so small distances are shown as "under 1 km", never as false precision. */
export const fmtKm = (km: number) => (km < 1 ? 'under 1 km' : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

type Distance = { status: 'idle' | 'locating' | 'denied' | 'error' | 'done'; me?: Fix };

/** Everything both map screens share: the data, "Near me", and which pin is selected. Venues only, never people. */
export function useMapData() {
  const [city, setCity] = useCity();
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // the activity the person picked in the list, highlighted inside a group
  const [activeId, setActiveId] = useState<string | null>(null);
  // set when the map should fly to a venue (from "Near me" or from picking an activity in the list)
  const [target, setTarget] = useState<{ lat: number; lng: number; zoom: 'near' | 'venue' } | null>(null);
  const { focus, t } = useLocalSearchParams<{ focus?: string; t?: string }>();
  const handled = useRef('');
  // "How far?": the person's approximate position, kept in memory for the open card only and dropped when it closes
  const [dist, setDist] = useState<Distance>({ status: 'idle' });

  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50' });
      if (near) {
        p.set('lat', String(near.lat));
        p.set('lng', String(near.lng));
        p.set('radiusKm', '3');
      }
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, near],
    60_000,
  );
  const pins = (feed.data?.items ?? []).filter((a): a is Pin => a.lat != null && a.lng != null);
  // Group by place (~100 m): several activities at one venue share one icon with a count.
  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const p of pins) {
      const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
      const g = by.get(key) ?? { key, lat: p.lat, lng: p.lng, items: [] };
      g.items.push(p);
      by.set(key, g);
    }
    for (const g of by.values()) g.items.sort((x, y) => +new Date(x.startsAt) - +new Date(y.startsAt));
    return [...by.values()];
  }, [pins]);
  const selected = groups.find((g) => g.key === selectedKey) ?? null;
  const setSelected = (g: Group | null) => {
    setSelectedKey(g?.key ?? null);
    setActiveId(null);
    setDist({ status: 'idle' });
  };
  const center = near ? ([near.lat, near.lng] as [number, number]) : (CITY_CENTERS[city.toLowerCase()] ?? (pins[0] ? ([pins[0].lat, pins[0].lng] as [number, number]) : null));

  // Arriving from the list with ?focus=<activity id>: select that venue and move the map to it, once per arrival.
  useEffect(() => {
    if (!focus) return;
    const key = `${focus}:${t ?? ''}`;
    if (handled.current === key) return;
    const pin = pins.find((p) => p.id === focus);
    if (!pin) return; // still loading: this runs again when the pins arrive
    handled.current = key;
    setSelectedKey(`${pin.lat.toFixed(3)},${pin.lng.toFixed(3)}`);
    setActiveId(pin.id);
    setDist({ status: 'idle' });
    setTarget({ lat: pin.lat, lng: pin.lng, zoom: 'venue' });
  }, [focus, t, pins]);

  const locate = async () => {
    setGeoMsg(null);
    setLocating(true);
    const r = await approximateFix();
    setLocating(false);
    if (!r.ok) {
      setGeoMsg(r.reason === 'denied' ? 'Location permission is off, so we are showing the whole city. You can allow it in your device or browser settings.' : 'We could not get your location. Showing the whole city instead.');
      return;
    }
    setNear({ lat: r.lat, lng: r.lng });
    setTarget({ lat: r.lat, lng: r.lng, zoom: 'near' });
  };

  // Ask for the position (and the permission) again every time, so the person always decides; also used by Refresh.
  const measure = async () => {
    setDist({ status: 'locating' });
    const r = await approximateFix();
    setDist(r.ok ? { status: 'done', me: { lat: r.lat, lng: r.lng } } : { status: r.reason });
  };

  return { city, setCity, near, setNear, geoMsg, locating, locate, dist, measure, selected, setSelected, activeId, feed, pins, groups, center, target };
}

/** A round category icon, the only thing drawn on the map for a place. A count shows when several activities share it. */
export function PinIcon({ category, full, active, count }: { category: string; full: boolean; active: boolean; count: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[s.pin, { borderColor: full ? '#999' : c.green }, active && { backgroundColor: c.forest, borderColor: '#fff' }]}>
        <Text style={{ fontSize: 17 }}>{CATS[category]?.emoji ?? '📍'}</Text>
      </View>
      {count > 1 ? (
        <View style={s.badge}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** "How far?": one tap asks for an approximate position once; Refresh asks again. Never tracks. */
function DistanceRow({ data, text }: { data: ReturnType<typeof useMapData>; text?: string }) {
  const { c } = useTheme();
  const { dist, measure } = data;
  const note = { color: c.muted, fontSize: 12, flex: 1 } as const;
  if (dist.status === 'locating')
    return (
      <Row>
        <Text style={note}>Finding your approximate location…</Text>
      </Row>
    );
  if (dist.status === 'done')
    return (
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={note}>{text ?? 'Approximate, from where you are now.'}</Text>
        <Btn title="↻ Refresh" small variant="secondary" onPress={measure} />
      </Row>
    );
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={note}>
        {dist.status === 'denied'
          ? 'Location is off. Distance needs your approximate location, only when you ask. You can allow it in settings.'
          : dist.status === 'error'
            ? 'We could not get your location. Try again.'
            : 'Your location is only used when you tap, and is never saved or shared.'}
      </Text>
      <Btn title={dist.status === 'idle' ? '📍 How far?' : 'Try again'} small variant="secondary" onPress={measure} />
    </Row>
  );
}

/** Floating controls over a full-screen map: city + Near me + List on top, the tapped venue's card at the bottom. */
export function MapOverlay({ data }: { data: ReturnType<typeof useMapData> }) {
  const go = useGo();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { city, setCity, near, setNear, geoMsg, locating, locate, selected, activeId, feed, pins, dist } = data;
  const one = selected && selected.items.length === 1 ? selected.items[0] : null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, left: 12, right: 12, gap: 8, alignItems: 'center' }}>
        <View style={[s.floatBar, { backgroundColor: c.surface, borderColor: c.line }]}>
          <CityPicker city={city} onPick={setCity} />
          <Row style={{ gap: 8 }}>
            {near ? <Btn title="Whole city" small variant="secondary" onPress={() => setNear(null)} /> : <Btn title="Near me" small variant="secondary" onPress={locate} loading={locating} />}
            <Btn title="List ↗" small onPress={() => go('/activities?from=map')} />
          </Row>
        </View>
        {geoMsg ? <View style={{ width: '100%', maxWidth: 560 }}><Banner>{geoMsg}</Banner></View> : null}
        {feed.error ? <View style={{ width: '100%', maxWidth: 560 }}><ErrorBanner message={feed.error.message} /></View> : null}
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: 14, alignItems: 'center' }}>
        {selected && selected.items.length > 1 ? (
          // several activities at this place: all of them, soonest first
          <View style={[s.bottomCard, { backgroundColor: c.surface, borderColor: c.line, flexDirection: 'column', alignItems: 'stretch', gap: 6 }]}>
            <Txt variant="h3" accessibilityRole="header">{selected.items.length} activities here</Txt>
            <DistanceRow data={data} text="Distances are approximate, from where you are now." />
            <ScrollView style={{ maxHeight: 232 }} contentContainerStyle={{ gap: 4 }} nestedScrollEnabled>
              {selected.items.map((a) => (
                <Pressable
                  key={a.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${a.title}, ${when(a.startsAt)}, ${a.spotsLeft} spaces. Open activity`}
                  onPress={() => go(`/activity/${a.id}`)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, minHeight: 52 }, activeId === a.id && { backgroundColor: c.accentSoft }, pressed && { opacity: 0.8 }]}
                >
                  <CatPhoto category={a.category} style={{ width: 40, height: 40, borderRadius: 11 }} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="h3" numberOfLines={1}>{a.title}</Txt>
                    <Txt variant="muted" numberOfLines={1}>
                      {when(a.startsAt)} · {a.going}/{a.capacity} going · {a.spotsLeft} left{dist.me ? ` · ${fmtKm(kmBetween(dist.me, { lat: a.lat, lng: a.lng }))} away` : ''}
                    </Txt>
                  </View>
                  <Txt variant="label" color={c.forest}>Open ›</Txt>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : one ? (
          <View style={[s.bottomCard, { backgroundColor: c.surface, borderColor: c.line, flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${one.title}, ${when(one.startsAt)}. Open activity`} onPress={() => go(`/activity/${one.id}`)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <CatPhoto category={one.category} style={{ width: 52, height: 52, borderRadius: 13 }} />
              <View style={{ flex: 1, gap: 1 }}>
                <Txt variant="h3" numberOfLines={1}>{one.title}</Txt>
                <Txt variant="muted">{when(one.startsAt)}{one.distanceKm !== undefined ? ` · ${one.distanceKm} km` : ''}</Txt>
                <Txt variant="muted">{one.going}/{one.capacity} confirmed · {one.spotsLeft} {one.spotsLeft === 1 ? 'space' : 'spaces'}</Txt>
              </View>
            </Pressable>
            <Btn title="Join" small onPress={() => go(`/activity/${one.id}`)} />
            </View>
            <DistanceRow data={data} text={dist.me ? `About ${fmtKm(kmBetween(dist.me, { lat: one.lat, lng: one.lng }))} away · approximate, from where you are now.` : undefined} />
          </View>
        ) : feed.data && pins.length === 0 ? (
          <View style={[s.bottomCard, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Txt style={{ flex: 1 }}>No venues on the map for today or tomorrow.</Txt>
            <Btn title="Create" small onPress={() => go('/create')} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

export const s = StyleSheet.create({
  floatBar: { width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  bottomCard: { width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 10, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  badge: { position: 'absolute', top: 1, right: 1, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#0F2F28', borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pin: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
