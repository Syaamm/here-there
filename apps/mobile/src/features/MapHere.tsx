import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { HeaderBar, TabHeader } from '@/components/TabHeader';
import { Empty } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { PinIcon } from './PinIcon';
import { MapOverlay, useMapData } from './mapShared';

/** A light, flat base map (Google Maps styling, so Android; Apple Maps on iOS keeps its own look). */
const GREY_MAP = [
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde6ea' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e4ecdf' }] },
];

/**
 * HERE · Map: one full-screen map showing only activity icons (public venues, never people).
 * Tap an icon for its card, "List ↗" for the full list. Location is asked only when "Near me" is tapped.
 */
export function MapHere() {
  const { c } = useTheme();
  const data = useMapData();
  const { center, groups, selected, setSelected, target, zoomCmd } = data;
  const map = useRef<MapView>(null);
  // keep redrawing the pins for a moment after the selection changes, so the green fill can play
  const [trackUntil, setTrackUntil] = useState(0);
  useEffect(() => {
    setTrackUntil(Date.now() + 900);
    const t = setTimeout(() => setTrackUntil(0), 950);
    return () => clearTimeout(t);
  }, [selected?.key]);
  const region = useRef<Region | null>(null); // where the map is now, so the zoom buttons can halve or double the view

  useEffect(() => {
    if (target) map.current?.animateToRegion({ latitude: target.lat, longitude: target.lng, latitudeDelta: target.zoom === 'venue' ? 0.012 : target.zoom === 'near' ? 0.05 : 0.08, longitudeDelta: target.zoom === 'venue' ? 0.012 : target.zoom === 'near' ? 0.05 : 0.08 }, 450);
  }, [target]);

  useEffect(() => {
    if (!zoomCmd || !region.current) return;
    const f = zoomCmd.d > 0 ? 0.5 : 2;
    const r = region.current;
    map.current?.animateToRegion({ ...r, latitudeDelta: r.latitudeDelta * f, longitudeDelta: r.longitudeDelta * f }, 250);
  }, [zoomCmd]);

  if (!center)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center' }}>
        <Empty title="No map for this city yet">We only have map data for Milan in this pilot. You can still browse the list.</Empty>
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <HeaderBar>
        <TabHeader compact />
      </HeaderBar>
      <View style={{ flex: 1 }}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: center[0], longitude: center[1], latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        customMapStyle={GREY_MAP}
        onPress={() => setSelected(null)}
        onRegionChangeComplete={(r) => (region.current = r)}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        accessibilityLabel="Map of activity venues"
      >
        {groups.map((g) => (
          <Marker key={g.key} anchor={{ x: 0.5, y: 1 }} coordinate={{ latitude: g.lat, longitude: g.lng }} title={g.items.length > 1 ? `${g.items.length} activities` : g.items[0].title} tracksViewChanges={selected?.key === g.key || trackUntil > Date.now()} onPress={() => setSelected(g)}>
            <PinIcon category={g.items[0].category} full={g.items.every((a) => a.spotsLeft === 0)} active={selected?.key === g.key} count={g.items.length} />
          </Marker>
        ))}
      </MapView>
      <MapOverlay data={data} />
      </View>
    </View>
  );
}
