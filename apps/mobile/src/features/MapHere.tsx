import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, type Region } from 'react-native-maps';
import { HeaderBar, TabHeader } from '@/components/TabHeader';
import { Empty } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { PinIcon } from './PinIcon';
import { MapOverlay, useMapData, type Group } from './mapShared';

/** A light, flat base map (Google Maps styling, so Android; Apple Maps on iOS keeps its own look). */
const GREY_MAP = [
  { elementType: 'geometry', stylers: [{ color: '#f2f2f2' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b6b6b' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dde6ea' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e4ecdf' }] },
];

// TEMPORARY: development-only counters, to find out what redraws when the sheet is closed. Remove once found.
const dbg = { map: 0, pins: 0, loads: 0 };
function DebugCounts() {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 300);
    return () => clearInterval(t);
  }, []);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 118, left: 12, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={{ color: '#fff', fontSize: 11 }}>map renders {dbg.map} · pin renders {dbg.pins} · data loads {dbg.loads}</Text>
    </View>
  );
}

/**
 * One pin. It is redrawn (the green fill playing) only when ITS OWN selection changes, for just long enough for the
 * change to show, and then goes back to being a still picture. Selecting or deselecting one pin never touches the others.
 */
const MapPin = memo(function MapPin({ g, active, onSelect }: { g: Group; active: boolean; onSelect: (g: Group) => void }) {
  if (__DEV__) dbg.pins++;
  const [track, setTrack] = useState(true); // drawn live while it first appears, and again for a moment after it is (de)selected
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 950);
    return () => clearTimeout(t);
  }, [active]);
  const coordinate = useMemo(() => ({ latitude: g.lat, longitude: g.lng }), [g.lat, g.lng]);
  return (
    <Marker anchor={{ x: 0.5, y: 1 }} coordinate={coordinate} title={g.items.length > 1 ? `${g.items.length} activities` : g.items[0].title} tracksViewChanges={track} onPress={() => onSelect(g)}>
      <PinIcon category={g.items[0].category} full={g.items.every((a) => a.spotsLeft === 0)} active={active} count={g.items.length} />
    </Marker>
  );
});

/**
 * HERE · Map: one full-screen map showing only activity icons (public venues, never people).
 * Tap an icon for its card, "List ↗" for the full list. Location is asked only when "Near me" is tapped.
 */
export function MapHere() {
  const { c } = useTheme();
  const data = useMapData();
  const { center, groups, selected, setSelected, target, zoomCmd } = data;
  const map = useRef<MapView>(null);
  if (__DEV__) dbg.map++;
  useEffect(() => {
    if (__DEV__) dbg.loads++;
  }, [data.feed.data]);
  // a pin taps through this one stable function, so the pins themselves never need to be rebuilt
  const pick = useRef(setSelected);
  pick.current = setSelected;
  const onSelect = useCallback((g: Group) => pick.current(g), []);
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
          <MapPin key={g.key} g={g} active={selected?.key === g.key} onSelect={onSelect} />
        ))}
      </MapView>
      <MapOverlay data={data} />
      {__DEV__ ? <DebugCounts /> : null}
      </View>
    </View>
  );
}
