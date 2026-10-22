import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CatPhoto } from '@/components/CatPhoto';
import { Reveal } from '@/components/Reveal';
import { CityPicker } from '@/components/CityPicker';
import { Banner, Btn, ErrorBanner, Pill, PillRow, Row, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { useDockSpace } from '@/lib/dock';
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
  const [cat, setCat] = useState(''); // '' = every category
  // zoom buttons: each press is a new command the map screen carries out (+1 in, -1 out)
  const [zoomCmd, setZoomCmd] = useState<{ d: 1 | -1; n: number } | null>(null);
  const zoom = (d: 1 | -1) => setZoomCmd((p) => ({ d, n: (p?.n ?? 0) + 1 }));
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // the activity the person picked in the list, highlighted inside a group
  const [activeId, setActiveId] = useState<string | null>(null);
  // set when the map should fly to a venue (from "Near me" or from picking an activity in the list)
  const [target, setTarget] = useState<{ lat: number; lng: number; zoom: 'city' | 'near' | 'venue' } | null>(null);
  const { focus, t } = useLocalSearchParams<{ focus?: string; t?: string }>();
  const router = useRouter();
  const handled = useRef('');
  // "How far?": the person's approximate position, kept in memory for the open card only and dropped when it closes
  const [dist, setDist] = useState<Distance>({ status: 'idle' });

  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50', ...(cat && { category: cat }) });
      if (near) {
        p.set('lat', String(near.lat));
        p.set('lng', String(near.lng));
        p.set('radiusKm', '3');
      }
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, near, cat],
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
    // the address keeps its parameters, so drop them: tapping the Map tab later must open the plain map, not this venue again
    router.setParams({ focus: undefined, t: undefined });
  }, [focus, t, pins]);

  // Leaving the map puts it back to the default view: whole city, every activity, nothing selected.
  const cityRef = useRef(city);
  cityRef.current = city;
  useFocusEffect(
    useCallback(
      () => () => {
        setSelectedKey(null);
        setActiveId(null);
        setDist({ status: 'idle' });
        setNear(null);
        setCat('');
        const home = CITY_CENTERS[cityRef.current.toLowerCase()];
        setTarget(home ? { lat: home[0], lng: home[1], zoom: 'city' } : null);
      },
      [],
    ),
  );

  // the location notice is only a heads-up: it goes away by itself after 5 seconds
  useEffect(() => {
    if (!geoMsg) return;
    const t = setTimeout(() => setGeoMsg(null), 5000);
    return () => clearTimeout(t);
  }, [geoMsg]);

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

  return { city, setCity, cat, setCat, zoom, zoomCmd, near, setNear, geoMsg, locating, locate, dist, measure, selected, setSelected, activeId, feed, pins, groups, center, target };
}

/** The teardrop pin's width: a little bigger for a place with more activities. */
export const pinWidth = (count: number) => Math.min(34 + (Math.max(count, 1) - 1) * 2, 54);
export const PIN_PATH = 'M12 2C7.6 2 4 5.5 4 9.8c0 5.6 6.4 11.5 7.3 12.3a1 1 0 0 0 1.4 0C13.6 21.3 20 15.4 20 9.8 20 5.5 16.4 2 12 2z';
/** "in 45 min" / "in 2 h 10 min": how long until the next activity starts. */
function untilStart(iso: string) {
  const min = Math.max(1, Math.round((+new Date(iso) - Date.now()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The small white round button used for zoom and the like, floating on the map. */
function RoundTool({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }, pressed && { opacity: 0.85, transform: [{ scale: 0.94 }] }]}
    >
      <Ionicons name={icon} size={20} color={c.forest} />
    </Pressable>
  );
}

/** Small outlined pill with an icon, e.g. "How far?". */
function PillButton({ icon, title, onPress, disabled }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; onPress: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: disabled ? 0.6 : 1 }, pressed && { opacity: 0.85 }]}
    >
      <Ionicons name={icon} size={15} color={c.forest} />
      <Txt variant="h3" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{title}</Txt>
    </Pressable>
  );
}

/**
 * Floating layer over the full-screen map, in the style of the design: a card with the city and a Map | List switch,
 * category chips under it, zoom and "Near me" buttons, and a bottom sheet. The sheet says how many activities there are;
 * pull it up (or tap its handle) to see them all, or tap a pin and it rises by itself with the activities at that pin.
 */
export function MapOverlay({ data }: { data: ReturnType<typeof useMapData> }) {
  const go = useGo();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const dock = useDockSpace();
  const { height: screenH } = useWindowDimensions();
  const { city, setCity, cat, setCat, near, setNear, geoMsg, locating, locate, zoom, selected, activeId, feed, pins, dist, measure } = data;

  // what the pulled-up list shows: the activities at the tapped pin, or every pin's, soonest first
  const rows = selected ? selected.items : [...pins].sort((x, y) => +new Date(x.startsAt) - +new Date(y.startsAt));
  const ROW = 70; // one row and the gap under it
  const listMax = Math.min(rows.length * ROW + 4, Math.round(screenH * 0.42));

  // 0 = just the summary, 1 = list showing. Driven by a finger (drag), a tap on the handle, or by tapping a pin.
  const open = useRef(new Animated.Value(0)).current;
  const openAt = useRef(0); // the same value, readable while dragging
  const dragFrom = useRef(0);
  const maxRef = useRef(listMax);
  maxRef.current = listMax;
  useEffect(() => {
    const id = open.addListener(({ value }) => (openAt.current = value));
    return () => open.removeListener(id);
  }, [open]);
  const settle = useCallback(
    (to: 0 | 1, velocity = 0) => {
      Animated.spring(open, { toValue: to, velocity, friction: 9, tension: 80, useNativeDriver: false }).start();
    },
    [open],
  );
  // tapping a pin raises the sheet to its list; tapping the map empty lowers it again
  const key = selected?.key ?? '';
  useEffect(() => {
    settle(key ? 1 : 0);
  }, [key, settle]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        open.stopAnimation();
        dragFrom.current = openAt.current;
      },
      onPanResponderMove: (_e, g) => open.setValue(Math.max(0, Math.min(1, dragFrom.current - g.dy / Math.max(maxRef.current, 1)))),
      onPanResponderRelease: (_e, g) => {
        const moved = Math.abs(g.dy) < 5 && Math.abs(g.dx) < 5; // a tap on the handle toggles
        if (moved) return settle(openAt.current > 0.5 ? 0 : 1);
        const to = g.vy < -0.3 ? 1 : g.vy > 0.3 ? 0 : openAt.current > 0.5 ? 1 : 0;
        settle(to, -g.vy / Math.max(maxRef.current, 1));
      },
    }),
  ).current;

  const listH = open.interpolate({ inputRange: [0, 1], outputRange: [0, listMax] });
  const [baseH, setBaseH] = useState(96); // the sheet without its list: handle + summary
  const toolsBottom = Animated.add(listH, baseH + 12 + dock);

  const todayCount = pins.filter((a) => new Date(a.startsAt).toDateString() === new Date().toDateString()).length;
  const count = todayCount > 0 ? todayCount : pins.length;
  const nextStart = pins.length ? pins.reduce((m, a) => (a.startsAt < m ? a.startsAt : m), pins[0].startsAt) : null;
  const noteText =
    dist.status === 'locating'
      ? 'Finding your approximate location…'
      : dist.status === 'done'
        ? 'Distances are approximate, from where you are now.'
        : dist.status === 'denied'
          ? 'Location is off. Distance needs your approximate location, only when you ask. You can allow it in settings.'
          : dist.status === 'error'
            ? 'We could not get your location. Try again.'
            : 'Your location is only used when you tap, and is never saved or shared.';

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* top: a floating card with the place on the left and search on the right, then the category chips */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 12, left: 12, right: 12, gap: 8, alignItems: 'center' }}>
        <View style={[s.floatBar, { backgroundColor: c.surface, borderColor: c.line }]}>
          <CityPicker city={city} onPick={setCity} subtitle={near ? 'Near you' : 'Around you'} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Search activities" onPress={() => go('/activities?from=map')} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="search-outline" size={22} color={c.text} />
            </Pressable>
          </View>
        </View>
        <View style={{ width: '100%', maxWidth: 560 }}>
          <PillRow>
            <Pill label="All" active={cat === ''} onPress={() => setCat('')} />
            {Object.entries(CATS).map(([k, v]) => (
              <Pill key={k} label={v.label} active={cat === k} onPress={() => setCat(k)} />
            ))}
          </PillRow>
        </View>
        {geoMsg ? <View style={{ width: '100%', maxWidth: 560 }}><Banner>{geoMsg}</Banner></View> : null}
        {feed.error ? <View style={{ width: '100%', maxWidth: 560 }}><ErrorBanner message={feed.error.message} /></View> : null}
      </View>

      {/* tools: "Near me" bottom left, zoom bottom right; they ride up with the sheet */}
      <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: toolsBottom, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        {near ? (
          <PillButton icon="close-circle-outline" title="Whole city" onPress={() => setNear(null)} />
        ) : (
          <PillButton icon="locate-outline" title="Near me" onPress={locate} disabled={locating} />
        )}
        <View style={{ gap: 8 }}>
          <RoundTool icon="add" label="Zoom in" onPress={() => zoom(1)} />
          <RoundTool icon="remove" label="Zoom out" onPress={() => zoom(-1)} />
        </View>
      </Animated.View>

      {/* bottom sheet */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: c.line, paddingBottom: 12 + dock, // runs down behind the dock, so no strip of map shows between them
         paddingHorizontal: 16, elevation: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -3 } }}>
        <View onLayout={(e) => setBaseH(e.nativeEvent.layout.height + 12)} style={{ width: '100%', alignItems: 'center' }}>
          {/* the grip and the summary are the part you drag */}
          <View {...pan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Activities list. Swipe up to open, down to close" style={{ width: '100%', alignItems: 'center', paddingTop: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.line, marginBottom: 10 }} />
          </View>
          <View style={{ width: '100%', maxWidth: 560, gap: 8 }}>
            {selected ? (
              <>
                <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                  <Txt variant="h2" accessibilityRole="header" style={{ fontSize: 17, lineHeight: 22, flex: 1 }}>
                    {selected.items.length === 1 ? '1 activity here' : `${selected.items.length} activities here`}
                  </Txt>
                  <PillButton icon={dist.status === 'done' ? 'refresh' : 'location-outline'} title={dist.status === 'done' ? 'Refresh' : dist.status === 'locating' ? 'Finding…' : dist.status === 'idle' ? 'How far?' : 'Try again'} onPress={measure} disabled={dist.status === 'locating'} />
                </Row>
                <Row style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Ionicons name="lock-closed-outline" size={13} color={c.muted} style={{ marginTop: 2 }} />
                  <Txt variant="small" style={{ flex: 1 }}>{noteText}</Txt>
                </Row>
              </>
            ) : feed.data && pins.length === 0 ? (
              <Row style={{ justifyContent: 'space-between', gap: 10 }}>
                <Txt style={{ flex: 1 }}>No venues on the map for today or tomorrow.</Txt>
                <Btn title="Create" small onPress={() => go('/create')} />
              </Row>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={openAt.current > 0.5 ? 'Hide the list' : 'Show all activities'} onPress={() => settle(openAt.current > 0.5 ? 0 : 1)}>
                <Row style={{ justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Txt variant="h2" accessibilityRole="header" style={{ fontSize: 17, lineHeight: 22 }}>
                      {feed.data ? `${count} ${count === 1 ? 'activity' : 'activities'}${todayCount > 0 ? ' today' : ' coming up'}` : 'Loading…'}
                    </Txt>
                    <Txt variant="small">Tap a pin to preview, or pull up for the list</Txt>
                  </View>
                  {nextStart ? (
                    <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
                      <Txt variant="h3" color={c.forest} style={{ fontSize: 11, lineHeight: 15 }}>Next in {untilStart(nextStart)}</Txt>
                    </View>
                  ) : null}
                </Row>
              </Pressable>
            )}
          </View>
        </View>

        {/* the list: its height follows the pull, rows ease in one after another each time the list changes */}
        <Animated.View style={{ width: '100%', maxWidth: 560, height: listH, overflow: 'hidden', opacity: open.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.6, 1] }) }}>
          <ScrollView style={{ marginTop: 10 }} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {rows.map((a, i) => (
              <Reveal key={`${key}:${a.id}`} index={i}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${a.title}, ${when(a.startsAt)}, ${a.spotsLeft} spaces. Open activity`}
                  onPress={() => go(`/activity/${a.id}`)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, borderRadius: 16, borderWidth: 1, borderColor: activeId === a.id ? c.forest : c.line, backgroundColor: c.surface }, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
                >
                  <CatPhoto category={a.category} style={{ width: 44, height: 44, borderRadius: 12 }} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{a.title}</Txt>
                    <Txt variant="small" numberOfLines={1} style={{ color: c.text }}>{when(a.startsAt)}</Txt>
                    <Txt variant="small" numberOfLines={1}>
                      {a.going}/{a.capacity} going · {a.spotsLeft} left{dist.me ? ` · ${fmtKm(kmBetween(dist.me, { lat: a.lat, lng: a.lng }))} away` : ''}
                    </Txt>
                  </View>
                  <Txt variant="h3" color={c.forest} style={{ fontSize: 12 }}>Open ›</Txt>
                </Pressable>
              </Reveal>
            ))}
          </ScrollView>
        </Animated.View>
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
