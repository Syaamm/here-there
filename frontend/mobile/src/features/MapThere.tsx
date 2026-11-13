import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Keyboard, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TripRow } from '@/components/Cards';
import { DropPinSheet } from '@/components/DropPinSheet';
import { Text, TextInput } from '@/components/ScaledText';
import { Reveal } from '@/components/Reveal';
import { DestinationResults } from '@/components/TripCreateParts';
import { Btn, ErrorBanner, Pill, PillRow, Txt } from '@/components/ui';
import { MapHint } from '@/components/MapHint';
import { get, type Trip } from '@/lib/api';
import { useCity, useCityPos } from '@/lib/city';
import { useDockSpace } from '@/lib/dock';
import { TRIP_TAGS } from '@/lib/constants';
import { tagLabel, useCategories } from '@/lib/categories';
import { useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { keyboardTaps } from '@/lib/keyboard';
import { statusTop } from '@/lib/layout';
import { useTheme } from '@/lib/theme';
import { PinIcon } from './PinIcon';
import { useCityCenter } from './mapShared';
import { useThereFilters } from './ThereFilters';
import { dateLang, isoDay } from '@/lib/format';

import { sc, sp, sph } from '@/lib/scale';
/** Trips with a position, and every trip at (about) the same place: one pin on the map, however many go there. */
type TripPin = Trip & { lat: number; lng: number };
type Group = { key: string; lat: number; lng: number; items: TripPin[] };

const GREY_MAP = [
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde6ea' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e4ecdf' }] },
];

type ViewBox = { south: number; north: number; west: number; east: number };
const PAGE = 20; // the list under the map shows this many trips at a time
/** The box of the map on screen, with a margin of a third on each side (so a small move does not ask again), to one decimal. */
function toView(lat: number, lng: number, dLat: number, dLng: number): ViewBox {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  const all = dLng * 1.66 >= 360;
  return {
    south: r1(Math.max(-90, lat - dLat * 0.83)),
    north: r1(Math.min(90, lat + dLat * 0.83)),
    west: all ? -180 : r1(wrap(lng - dLng * 0.83)),
    east: all ? 180 : r1(wrap(lng + dLng * 0.83)),
  };
}
const foundDest = new Map<string, { lat: number; lng: number } | null>(); // destinations already looked up, once each per session
const lastPinTap = { at: 0 }; // the map also reports a tap on a pin as a tap on itself, which would close what the pin just opened

const MapPin = memo(function MapPin({ g, active, onSelect }: { g: Group; active: boolean; onSelect: (g: Group) => void }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const timer = setTimeout(() => setTrack(false), 950);
    return () => clearTimeout(timer);
  }, [active]);
  const coordinate = useMemo(() => ({ latitude: g.lat, longitude: g.lng }), [g.lat, g.lng]);
  return (
    <Marker
      anchor={{ x: 0.5, y: 1 }}
      coordinate={coordinate}
      title={g.items.length > 1 ? `${g.items.length}` : g.items[0].destination}
      tracksViewChanges={track}
      onPress={(e) => {
        e?.stopPropagation?.();
        lastPinTap.at = Date.now();
        Keyboard.dismiss();
        onSelect(g);
      }}
    >
      <PinIcon full={g.items.every((x) => x.spotsLeft === 0)} active={active} count={g.items.length} />
    </Marker>
  );
});

const STYLES = [
  ['', 'All trips'],
  ['together', 'Travel together'],
  ['meet_at_destination', 'Meet at destination'],
] as const;

/**
 * THERE · Map: every open trip as a pin on the map, at its destination (anywhere in the world; there is no distance limit like
 * HERE's city area). Search a country or a place and the map flies there. Filter by how the group gets there and by interest.
 * Tap a pin for its trips; press and hold the map to drop a pin and plan a trip there.
 */
export function MapThere() {
  const { t, tn } = useT();
  useCategories();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const dock = useDockSpace();
  const [city] = useCity();
  const cityPos = useCityPos();
  const home = useCityCenter(city, cityPos).at;
  const f = useThereFilters();
  const [tag, setTag] = useState<string | null>(null);
  const map = useRef<MapView>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dropped, setDropped] = useState<{ lat: number; lng: number } | null>(null);
  const [q, setQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false); // the filter card under the search
  const [shown, setShown] = useState(PAGE); // how many of them it shows (20 at a time)
  const [typed, setTyped] = useState(false);
  const [focus, setFocus] = useState(false);

  // the trips are asked for the part of the map on screen (a little beyond it), and again when the map is moved or zoomed
  const [view, setView] = useState<ViewBox>(() => toView(home?.[0] ?? 25, home?.[1] ?? 10, home ? 12 : 90, home ? 12 : 90));
  const viewKey = `${view.south},${view.north},${view.west},${view.east}`;
  // the open trips that fit the two filters and are in view, in pages of 50 (up to four); the ones with a position become pins
  const query = { ...f.build('', f.style, tag ? [tag] : []), south: String(view.south), north: String(view.north), west: String(view.west), east: String(view.east) };
  const feed = useLoad(
    async () => {
      const items: Trip[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 4; i++) {
        const p = new URLSearchParams({ ...query, limit: '50' });
        if (cursor) p.set('cursor', cursor);
        const r: { items: Trip[]; nextCursor?: string | null } = await get(`/v1/trips?${p}`);
        items.push(...r.items);
        cursor = r.nextCursor ?? null;
        if (!cursor) break;
      }
      return { items };
    },
    [f.style, tag, viewKey, f.from, f.to],
    60_000,
    undefined,
    { keep: true },
  );
  const trips = feed.data?.items ?? [];
  // Trips made before they stored a map position are placed by looking their destination up once (the destination, never the departure city)
  const [looked, setLooked] = useState(0);
  useEffect(() => {
    const todo = [...new Set(trips.filter((x) => (x.lat == null || x.lng == null) && x.destination.trim()).map((x) => x.destination.trim()))].filter((d) => !foundDest.has(d.toLowerCase())).slice(0, 30);
    if (!todo.length) return;
    let live = true;
    (async () => {
      for (const d of todo) {
        if (!live) return;
        try {
          const r = await get<{ items: { lat: number; lng: number }[] }>(`/v1/places/search?${new URLSearchParams({ q: d, kind: 'destination' })}`);
          foundDest.set(d.toLowerCase(), r.items[0] ? { lat: r.items[0].lat, lng: r.items[0].lng } : null);
        } catch {
          return; // too many searches at once or no connection: not remembered, tried again next time
        }
        if (live) setLooked((n) => n + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [feed.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins = useMemo(
    () =>
      trips.flatMap((x): TripPin[] => {
        const at = x.lat != null && x.lng != null ? { lat: x.lat, lng: x.lng } : foundDest.get(x.destination.trim().toLowerCase());
        return at ? [{ ...x, lat: at.lat, lng: at.lng }] : [];
      }),
    [feed.data, looked], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const p of pins) {
      const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
      const g = by.get(key) ?? { key, lat: p.lat, lng: p.lng, items: [] };
      g.items.push(p);
      by.set(key, g);
    }
    for (const g of by.values()) g.items.sort((x, y) => +new Date(x.dateStart) - +new Date(y.dateStart));
    return [...by.values()];
  }, [pins]);
  const selected = groups.find((g) => g.key === selectedKey) ?? null;
  const pick = useRef(setSelectedKey);
  const onSelect = useCallback((g: Group) => pick.current(g.key), []);
  const region = useRef<Region | null>(null);
  useEffect(() => setShown(PAGE), [f.style, tag, viewKey, f.from, f.to]); // a new search starts the list again at the first 20

  // a searched place: the map moves to it, to city level (a whole country or region is shown wider). Nothing else changes: the app's own city is not touched.
  const flyTo = (at: { lat: number; lng: number }, wide: boolean) => {
    const d = wide ? 6 : 0.25;
    map.current?.animateToRegion({ latitude: at.lat, longitude: at.lng, latitudeDelta: d, longitudeDelta: d }, 600);
  };

  const first = useRef(true);
  useEffect(() => {
    // arriving: show the area around the person's own city (a wide view), or the whole world when it is not known
    if (first.current && home) {
      first.current = false;
      map.current?.animateToRegion({ latitude: home[0], longitude: home[1], latitudeDelta: 12, longitudeDelta: 12 }, 0);
    }
  }, [home]);

  const top = statusTop(insets.top) + 8;
  const shadow = { elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } } as const;

  // the months to choose from: this one (from today), the next, and each one after for a year ahead. A month is a first and a last day in the same filters
  // as every other date (f.from, f.to), so the trips on the map and in the list narrow to it, and "Clear" and the filter button's dot know about it.
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const name = first.toLocaleDateString(dateLang(), { month: 'long', ...(first.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) });
    return { key: i, label: i === 0 ? t('This month') : i === 1 ? t('Next month') : name.charAt(0).toUpperCase() + name.slice(1), from: isoDay(i === 0 ? now : first), to: isoDay(last) };
  });
  const filtersOn = f.style !== '' || tag !== null || f.from !== '';
  const clearFilters = () => {
    f.setStyle('');
    setTag(null);
    f.setFrom('');
    f.setTo('');
  };

  // what the sheet lists: the trips at the tapped pin, or every trip in view (soonest first, 20 at a time)
  const { height: screenH } = useWindowDimensions();
  const [isOpen, setIsOpen] = useState(false);
  const rowsAll = useMemo(() => (selected ? selected.items : [...pins].sort((x, y) => +new Date(x.dateStart) - +new Date(y.dateStart)).slice(0, shown)), [selected, pins, shown]);
  // pulled up, the search bar only narrows this list (no place suggestions, and the map stays where it is)
  const listMode = isOpen && !selected;
  const needleT = listMode ? q.trim().toLowerCase() : '';
  const rows = needleT ? rowsAll.filter((x) => `${x.title} ${x.destination} ${x.tags.join(' ')}`.toLowerCase().includes(needleT)) : rowsAll;
  const hasMore = !selected && pins.length > shown;
  // the sheet is as tall as the trips really are (measured), up to just over half the screen, so a trip card shows whole and only a long list scrolls
  const [contentH, setContentH] = useState(0);
  // Pulled up, the card rises over the map as far as the search bar (not a new page: the map stays where it was, and pulling the card
  // down shows the very same map again), so the list is as tall as the room between the bar and the card's top part.
  const [baseH, setBaseH] = useState(96); // the card's top part (handle and summary), measured
  const fullMax = Math.max(160, Math.round(screenH - (top + 58 + 12) - baseH - dock));
  // a tapped pin shows a short card of just its trips (as tall as they are); the card pulled up goes the whole way to the bar
  const listMax = selected ? Math.min(fullMax, contentH > 0 ? contentH + 10 : rows.length * 150 + 10) : fullMax;

  // 0 = just the summary, 1 = list showing: moved by a finger (drag), a tap on the handle, or a tap on a pin. The sheet slides as one
  // piece (a transform), so the movement is drawn on the native thread and stays smooth, as on HERE.
  const open = useRef(new Animated.Value(0)).current;
  const openAt = useRef(0);
  const dragFrom = useRef(0);
  const maxRef = useRef(listMax);
  maxRef.current = listMax;
  const settle = useCallback(
    (to: 0 | 1, velocity = 0) => {
      if (to === 0) Keyboard.dismiss(); // the card goes down: so does the keyboard
      openAt.current = to;
      setIsOpen(to === 1);
      Animated.spring(open, { toValue: to, velocity, friction: 11, tension: 90, useNativeDriver: true }).start();
    },
    [open],
  );
  const key = selected?.key ?? '';
  useEffect(() => {
    settle(key ? 1 : 0);
  }, [key, settle]);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragFrom.current = openAt.current;
        open.stopAnimation((v) => {
          openAt.current = v;
          dragFrom.current = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        const v = Math.max(0, Math.min(1, dragFrom.current - g.dy / Math.max(maxRef.current, 1)));
        openAt.current = v;
        open.setValue(v);
      },
      onPanResponderRelease: (_e, g) => {
        const to = g.vy < -0.3 ? 1 : g.vy > 0.3 ? 0 : openAt.current > 0.5 ? 1 : 0;
        settle(to, -g.vy / Math.max(maxRef.current, 1));
      },
    }),
  ).current;
  const sheetY = open.interpolate({ inputRange: [0, 1], outputRange: [listMax, 0] });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: home?.[0] ?? 25, longitude: home?.[1] ?? 10, latitudeDelta: home ? 12 : 90, longitudeDelta: home ? 12 : 90 }}
        customMapStyle={GREY_MAP}
        onPress={() => {
          Keyboard.dismiss(); // a tap on the map (not a drag) puts the keyboard away
          if (Date.now() - lastPinTap.at < 500) return;
          setSelectedKey(null);
        }}
        onLongPress={(e) => setDropped({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
        onRegionChangeComplete={(r) => {
          region.current = r;
          const next = toView(r.latitude, r.longitude, r.latitudeDelta, r.longitudeDelta);
          setView((old) => (old.south === next.south && old.north === next.north && old.west === next.west && old.east === next.east ? old : next));
        }}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        accessibilityLabel={t('Map of trips')}
      >
        {groups.map((g) => (
          <MapPin key={g.key} g={g} active={selected?.key === g.key} onSelect={onSelect} />
        ))}
        {dropped ? <Marker anchor={{ x: 0.5, y: 1 }} coordinate={{ latitude: dropped.lat, longitude: dropped.lng }} pinColor="#2E7D32" /> : null}
      </MapView>

      {/* top: the search for a country or place and the filter button; the filters open under it */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top, left: sc(16), right: sc(16), gap: sp(10), alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: sc(560), gap: sp(6) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(10) }}>
            <View style={[{ flex: 1, height: sc(58), borderRadius: sc(29), backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: sp(8), paddingLeft: sph(18), paddingRight: sph(6) }, shadow]}>
              <Ionicons name="search-outline" size={sc(20)} color={c.muted} />
              <TextInput
                accessibilityLabel={listMode ? t('Search these trips') : t('Search a country or place')}
                value={q}
                onChangeText={(v) => {
                  setQ(v);
                  setTyped(true);
                }}
                onFocus={() => {
                  setFocus(true);
                  setTyped(false);
                }}
                onBlur={() => setTimeout(() => setFocus(false), 200)}
                placeholder={listMode ? t('Search these trips') : t('Where next? For example, Japan')}
                placeholderTextColor={c.placeholder}
                returnKeyType="search"
                autoCorrect={false}
                maxLength={100}
                style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 0 }}
              />
              {q ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('Clear the search')} hitSlop={8} onPress={() => { setQ(''); setTyped(false); Keyboard.dismiss(); }} style={{ width: sc(40), height: sc(40), alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={sc(20)} color={c.text} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={filtersOn ? t('Filters, on') : t('Filters')}
              accessibilityState={{ selected: filtersOpen || filtersOn }}
              onPress={() => {
                Keyboard.dismiss();
                setFiltersOpen((v) => !v);
              }}
              hitSlop={4}
              style={({ pressed }) => [{ width: sc(58), height: sc(58), borderRadius: sc(29), backgroundColor: filtersOpen || filtersOn ? c.forest : c.surface, alignItems: 'center', justifyContent: 'center' }, shadow, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <Ionicons name="options-outline" size={sc(26)} color={filtersOpen || filtersOn ? '#fff' : c.text} />
            </Pressable>
          </View>
          <DestinationResults
            text={q}
            active={focus && typed && !listMode}
            onPick={(label, at) => {
              setQ(label);
              setTyped(false);
              Keyboard.dismiss(); // a place was picked: the keyboard goes down
              if (at) flyTo(at, !label.includes(','));
            }}
          />
        </View>

        {/* the filters, on a card of their own so they read clearly over the map: how the group gets there, and the interest */}
        {filtersOpen || filtersOn ? (
          <View style={[{ width: '100%', maxWidth: sc(560), backgroundColor: c.surface, borderRadius: sc(26), padding: sp(14), gap: sp(12) }, shadow]}>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('How the group gets there')} style={{ gap: sp(6) }}>
              <Txt variant="small">{t('How the group gets there')}</Txt>
              <PillRow>
                {STYLES.map(([v, label]) => (
                  <Pill key={v || 'all'} label={t(label)} active={f.style === v} onPress={() => f.setStyle(v)} />
                ))}
              </PillRow>
            </View>
            <View style={{ gap: sp(6) }}>
              <Txt variant="small">{t('Month')}</Txt>
              <PillRow>
                <Pill label={t('Any month')} active={!f.from} onPress={() => (f.setFrom(''), f.setTo(''))} />
                {monthOptions.map((m) => (
                  <Pill key={m.key} label={m.label} active={f.from === m.from && f.to === m.to} onPress={() => (f.setFrom(m.from), f.setTo(m.to))} />
                ))}
              </PillRow>
              {/* what is being shown, easing in when a month is chosen */}
              {f.from ? (
                <Reveal key={f.from} from={6}>
                  <Txt variant="small" color={c.green}>{t('Showing trips in {month}', { month: (monthOptions.find((m) => m.from === f.from && m.to === f.to)?.label ?? `${f.from} – ${f.to}`).toLowerCase() })}</Txt>
                </Reveal>
              ) : null}
            </View>
            <View style={{ gap: sp(6) }}>
              <Txt variant="small">{t('Interest')}</Txt>
              <PillRow>
                <Pill label={t('All')} active={tag === null} onPress={() => setTag(null)} />
                {TRIP_TAGS.map((k) => (
                  <Pill key={k} label={t(tagLabel(k))} active={tag === k} onPress={() => setTag(tag === k ? null : k)} />
                ))}
              </PillRow>
            </View>
            {filtersOn ? (
              <Pressable accessibilityRole="button" accessibilityLabel={t('Clear filters')} hitSlop={8} onPress={clearFilters} style={{ alignSelf: 'flex-start' }}>
                <Txt variant="h3" color={c.forest} style={{ fontSize: 12 }}>{t('Clear filters')}</Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {feed.error ? <View style={{ width: '100%', maxWidth: sc(560) }}><ErrorBanner message={feed.error.message} /></View> : null}
        <MapHint id="there" title={t('Finding your trip')}>{t('Zoom out to find your destination, then zoom in on the place. Tap a pin to see the trips that go there, or search a country or a place.')}</MapHint>
      </View>

      {/* bottom sheet, the same movement as HERE: it rises with the trips of a tapped pin, or is pulled up (or tapped) for every trip in view */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', backgroundColor: c.bg, borderTopLeftRadius: sc(40), borderTopRightRadius: sc(40), paddingBottom: 12 + dock, paddingHorizontal: sph(20), elevation: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -sc(3) }, transform: [{ translateY: sheetY }] }}>
        <View {...pan.panHandlers} onLayout={(e) => setBaseH(e.nativeEvent.layout.height + 12)} style={{ width: '100%', alignItems: 'center' }}>
          <Pressable accessibilityRole="adjustable" accessibilityLabel={t('Trips list. Swipe up to open, down to close')} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => settle(e.nativeEvent.actionName === 'increment' ? 1 : 0)} onPress={() => settle(openAt.current > 0.5 ? 0 : 1)} hitSlop={{ top: 6, bottom: 6 }} style={{ width: '100%', alignItems: 'center', paddingTop: sp(8), paddingBottom: sp(14) }}>
            <View style={{ width: sc(36), height: sc(4), borderRadius: 2, backgroundColor: c.line }} />
          </Pressable>
          <View style={{ width: '100%', maxWidth: sc(560), gap: sp(4) }}>
            {selected ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp(8) }}>
                <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700' }}>
                  {selected.items.length === 1 ? selected.items[0].destination : tn(selected.items.length, '{n} trip here', '{n} trips here')}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} hitSlop={10} onPress={() => setSelectedKey(null)}>
                  <Ionicons name="close" size={sc(22)} color={c.muted} />
                </Pressable>
              </View>
            ) : feed.data && pins.length === 0 ? (
              <>
                <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700' }}>
                  {filtersOn ? t('No trips match these filters here') : t('No trips in this part of the map')}
                </Text>
                {filtersOn ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={t('Clear filters')} hitSlop={8} onPress={clearFilters} style={{ alignSelf: 'flex-start' }}>
                    <Txt variant="h3" color={c.forest} style={{ fontSize: 16 }}>{t('Clear filters')}</Txt>
                  </Pressable>
                ) : (
                  <Txt variant="small">{t('Move the map, or press and hold it to plan a trip there.')}</Txt>
                )}
              </>
            ) : (
              <>
                <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700' }}>
                  {feed.data ? tn(pins.length, '{n} trip in view', '{n} trips in view') : t('Loading…')}
                </Text>
                <Txt variant="small">{feed.loading && feed.data ? t('Updating…') : t('Tap a pin to preview, or pull up for the list')}</Txt>
              </>
            )}
          </View>
        </View>

        {/* the list: always its full height, the whole sheet slides (drawn on the native side); rows ease in one after another */}
        <Animated.View pointerEvents={isOpen ? 'auto' : 'none'} style={{ width: '100%', maxWidth: sc(560), height: listMax, overflow: 'hidden', opacity: open.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.6, 1] }) }}>
          <ScrollView style={{ marginTop: sp(10) }} contentContainerStyle={{ gap: sp(10), paddingBottom: sp(4) }} onContentSizeChange={(_w, h) => setContentH(Math.ceil(h))} nestedScrollEnabled showsVerticalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps}>
            {rows.map((x, i) => (
              <Reveal key={`${key}:${x.id}`} index={i}>
                <TripRow t={x} />
              </Reveal>
            ))}
            {hasMore ? <Btn title={t('Show more')} variant="secondary" onPress={() => setShown((n) => n + PAGE)} /> : null}
          </ScrollView>
        </Animated.View>
      </Animated.View>

      <DropPinSheet kind="trip" at={dropped} centre={null} city={city} onClose={() => setDropped(null)} />
    </View>
  );
}
