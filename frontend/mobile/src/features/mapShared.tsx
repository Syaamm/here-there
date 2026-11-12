import Ionicons from '@expo/vector-icons/Ionicons';
import * as Location from 'expo-location';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, LayoutAnimation, PanResponder, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text, TextInput } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CatPhoto } from '@/components/CatPhoto';
import { Reveal } from '@/components/Reveal';
import { Avatar, Banner, Btn, ErrorBanner, Field, Pill, PillRow, Row, Sheet, Txt, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { statusTop } from '@/lib/layout';
import { get, type Activity } from '@/lib/api';
import { CITY_AREA_KM, cityQuery, type Near, useCity, useCityPos, useNear } from '@/lib/city';
import { CitySearch } from '@/components/CitySearch';
import { MapHint } from '@/components/MapHint';
import { MonthCalendar } from '@/components/CreateParts';
import { ThereChip, ThereFilterSheet, ThereLabel } from '@/components/ThereParts';
import { useDockSpace } from '@/lib/dock';
import { catColor, CATS, CITY_CENTERS } from '@/lib/constants';
import { feedRange } from '@/lib/feed';
import { when } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import { t as tr, useT } from '@/lib/i18n';
import { keyboardTaps } from '@/lib/keyboard';
import { useScale } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { FS } from '@/lib/type';

export type Pin = Activity & { lat: number; lng: number };
/** Every activity at (about) the same place: one icon on the map, however many are there. */
export type Group = { key: string; lat: number; lng: number; items: Pin[] };

export type Fix = { lat: number; lng: number };

const FIRST_DAYS = 1; // the map first shows today; "Show tomorrow" adds the next day, and the filter can pick one day at a time
const MAX_DAYS = 31; // and can be taken forward one day at a time, up to about a month

/**
 * One approximate location fix, taken only because the person just asked for it. Permission is requested on every call
 * (the system only shows a prompt when it needs to), the fix is a single low-accuracy reading rounded to about 1 km,
 * and there is no tracking: nothing watches, stores or sends the position.
 */
export async function approximateFix(): Promise<({ ok: true } & Fix) | { ok: false; reason: 'denied' | 'error'; /** false when the phone will not ask again: only its settings can allow it */ canAskAgain?: boolean }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { ok: false, reason: 'denied', canAskAgain: perm.canAskAgain };
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
export const fmtKm = (km: number) => (km < 1 ? tr('under 1 km') : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);

type Distance = { status: 'idle' | 'locating' | 'denied' | 'error' | 'done'; me?: Fix };

const foundCenters = new Map<string, [number, number] | null>(); // cities already looked up, so each is searched once per session

/**
 * Where a city is on the map. A few are known; any other city the person types is looked up once through our place search
 * (the first result is the city itself). Until it is found, or when it cannot be, this is null.
 */
export function useCityCenter(city: string, picked: { lat: number; lng: number } | null): { at: [number, number] | null; looking: boolean } {
  const key = city.trim().toLowerCase();
  const known = CITY_CENTERS[key];
  const [found, setFound] = useState<{ key: string; at: [number, number] | null } | null>(null);
  useEffect(() => {
    if (picked || known || key.length < 3) return; // a city picked from the search already brought its position
    if (foundCenters.has(key)) {
      setFound({ key, at: foundCenters.get(key) ?? null });
      return;
    }
    let live = true;
    get<{ items: { lat: number; lng: number }[] }>(`/v1/places/search?${new URLSearchParams({ q: city.trim() })}`)
      .then((r) => {
        const at: [number, number] | null = r.items[0] ? [r.items[0].lat, r.items[0].lng] : null;
        foundCenters.set(key, at);
        if (live) setFound({ key, at });
      })
      .catch(() => live && setFound({ key, at: null })); // not remembered: a failed search is tried again next time
    return () => {
      live = false;
    };
  }, [key, !!picked]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = found?.key === key;
  if (picked) return { at: [picked.lat, picked.lng], looking: false };
  return { at: known ?? (done ? found.at : null), looking: !known && key.length >= 3 && !done };
}

/** Everything both map screens share: the data, "Near me", and which pin is selected. Venues only, never people. */
export function useMapData() {
  const { t } = useT();
  const [city, setCity] = useCity();
  const cityPos = useCityPos();
  const [near, setNear] = useNear(); // kept across screens and app restarts until the person picks a city or taps "Whole city"
  const [cat, setCat] = useState(''); // '' = every category
  const [days, setDays] = useState(FIRST_DAYS); // how many days from today are loaded: today to begin with
  const showNextDay = () => setDays((d) => Math.min(d + 1, MAX_DAYS));
  // day by day (from the filter): one chosen day only, counted from today (0 = today, 1 = tomorrow...); null = today and on, as above
  const [dayPick, setDayPick] = useState<number | null>(null);
  const autoNext = useRef(false); // today had no venues, so tomorrow was added by itself: only once per visit and city
  useEffect(() => {
    setDays(FIRST_DAYS); // another city starts again from today
    setDayPick(null);
    autoNext.current = false;
  }, [city]);
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
  const { focus, t: stamp } = useLocalSearchParams<{ focus?: string; t?: string }>();
  const router = useRouter();
  const handled = useRef('');
  // "How far?": the person's approximate position, kept in memory for the open card only and dropped when it closes
  const [dist, setDist] = useState<Distance>({ status: 'idle' });

  // The map's search: words ("coffee", "yoga") and/or a place picked in the search ("Brera"). Either one switches the map from
  // "today and tomorrow" to a search: the next month, a page of 20 at a time, only when the person asks (never per keystroke).
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<{ lat: number; lng: number; name: string } | null>(null);
  const searching = query !== '' || area !== null;
  const searchKey = JSON.stringify([city, near, cat, query, area]);
  const searchKeyRef = useRef(searchKey);
  searchKeyRef.current = searchKey;
  const lastSearch = useRef(''); // the question of the search page on screen, so "more" asks the same one
  const [extra, setExtra] = useState<{ key: string; items: Activity[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const busyMore = useRef(false);
  useEffect(() => setArea(null), [city]); // another city: the picked place no longer applies

  const feed = useLoad(
    () => {
      if (searching) {
        const from = new Date();
        const to = new Date(new Date().setHours(0, 0, 0, 0) + MAX_DAYS * 864e5);
        const base = area ? { lat: String(area.lat), lng: String(area.lng), radiusKm: '3' } : near ? { city } : cityQuery(city, cityPos);
        const p = new URLSearchParams({ ...base, from: from.toISOString(), to: to.toISOString(), limit: '20', ...(cat && { category: cat }), ...(query && { q: query }) });
        lastSearch.current = p.toString();
        return get<{ items: Activity[]; nextCursor?: string | null }>(`/v1/activities?${p}`).then((r) => ({ items: r.items, nextCursor: r.nextCursor ?? null, key: searchKey }));
      }
      // by day: today first; each "Show the next day" adds one more day (the activities list and the pins follow). With a day
      // picked in the filter: just that one day (today counts from now)
      const dayStart = new Date().setHours(0, 0, 0, 0) + (dayPick ?? 0) * 864e5;
      const from = dayPick !== null && dayPick > 0 ? new Date(dayStart) : new Date();
      const to = new Date(dayPick !== null ? dayStart + 864e5 : new Date().setHours(0, 0, 0, 0) + days * 864e5);
      // the city's area (or, with "Near me", 3 km around the person inside the city)
      const p = new URLSearchParams({ ...(near ? { city } : cityQuery(city, cityPos)), from: from.toISOString(), to: to.toISOString(), limit: '50', ...(cat && { category: cat }) });
      if (near) {
        p.set('lat', String(near.lat));
        p.set('lng', String(near.lng));
        p.set('radiusKm', '3');
      }
      // the map reads up to four pages (200 pins) from the server, so a busy city is not cut at its first 50
      return (async () => {
        const items: Activity[] = [];
        let cursor: string | null = null;
        for (let i = 0; i < 4; i++) {
          const r: { items: Activity[]; nextCursor?: string | null } = await get(`/v1/activities?${p}${cursor ? `&cursor=${cursor}` : ''}`);
          items.push(...r.items);
          cursor = r.nextCursor ?? null;
          if (!cursor) break;
        }
        return { items, nextCursor: null as string | null, key: '' };
      })();
    },
    [city, cityPos, near, cat, days, dayPick, query, area],
    searching ? undefined : 60_000, // a search is not polled: it is asked again only when the person changes it
    undefined,
    { keep: true }, // adding a day keeps the pins already shown until the new ones arrive
  );
  // the search's own pages: the first one came with the feed, the rest are asked for as the list is scrolled
  const extraNow = extra?.key === searchKey ? extra : null;
  const cursor = searching ? (extraNow ? extraNow.cursor : feed.data?.key === searchKey ? feed.data.nextCursor : null) : null;
  const loadMore = async () => {
    if (!cursor || busyMore.current) return;
    busyMore.current = true;
    setLoadingMore(true);
    const asked = searchKey;
    try {
      const r = await get<{ items: Activity[]; nextCursor?: string | null }>(`/v1/activities?${lastSearch.current}&cursor=${cursor}`);
      if (searchKeyRef.current !== asked) return; // the search changed meanwhile
      setExtra((prev) => ({ key: asked, items: [...(prev?.key === asked ? prev.items : []), ...r.items], cursor: r.nextCursor ?? null }));
    } catch {
      // the next scroll to the end asks again
    } finally {
      busyMore.current = false;
      setLoadingMore(false);
    }
  };
  // only rebuilt when the loaded activities change, so selecting a pin or closing the sheet never touches the map's markers
  const pins = useMemo(() => {
    const all = [...(feed.data?.items ?? []), ...(extraNow?.items ?? [])];
    const seen = new Set<string>();
    return all.filter((a): a is Pin => a.lat != null && a.lng != null && !seen.has(a.id) && !!seen.add(a.id));
  }, [feed.data, extraNow]);
  // Nothing on the map for today: tomorrow is shown by itself (once), instead of an empty map with a button to press
  useEffect(() => {
    if (searching || dayPick !== null || days !== FIRST_DAYS || autoNext.current || !feed.data || feed.error) return;
    if (feed.data.items.length === 0) {
      autoNext.current = true;
      setDays(FIRST_DAYS + 1);
    }
  }, [feed.data]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const { at: cityCenter, looking: findingCity } = useCityCenter(city, cityPos);
  const selected = groups.find((g) => g.key === selectedKey) ?? null;
  const setSelected = (g: Group | null) => {
    setSelectedKey(g?.key ?? null);
    setActiveId(null);
    setDist({ status: 'idle' });
  };
  const center = near ? ([near.lat, near.lng] as [number, number]) : (cityCenter ?? (pins[0] ? ([pins[0].lat, pins[0].lng] as [number, number]) : null));
  const cityCenterRef = useRef(cityCenter);
  cityCenterRef.current = cityCenter;

  // Picking another city moves the map there (the map itself is only built once, so it has to be told).
  const centerKey = cityCenter ? `${cityCenter[0]},${cityCenter[1]}` : '';
  const shownCenter = useRef(centerKey);
  useEffect(() => {
    if (centerKey && centerKey !== shownCenter.current && cityCenter) setTarget({ lat: cityCenter[0], lng: cityCenter[1], zoom: 'city' });
    shownCenter.current = centerKey;
  }, [centerKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arriving from the list with ?focus=<activity id>: select that venue and move the map to it, once per arrival.
  useEffect(() => {
    if (!focus) return;
    const key = `${focus}:${stamp ?? ''}`;
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
  }, [focus, stamp, pins]);

  // "Whole city" (or picking a city) drops "Near me": the map flies back out to the city
  const hadNear = useRef(!!near);
  useEffect(() => {
    if (hadNear.current && !near && cityCenterRef.current) setTarget({ lat: cityCenterRef.current[0], lng: cityCenterRef.current[1], zoom: 'city' });
    hadNear.current = !!near;
  }, [near]);

  // Leaving the map clears what was selected on it. The city and "Near me" are the person's own choice and stay as they are.
  const nearRef = useRef(near);
  nearRef.current = near;
  useFocusEffect(
    useCallback(
      () => () => {
        setSelectedKey(null);
        setActiveId(null);
        setDist({ status: 'idle' });
        setCat('');
        setQuery('');
        setArea(null);
        setDays(FIRST_DAYS);
        setDayPick(null);
        autoNext.current = false;
        const home = nearRef.current ? ([nearRef.current.lat, nearRef.current.lng] as [number, number]) : cityCenterRef.current;
        setTarget(home ? { lat: home[0], lng: home[1], zoom: nearRef.current ? 'near' : 'city' } : null);
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

  /**
   * "Near me": asks for the location (and the permission), finds the town or city you are in, and makes it the app's city, on
   * the map and on Home, until you pick another. Tapping it again only checks again: in the same city nothing changes, in
   * another one the city moves there. It never flips back to the previous city.
   */
  const locate = async () => {
    setGeoMsg(null);
    setLocating(true);
    try {
      const r = await approximateFix();
      if (!r.ok) {
        setGeoMsg(r.reason === 'denied' ? t('Location is off. Turn it on in your phone settings to use Near me.') : t('Could not find your location. Try again in a moment.'));
        return;
      }
      const here = await get<{ name: string; lat: number; lng: number } | null>(`/v1/places/reverse?${new URLSearchParams({ lat: String(r.lat), lng: String(r.lng) })}`).catch(() => null);
      if (!here) {
        setGeoMsg(t('Could not tell which city you are in. Try again in a moment.'));
        return;
      }
      const same = here.name.trim().toLowerCase() === city.trim().toLowerCase() || (cityCenterRef.current && kmBetween({ lat: cityCenterRef.current[0], lng: cityCenterRef.current[1] }, here) < 5);
      if (same) {
        setGeoMsg(t("You're in {city}.", { city }));
        if (cityCenterRef.current) setTarget({ lat: cityCenterRef.current[0], lng: cityCenterRef.current[1], zoom: 'city' });
        return;
      }
      setCity(here.name, { lat: here.lat, lng: here.lng });
      setTarget({ lat: here.lat, lng: here.lng, zoom: 'city' });
      setGeoMsg(t('Now showing {city}, where you are.', { city: here.name }));
    } finally {
      setLocating(false);
    }
  };
  // a "Near me" area saved by an older version (3 km around you) is dropped: Near me now picks the city you are in
  useEffect(() => {
    if (near) setNear(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** The map flies to a place picked in the map's search. */
  const flyTo = (at: Fix) => setTarget({ lat: at.lat, lng: at.lng, zoom: 'near' });
  /** A place picked in the search: the map flies there and shows the activities in and around it (3 km), with the search words if any. */
  const pickPlace = (at: Fix, name: string) => {
    setSelected(null);
    setArea({ lat: at.lat, lng: at.lng, name });
    flyTo(at);
  };
  /** Search words from the field ('' clears them). */
  const searchWords = (text: string) => {
    setSelected(null);
    setQuery(text.trim().replace(/\s+/g, ' ').slice(0, 40));
  };
  const clearSearch = () => {
    setQuery('');
    setArea(null);
    setSelected(null);
    const home = cityCenterRef.current;
    if (area && home) setTarget({ lat: home[0], lng: home[1], zoom: 'city' });
  };

  // Ask for the position (and the permission) again every time, so the person always decides; also used by Refresh.
  const measure = async () => {
    setDist({ status: 'locating' });
    const r = await approximateFix();
    setDist(r.ok ? { status: 'done', me: { lat: r.lat, lng: r.lng } } : { status: r.reason });
  };

  const nextDay = !searching && dayPick === null && days < MAX_DAYS ? new Date(new Date().setHours(0, 0, 0, 0) + days * 864e5) : null; // the day "Show the next day" would add (a search already covers the month)
  /** What the map asked the server for, as parameters the results page can ask again (no paging in it). */
  const searchQuery = () => {
    const o = Object.fromEntries(new URLSearchParams(lastSearch.current));
    delete o.limit;
    delete o.cursor;
    return { ...o, ...(area ? { place: area.name } : {}) } as Record<string, string>;
  };
  return { searchQuery, query, area, searching, hasMore: !!cursor, loadingMore, loadMore, pickPlace, searchWords, clearSearch, days, dayPick, setDayPick, showNextDay, nextDay, city, setCity, cityCenter, flyTo, cat, setCat, zoom, zoomCmd, near, setNear, geoMsg, locating, locate, dist, measure, selected, setSelected, activeId, feed, pins, groups, center, target, findingCity };
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
      hitSlop={4}
      style={({ pressed }) => [{ width: 46, height: 46, borderRadius: 23, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <Ionicons name={icon} size={22} color={c.text} />
    </Pressable>
  );
}

/** The big round button at the top right of the map (search, filters). */
function TopTool({ icon, label, onPress, on }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; on?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} onPress={onPress} hitSlop={4} style={({ pressed }) => [{ width: 58, height: 58, borderRadius: 29, backgroundColor: on ? c.forest : c.surface, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }, pressed && { transform: [{ scale: 0.94 }] }]}>
      <Ionicons name={icon} size={26} color={on ? '#fff' : c.text} />
    </Pressable>
  );
}

/** "Hi, Alex / Milan": your face, a greeting and the city; tapping it picks another city. */
function GreetingPill({ city, onPick, compact }: { city: string; onPick: (c: string, at?: Near) => void; /** just the round face (the map search is open beside it) */ compact?: boolean }) {
  const { t } = useT();
  const { c } = useTheme();
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const cityPos = useCityPos(); // places near the chosen city are listed first
  const name = me?.profile?.displayName?.split(' ')[0];
  // 0 = the full pill, 1 = just the face. The words fade out/in on the native side; the pill itself narrows and widens through the
  // system's layout animation (started by the map, together with the search field), so both move as one, off the JS thread.
  const v = useRef(new Animated.Value(compact ? 1 : 0)).current;
  useEffect(() => {
    // the words go quickly when the search opens (the pill is narrowing at the same moment), and come back a little slower
    Animated.timing(v, { toValue: compact ? 1 : 0, duration: compact ? 110 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [compact]); // eslint-disable-line react-hooks/exhaustive-deps
  // narrowed to a circle, the face sits exactly in the middle of it (58 wide); in the full pill it is 6 from the left edge
  const face = 46 * useScale();
  const faceLeft = compact ? Math.max(0, (58 - face) / 2) : 6;
  return (
    <>
      <View style={[{ flexShrink: 1, minHeight: 58, borderRadius: 32, backgroundColor: c.surface, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }, compact && { width: 58, flexShrink: 0 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('City: {city}. Change city', { city })} onPress={() => setOpen(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingLeft: faceLeft, overflow: 'hidden', borderRadius: 32 }}>
        <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={46} />
        <Animated.View style={{ flexShrink: 1, marginLeft: 12, paddingRight: 22, opacity: v.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }) }}>
          {name ? <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{t('Hi, {name}', { name })}</Text> : null}
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>{city}</Text>
        </Animated.View>
      </Pressable>
      </View>
      <Sheet visible={open} title={t('Choose your city')} onClose={() => setOpen(false)}>
        <CitySearch
          near={cityPos}
          onPick={(name, at) => {
            onPick(name, at);
            setOpen(false);
          }}
        />
      </Sheet>
    </>
  );
}

/**
 * The map's search: type a neighbourhood or area of the city shown, pick it, and the map flies there. Only places within the
 * city's area (CITY_AREA_KM of its centre) are offered, the same area the map and Home show.
 */
function MapSearchField({ city, centre, onPick, onWords, closing, onClose, onClosed, listMode, onListText }: { /** the card is pulled up: typing only narrows its list (no place search, the map stays put) */ listMode?: boolean; onListText?: (text: string) => void; city: string; centre: [number, number] | null; onPick: (at: Fix, name: string) => void; /** the words to find activities by (Enter, or the first row) */ onWords: (text: string) => void; /** set while it plays its closing animation */ closing: boolean; /** asks to close (the face grows back at once) */ onClose: () => void; /** the closing animation has finished */ onClosed: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; name: string; address: string; lat: number; lng: number }[] | null>(null);
  const [far, setFar] = useState(0); // how many results were left out for being outside the city's area
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const latest = useRef(0);
  // it slides in from the search button on the right, growing leftwards, and fades up (native driver: smooth on Android too)
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, { toValue: 1, duration: 300, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
  }, [grow]);
  // closing: the same movement backwards (shrinks to the right and fades), then it goes
  useEffect(() => {
    if (closing) Animated.timing(grow, { toValue: 0, duration: 240, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true }).start(() => onClosed());
  }, [closing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const text = q.trim();
    const mine = ++latest.current;
    if (listMode) {
      setFound(null);
      setState('idle');
      return;
    }
    if (text.length < 2) {
      setFound(null);
      setState('idle');
      return;
    }
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: text, kind: 'area', ...(centre ? { lat: String(centre[0]), lng: String(centre[1]) } : { city }) });
        const r = await get<{ items: { id: string; name: string; address: string; lat: number; lng: number }[] }>(`/v1/places/search?${params}`);
        if (mine !== latest.current) return;
        const inside = centre ? r.items.filter((x) => kmBetween({ lat: centre[0], lng: centre[1] }, x) <= CITY_AREA_KM) : r.items;
        setFar(r.items.length - inside.length);
        setFound(inside);
        setState('done');
      } catch {
        if (mine === latest.current) setState('error');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [q, listMode]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View style={{ flex: 1, opacity: grow.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0.9, 1] }), transform: [{ translateX: grow.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }] }}>
      <View style={{ height: 58, borderRadius: 29, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 6, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
        <Ionicons name="search-outline" size={20} color={c.muted} />
        <TextInput
          accessibilityLabel={t('Search a place or an activity')}
          autoFocus
          value={q}
          onChangeText={(v) => {
            setQ(v);
            onListText?.(v);
          }}
          placeholder={listMode ? t('Search these activities') : t('Place or activity in {city}', { city })}
          placeholderTextColor={c.placeholder}
          returnKeyType="search"
          onSubmitEditing={() => {
            if (listMode) return void Keyboard.dismiss(); // the list is already narrowed as you type
            // Enter: look for activities with these words (nothing is asked of the server while typing, only here)
            if (q.trim().length >= 2) {
              onWords(q);
              onClose();
            }
          }}
          autoCorrect={false}
          style={{ flex: 1, color: c.text, fontSize: 15, paddingVertical: 0 }}
        />
        {/* ✕ first clears what was typed; with the field empty it closes the search */}
        <Pressable accessibilityRole="button" accessibilityLabel={q ? t('Clear the search') : t('Close the search')} hitSlop={8} onPress={() => {
          if (q) {
            setQ('');
            onListText?.('');
            Keyboard.dismiss(); // clear search: the keyboard goes down
          } else onClose();
        }} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={20} color={c.text} />
        </Pressable>
      </View>
      {state !== 'idle' && !closing ? (
        <View style={{ position: 'absolute', top: 64, left: 0, right: -68, backgroundColor: c.surface, borderRadius: 20, paddingVertical: 6, elevation: 4, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
          {/* the words as an activity search: "coffee", "yoga", a venue's name; a category word finds that category */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Show activities for {words}', { words: q.trim() })}
            onPress={() => {
              onWords(q);
              onClose();
            }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 }, pressed && { backgroundColor: c.bg }]}
          >
            <Ionicons name="search-outline" size={18} color={c.forest} />
            <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: FS.body, fontWeight: '600' }}>{t('Activities for “{words}”', { words: q.trim() })}</Text>
          </Pressable>
          {state === 'searching' && !found ? <Text style={{ color: c.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 10 }}>{t('Searching…')}</Text> : null}
          {state === 'error' ? <Text style={{ color: c.muted, fontSize: 13, paddingHorizontal: 16, paddingVertical: 10 }}>{t('Search is not available right now. Try again in a moment.')}</Text> : null}
          {found?.map((x) => (
            <Pressable
              key={x.id}
              accessibilityRole="button"
              accessibilityLabel={x.address ? `${x.name}, ${x.address}` : x.name}
              onPress={() => {
                onPick({ lat: x.lat, lng: x.lng }, x.name);
                onClose();
              }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 }, pressed && { backgroundColor: c.bg }]}
            >
              <Ionicons name="location-outline" size={18} color={c.forest} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{x.name}</Text>
                {x.address ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{x.address}</Text> : null}
              </View>
            </Pressable>
          ))}
          {state === 'done' && found?.length === 0 ? (
            <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 10 }}>
              {far > 0 ? t('No place with that name within {km} km of {city}. Change the city to look further away.', { km: CITY_AREA_KM, city }) : t('No place found with that name.')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
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
      <Txt variant="h3" color={c.forest} numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, includeFontPadding: false }}>{title}</Txt>
    </Pressable>
  );
}

/**
 * Floating layer over the full-screen map, in the style of the design: a card with the city and a Map | List switch,
 * category chips under it, zoom and "Near me" buttons, and a bottom sheet. The sheet says how many activities there are;
 * pull it up (or tap its handle) to see them all, or tap a pin and it rises by itself with the activities at that pin.
 */
export function MapOverlay({ data }: { data: ReturnType<typeof useMapData> }) {
  const { t, tn } = useT();
  const go = useGo();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const dock = useDockSpace();
  const { height: screenH } = useWindowDimensions();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { city, setCity, cityCenter, cat, setCat, near, setNear, geoMsg, locating, locate, zoom, selected: selectedLive, activeId, feed, pins, dist, measure, days, dayPick, setDayPick, nextDay, showNextDay, query, area, searching, hasMore, loadingMore, loadMore, pickPlace, searchWords, clearSearch, searchQuery } = data;
  // tapping the map empty lowers the card: its pin's activities stay on it while it slides down (swapping to the full list at once made it flash)
  const [held, setHeld] = useState<typeof selectedLive>(null);
  useEffect(() => {
    if (selectedLive) return setHeld(selectedLive);
    const id = setTimeout(() => setHeld(null), 400);
    return () => clearTimeout(id);
  }, [selectedLive]);
  const selected = selectedLive ?? held;
  const nextLabel = nextDay ? nextDay.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) : '';
  // the button that adds a day: "Show tomorrow" while only today is loaded, then "Show Saturday, 14 Nov" and so on
  const nextTitle = nextDay ? (days === 1 ? t('Show tomorrow') : t('Show {day}', { day: nextLabel })) : '';
  const today0 = new Date(new Date().setHours(0, 0, 0, 0));
  const [calMonth, setCalMonth] = useState(today0); // the month the filter's calendar shows
  const [sheetH, setSheetH] = useState(0); // the bottom sheet's real height (grip, summary and list), so the buttons above it never sit on it
  const [search, setSearchNow] = useState<'closed' | 'open' | 'closing'>('closed');
  // the pill narrows/widens and the field makes room in ONE native layout animation, so nothing jumps and nothing runs on the JS thread
  const setSearch = (next: 'closed' | 'open' | 'closing') => {
    // opening: the same fast-start easing as the search field growing in (easeInEaseOut starts slowly, so the pill looked late);
    // closing: the field's own ease-in-out, shrinking back
    LayoutAnimation.configureNext({ duration: next === 'open' ? 260 : 240, update: { type: next === 'open' ? LayoutAnimation.Types.easeOut : LayoutAnimation.Types.easeInEaseOut } });
    setSearchNow(next);
  };

  // what the pulled-up list shows: the activities at the tapped pin, or every pin's, soonest first
  const [isOpen, setIsOpen] = useState(false);
  const [listQ, setListQ] = useState(''); // what is typed in the search bar while the card is pulled up: it only narrows that list
  const listMode = isOpen && !selected;
  useEffect(() => {
    if (search === 'closed' || !isOpen) setListQ('');
  }, [search, isOpen]);
  const allRows = selected ? selected.items : [...pins].sort((x, y) => +new Date(x.startsAt) - +new Date(y.startsAt));
  const needle = listMode ? listQ.trim().toLowerCase() : '';
  const rows = needle ? allRows.filter((a) => `${a.title} ${a.venueName} ${a.tags.join(' ')} ${CATS[a.category]?.label ?? a.category}`.toLowerCase().includes(needle)) : allRows;
  // a search with many answers: the card lists the first 5, and a button opens every one of them as a paged list
  const SEARCH_FIRST = 5;
  const listRows = !selected && searching ? rows.slice(0, SEARCH_FIRST) : rows;
  const showAll = !selected && searching && (rows.length > SEARCH_FIRST || hasMore);
  const ROW = 92; // one row and the gap under it
  // Pulled up, the card rises over the map as far as the search bar (it is not a new page: the map stays where it was underneath,
  // and pulling the card down shows the very same map again). So the list is as tall as the room between the bar and the card's top part.
  const [baseH, setBaseH] = useState(96); // the sheet without its list: handle + summary
  const topBarBottom = statusTop(insets.top) + 8 + 58 + 12;
  const fullMax = Math.max(160, Math.round(screenH - topBarBottom - baseH - dock));
  // a tapped pin shows a short card of just its activities; the card pulled up (or tapped open) goes the whole way to the bar
  const listMax = selected ? Math.min(fullMax, rows.length * ROW + 4) : fullMax;

  // 0 = just the summary, 1 = list showing. Driven by a finger (drag), a tap on the handle, or by tapping a pin.
  // The list always has its full height and the whole sheet slides (a transform), so the pull is drawn on the native
  // thread: a changing height would re-lay-out the page every frame, which is what made the sheet jerky on Android.
  const open = useRef(new Animated.Value(0)).current;
  const openAt = useRef(0); // where the sheet is heading or being held (0 closed .. 1 open), readable at any time
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
  // tapping a pin raises the sheet to its list; tapping the map empty lowers it again
  const key = selectedLive?.key ?? '';
  useEffect(() => {
    settle(key ? 1 : 0);
  }, [key, settle]);
  // a search that has just been confirmed (Enter, a result row, a place): once its results are in, the list rises by itself;
  // clearing the search lowers it again. Only once per search, so pulling the list down afterwards is respected.
  const searchSig = searching ? `${query}|${area?.lat},${area?.lng}` : '';
  const openedFor = useRef('');
  useEffect(() => {
    if (!searchSig) {
      if (openedFor.current) settle(0);
      openedFor.current = '';
      return;
    }
    if (feed.data && openedFor.current !== searchSig) {
      openedFor.current = searchSig;
      settle(1);
    }
  }, [searchSig, feed.data, settle]);
  // The grip and the summary under it are the part you drag. Taps go to what is inside; only a clearly vertical drag is taken over.
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

  const todayCount = pins.filter((a) => new Date(a.startsAt).toDateString() === new Date().toDateString()).length;
  const count = pins.length; // every activity on the map, whichever day (the card used to count only today's, so it said 1 with more in the list)
  const nextStart = pins.length ? pins.reduce((m, a) => (a.startsAt < m ? a.startsAt : m), pins[0].startsAt) : null;
  const noteText =
    dist.status === 'locating'
      ? t('Finding your approximate location…')
      : dist.status === 'done'
        ? t('Distances are approximate.')
        : dist.status === 'denied'
          ? t('Location is off. Allow it in settings.')
          : dist.status === 'error'
            ? t('No location. Try again.')
            : t('Your location is only used when you tap, and is never saved or shared.');

  // closing the filter with something chosen (a kind of activity, a day): the activities card rises to show the results, once the
  // filter sheet has slid away
  const closeFilters = () => {
    setFiltersOpen(false);
    if (cat !== '' || dayPick !== null) setTimeout(() => settle(1), 260);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* top: your greeting and the city on the left, search and filters on the right; the category chips open under the filter button */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: statusTop(insets.top) + 8, left: 16, right: 16, gap: 10, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <GreetingPill city={city} onPick={setCity} compact={search === 'open'} />
          {search !== 'closed' ? <MapSearchField listMode={listMode} onListText={setListQ} city={city} centre={cityCenter} closing={search === 'closing'} onClose={() => setSearch('closing')} onClosed={() => setSearch('closed')} onPick={pickPlace} onWords={searchWords} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* search: a field opens here, from your face to the filter button, to find a neighbourhood of this city on the map */}
            {search !== 'closed' ? null : <TopTool icon="search-outline" label={t('Search a place or an activity')} on={searching} onPress={() => setSearch('open')} />}
            <TopTool icon="options-outline" label={cat || dayPick !== null ? t('Filters, on') : t('Filters')} on={cat !== '' || dayPick !== null} onPress={() => setFiltersOpen(true)} />
          </View>
        </View>
        {/* what is being searched for: the words and/or the place, with ✕ to go back to today and tomorrow */}
        {searching ? (
          <View style={{ width: '100%', maxWidth: 560, flexDirection: 'row' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Clear the search: {what}', { what: [query, area?.name].filter(Boolean).join(', ') })} onPress={clearSearch} style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingLeft: 14, paddingRight: 10, borderRadius: 19, backgroundColor: c.forest }}>
              <Text numberOfLines={1} style={{ flexShrink: 1, color: '#fff', fontSize: FS.button, fontWeight: '500' }}>{[query && `“${query}”`, area?.name].filter(Boolean).join(' · ')}</Text>
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
          </View>
        ) : null}
        {geoMsg ? <View style={{ width: '100%', maxWidth: 560 }}><Banner>{geoMsg}</Banner></View> : null}
        {feed.error ? <View style={{ width: '100%', maxWidth: 560 }}><ErrorBanner message={feed.error.message} /></View> : null}
        <MapHint id="here" title={t('Finding activities')}>{t('Tap a pin to see what is on there. Use + and − or pinch to move around, search for a place or an activity, and open the filter to pick a day or a kind.')}</MapHint>
      </View>

      {/* tools: "Near me" bottom left, zoom bottom right; they ride up with the sheet */}
      <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: (sheetH > 0 ? sheetH : baseH + dock + listMax) + 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', opacity: open.interpolate({ inputRange: [0, 0.35], outputRange: [1, 0], extrapolate: 'clamp' }), transform: [{ translateY: sheetY }] }}>
        <PillButton icon="locate-outline" title={locating ? t('Finding you…') : t('Near me')} onPress={locate} disabled={locating} />
        <View style={{ gap: 8 }}>
          <RoundTool icon="add" label={t('Zoom in')} onPress={() => zoom(1)} />
          <RoundTool icon="remove" label={t('Zoom out')} onPress={() => zoom(-1)} />
        </View>
      </Animated.View>

      {/* bottom sheet */}
      <Animated.View onLayout={(e) => setSheetH(Math.round(e.nativeEvent.layout.height))} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', backgroundColor: c.bg, borderTopLeftRadius: 40, borderTopRightRadius: 40, paddingBottom: 12 + dock, // runs down behind the dock, so no strip of map shows between them
         paddingHorizontal: 20, elevation: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -3 }, transform: [{ translateY: sheetY }] }}>
        <View {...pan.panHandlers} onLayout={(e) => setBaseH(e.nativeEvent.layout.height + 12)} style={{ width: '100%', alignItems: 'center' }}>
          {/* the grip and the summary are the part you drag; tapping the grip opens or closes the list */}
          <Pressable accessibilityRole="adjustable" accessibilityLabel={t('Activities list. Swipe up to open, down to close')} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={(e) => settle(e.nativeEvent.actionName === 'increment' ? 1 : 0)} onPress={() => settle(openAt.current > 0.5 ? 0 : 1)} hitSlop={{ top: 6, bottom: 6 }} style={{ width: '100%', alignItems: 'center', paddingTop: 8, paddingBottom: 14 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.line }} />
          </Pressable>
          <View style={{ width: '100%', maxWidth: 560, gap: 8 }}>
            {selected ? (
              <>
                <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                  <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '600', flex: 1 }}>
                    {tn(selected.items.length, '{n} activity here', '{n} activities here')}
                  </Text>
                </Row>
                <Row style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Ionicons name="lock-closed-outline" size={13} color={c.muted} style={{ marginTop: 2 }} />
                  <Txt variant="small" style={{ flex: 1 }}>{noteText}</Txt>
                </Row>
              </>
            ) : feed.data && pins.length === 0 ? (
              <>
                <Row style={{ justifyContent: 'space-between', gap: 10 }}>
                  <Txt style={{ flex: 1 }}>{searching ? t('Nothing found in the next month. Try other words or another place.') : dayPick !== null ? t('No venues on the map for this day.') : days <= 1 ? t('No venues on the map for today.') : t('No venues on the map for these days yet.')}</Txt>
                  {searching ? <Btn title={t('Clear')} small variant="secondary" onPress={clearSearch} /> : <Btn title={t('Create')} small onPress={() => go('/create')} />}
                </Row>
                {nextDay ? <Btn title={nextTitle} variant="secondary" onPress={showNextDay} /> : null}
              </>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel={openAt.current > 0.5 ? t('Hide the list') : t('Show all activities')} onPress={() => settle(openAt.current > 0.5 ? 0 : 1)}>
                <Row style={{ justifyContent: 'space-between', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '600' }}>
                      {feed.data ? (searching ? tn(pins.length, hasMore ? '{n}+ activity found' : '{n} activity found', hasMore ? '{n}+ activities found' : '{n} activities found') : todayCount === count && count > 0 ? tn(count, '{n} activity today', '{n} activities today') : tn(count, '{n} activity coming up', '{n} activities coming up')) : t('Loading…')}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 15, lineHeight: 22, marginTop: 4 }}>{t('Tap a pin to preview, or pull up for the list')}</Text>
                  </View>
                  {nextStart ? (
                    <View style={{ backgroundColor: c.sand, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start', flexShrink: 0 }}>
                      <Text style={{ color: c.forest, fontSize: 13, lineHeight: 17, fontWeight: '500', includeFontPadding: false }}>{t('Next in {time}', { time: untilStart(nextStart) })}</Text>
                    </View>
                  ) : null}
                </Row>
              </Pressable>
            )}
          </View>
        </View>

        {/* the list: its height follows the pull, rows ease in one after another each time the list changes */}
        <Animated.View pointerEvents={isOpen ? 'auto' : 'none'} style={{ width: '100%', maxWidth: 560, height: listMax, overflow: 'hidden', opacity: open.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.6, 1] }) }}>
          <ScrollView
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps={keyboardTaps}
            scrollEventThrottle={100}
            // a search comes a page of 20 at a time: the next page is asked for when the end of the list is near
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              if (!selected && !searching && hasMore && contentOffset.y + layoutMeasurement.height > contentSize.height - 240) void loadMore();
            }}
          >
            {listRows.map((a, i) => (
              <Reveal key={`${key}:${a.id}`} index={i}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('{title}, {when}, {n} spaces. Open activity', { title: a.title, when: when(a.startsAt), n: a.spotsLeft })}
                  onPress={() => go(`/activity/${a.id}`)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 10, borderRadius: 26, borderWidth: 1, borderColor: activeId === a.id ? c.forest : c.line, backgroundColor: c.surface }, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
                >
                  <CatPhoto category={a.category} style={{ width: 64, height: 64, borderRadius: 18 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{a.title}</Text>
                    <Row style={{ gap: 6 }}>
                      <Ionicons name="location-outline" size={14} color={c.muted} />
                      <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 18, flexShrink: 1 }}>{a.venueName}</Text>
                      <Text style={{ color: '#2E7D32', fontSize: 13, lineHeight: 18, fontWeight: '500' }}>{t(CATS[a.category]?.label ?? a.category)}</Text>
                    </Row>
                    <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>
                      {when(a.startsAt)} · {t('{going}/{capacity} going · {left} left', { going: a.going, capacity: a.capacity, left: a.spotsLeft })}{dist.me ? t(' · {km} away', { km: fmtKm(kmBetween(dist.me, { lat: a.lat, lng: a.lng })) }) : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={c.muted} />
                </Pressable>
              </Reveal>
            ))}
            {/* by day: today and tomorrow are loaded first; this brings in the next day's activities (and pins) */}
            {!selected && nextDay ? <Btn title={nextTitle} variant="secondary" onPress={showNextDay} /> : null}
            {showAll ? <Btn title={t('Show all results')} variant="secondary" onPress={() => go(`/search-results?${new URLSearchParams(searchQuery()).toString()}`)} /> : null}
          </ScrollView>
        </Animated.View>
      </Animated.View>

      {/* the filters open as a page of their own, the same sheet as THERE's: what kind of activity, and which day */}
      <ThereFilterSheet
        compact
        visible={filtersOpen}
        onClose={closeFilters}
        footer={
          <>
            <Btn title={t('Show results')} onPress={closeFilters} />
            <Btn
              title={t('Clear all')}
              variant="secondary"
              onPress={() => {
                setCat('');
                setDayPick(null);
              }}
            />
          </>
        }
      >
        <View style={{ gap: 8 }}>
          <ThereLabel compact>{t('What kind of activity')}</ThereLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <ThereChip compact label={t('All')} active={cat === ''} onPress={() => setCat('')} />
            {Object.entries(CATS).map(([k, v]) => (
              <ThereChip compact key={k} label={t(v.label)} active={cat === k} onPress={() => setCat(k)} />
            ))}
          </View>
        </View>
        {/* day by day: one chosen day at a time (a search covers the month and has no day) */}
        {searching ? null : (
          <View style={{ gap: 8 }}>
            <ThereLabel compact>{t('Which day')}</ThereLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <ThereChip compact label={t('All days')} active={dayPick === null} onPress={() => setDayPick(null)} />
            </View>
            <MonthCalendar
              month={calMonth}
              onMonth={setCalMonth}
              selected={dayPick === null ? new Date(0) : new Date(today0.getTime() + dayPick * 864e5)}
              min={today0}
              max={new Date(today0.getTime() + 365 * 864e5)}
              onPick={(d) => setDayPick(Math.round((new Date(d).setHours(0, 0, 0, 0) - today0.getTime()) / 864e5))}
            />
          </View>
        )}
      </ThereFilterSheet>
    </View>
  );
}

export const s = StyleSheet.create({
  floatBar: { width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  bottomCard: { width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 18, padding: 10, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  badge: { position: 'absolute', top: 1, right: 1, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#0F2F28', borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pin: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
