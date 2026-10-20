import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { HeaderBar, TabHeader } from '@/components/TabHeader';
import { Empty } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { MapOverlay, PinIcon, useMapData } from './mapShared';

/**
 * HERE · Map: one full-screen map showing only activity icons (public venues, never people).
 * Tap an icon for its card, "List ↗" for the full list. Location is asked only when "Near me" is tapped.
 */
export function MapHere() {
  const { c } = useTheme();
  const data = useMapData();
  const { center, groups, selected, setSelected, target } = data;
  const map = useRef<MapView>(null);

  useEffect(() => {
    if (target) map.current?.animateToRegion({ latitude: target.lat, longitude: target.lng, latitudeDelta: target.zoom === 'venue' ? 0.012 : 0.05, longitudeDelta: target.zoom === 'venue' ? 0.012 : 0.05 }, 450);
  }, [target]);

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
        onPress={() => setSelected(null)}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        accessibilityLabel="Map of activity venues"
      >
        {groups.map((g) => (
          <Marker key={g.key} coordinate={{ latitude: g.lat, longitude: g.lng }} title={g.items.length > 1 ? `${g.items.length} activities` : g.items[0].title} tracksViewChanges={false} onPress={() => setSelected(g)}>
            <PinIcon category={g.items[0].category} full={g.items.every((a) => a.spotsLeft === 0)} active={selected?.key === g.key} count={g.items.length} />
          </Marker>
        ))}
      </MapView>
      <MapOverlay data={data} />
      </View>
    </View>
  );
}
