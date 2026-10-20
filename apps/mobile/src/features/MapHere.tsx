import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityCard } from '@/components/Cards';
import { CityPicker } from '@/components/CityPicker';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Between, Btn, Card, Empty, ErrorBanner, Grid, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { catColor, CATS, CITY_CENTERS } from '@/lib/constants';
import { when } from '@/lib/format';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

/**
 * HERE · Map: public venues only. Never people. Location is requested only when "Near me" is tapped.
 * Phones stack the map above the list. Tablets and wide screens put them side by side.
 */
export function MapHere() {
  const go = useGo();
  const { c } = useTheme();
  const { isWide } = useLayout();
  const [city, setCity] = useCity();
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [showList, setShowList] = useState(false);
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);

  const feed = useLoad(
    () => {
      const now = new Date();
      const p = new URLSearchParams({ city, from: now.toISOString(), to: new Date(+now + 24 * 3600e3).toISOString(), limit: '50' });
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
  const { refreshing, onRefresh } = useRefresh(feed.reload);

  const items = feed.data?.items ?? [];
  const pins = items.filter((a) => a.lat != null && a.lng != null);
  const center = near ? ([near.lat, near.lng] as [number, number]) : (CITY_CENTERS[city.toLowerCase()] ?? (pins[0] ? ([pins[0].lat!, pins[0].lng!] as [number, number]) : null));

  const locate = async () => {
    setGeoMsg(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setGeoMsg('Location permission is off, so we are showing the whole city. You can allow it in your device settings.');
        return;
      }
      // Approximate only: low accuracy, rounded to ~1 km, used for this query and never stored.
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const lat = Math.round(pos.coords.latitude * 100) / 100;
      const lng = Math.round(pos.coords.longitude * 100) / 100;
      setNear({ lat, lng });
      map.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 400);
    } catch {
      setGeoMsg('We could not get your location. Showing the whole city instead.');
    } finally {
      setLocating(false);
    }
  };

  const mapNode = !center ? (
    <Empty title="No map for this city yet">We only have map data for Milan in this pilot. You can still browse the list.</Empty>
  ) : (
    <View style={[s.mapWrap, { borderColor: c.line }, isWide && { height: 600 }]}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: center[0], longitude: center[1], latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        onPress={() => setSelected(null)}
        accessibilityLabel="Map of activity venues"
      >
        {pins.map((a) => (
          <Marker key={a.id} coordinate={{ latitude: a.lat!, longitude: a.lng! }} title={a.title} tracksViewChanges={false} onPress={() => setSelected(a)}>
            <View style={[s.pin, { borderColor: a.spotsLeft === 0 ? '#999' : c.green }, selected?.id === a.id && { backgroundColor: c.forest, borderColor: '#fff' }]}>
              <Text style={{ fontSize: 18 }}>{CATS[a.category]?.emoji ?? '📍'}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
      {selected && (
        <Pressable accessibilityRole="button" onPress={() => go(`/activity/${selected.id}`)} style={[s.callout, { backgroundColor: c.surface }]}>
          <Txt variant="h3">{selected.title}</Txt>
          <Txt variant="small">{when(selected.startsAt)} · {selected.venueName}</Txt>
          <Txt variant="small">{selected.going}/{selected.capacity} confirmed · {selected.spotsLeft} spaces</Txt>
        </Pressable>
      )}
    </View>
  );

  const listNode = (
    <>
      <Txt variant="h2">In the next 24 hours</Txt>
      {feed.loading && !feed.data && <Spinner />}
      {feed.data && items.length === 0 && (
        <Card>
          <Txt variant="h3">Nothing on the map</Txt>
          <Row>
            <Btn title="Create an activity" small onPress={() => go('/create')} />
          </Row>
        </Card>
      )}
      {isWide ? (
        <View style={{ gap: 12 }}>
          {items.map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
        </View>
      ) : (
        <Grid>
          {items.map((a) => (
            <ActivityCard key={a.id} a={a} />
          ))}
        </Grid>
      )}
    </>
  );

  // Phones: the map fills the screen, with a floating city pill on top and a card for the selected venue below.
  if (!isWide && !showList && center) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={{ latitude: center[0], longitude: center[1], latitudeDelta: 0.08, longitudeDelta: 0.08 }}
          onPress={() => setSelected(null)}
          accessibilityLabel="Map of activity venues"
        >
          {pins.map((a) => (
            <Marker key={a.id} coordinate={{ latitude: a.lat!, longitude: a.lng! }} title={a.title} tracksViewChanges={false} onPress={() => setSelected(a)}>
              <View style={[s.pin, { borderColor: a.spotsLeft === 0 ? '#999' : c.green }, selected?.id === a.id && { backgroundColor: c.forest, borderColor: '#fff' }]}>
                <Text style={{ fontSize: 18 }}>{CATS[a.category]?.emoji ?? '📍'}</Text>
              </View>
            </Marker>
          ))}
        </MapView>

        <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 12, gap: 8 }}>
          <View style={[s.floatBar, { backgroundColor: c.surface, borderColor: c.line }]}>
            <CityPicker city={city} onPick={setCity} />
            <Row style={{ gap: 8 }}>
              {near ? <Btn title="Whole city" small variant="secondary" onPress={() => setNear(null)} /> : <Btn title="Near me" small variant="secondary" onPress={locate} loading={locating} />}
              <Btn title="List" small onPress={() => setShowList(true)} />
            </Row>
          </View>
          {geoMsg ? <Banner>{geoMsg}</Banner> : null}
          {feed.error ? <ErrorBanner message={feed.error.message} /> : null}
        </View>

        {selected ? (
          <Pressable accessibilityRole="button" onPress={() => go(`/activity/${selected.id}`)} style={[s.bottomCard, { backgroundColor: c.surface, borderColor: c.line }]}>
            <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: catColor(selected.category), alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 26, opacity: 0.55 }}>{CATS[selected.category]?.emoji ?? '📍'}</Text>
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 18 }}>{selected.title}</Txt>
              <Txt variant="muted">{when(selected.startsAt)}{selected.distanceKm !== undefined ? ` · ${selected.distanceKm} km` : ''}</Txt>
              <Txt variant="muted">{selected.going}/{selected.capacity} confirmed · {selected.spotsLeft} {selected.spotsLeft === 1 ? 'space' : 'spaces'}</Txt>
            </View>
            <Btn title="Join" small onPress={() => go(`/activity/${selected.id}`)} />
          </Pressable>
        ) : feed.data && pins.length === 0 ? (
          <View style={[s.bottomCard, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Txt style={{ flex: 1 }}>No venues on the map for the next 24 hours.</Txt>
            <Btn title="Create" small onPress={() => go('/create')} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <TabHeader />
      <Between>
        <CityPicker city={city} onPick={setCity} />
        <Row style={{ gap: 8 }}>
          {near ? <Btn title="Whole city" small variant="secondary" onPress={() => setNear(null)} /> : <Btn title="📍 Near me" small variant="secondary" onPress={locate} loading={locating} />}
          {!isWide && showList && <Btn title="Map" small onPress={() => setShowList(false)} />}
        </Row>
      </Between>
      {near && <Txt variant="small">Using your approximate area (about 1 km) to find nearby venues. It is not saved or shared.</Txt>}
      {geoMsg && <Banner>{geoMsg}</Banner>}
      <ErrorBanner message={feed.error?.message} />

      {isWide ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 20 }}>
          <View style={{ flex: 3 }}>{mapNode}</View>
          <View style={{ flex: 2, gap: 12 }}>{listNode}</View>
        </View>
      ) : (
        <>
          {mapNode}
          {listNode}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  floatBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14, elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  bottomCard: { position: 'absolute', left: 12, right: 12, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 22, padding: 12, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  mapWrap: { height: 320, borderRadius: 16, overflow: 'hidden', borderWidth: 1 },
  pin: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#fff', borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  callout: { position: 'absolute', left: 10, right: 10, bottom: 10, borderRadius: 14, padding: 12, gap: 2, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
});
