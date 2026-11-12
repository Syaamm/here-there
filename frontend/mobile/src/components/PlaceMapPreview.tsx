import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

/**
 * A small piece of map under the place search in the create forms: it shows where the picked place is (a pin), or the city
 * until one is picked. Only a preview: it cannot be moved or zoomed by a finger, so it never fights the page's own scroll.
 */
export function PlaceMapPreview({ at, picked }: { at: { lat: number; lng: number } | null; /** a place is picked: zoom in on it; otherwise the whole area of the city */ picked: boolean }) {
  const { c } = useTheme();
  const map = useRef<MapView>(null);
  const delta = picked ? 0.012 : 0.06;
  // moves to a newly picked place (the map itself is built once)
  useEffect(() => {
    if (at) map.current?.animateToRegion({ latitude: at.lat, longitude: at.lng, latitudeDelta: delta, longitudeDelta: delta }, 350);
  }, [at?.lat, at?.lng, picked]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ height: sc(170), borderRadius: sc(28), overflow: 'hidden', backgroundColor: c.sand }}>
      {at ? (
        <MapView
          ref={map}
          style={{ flex: 1 }}
          initialRegion={{ latitude: at.lat, longitude: at.lng, latitudeDelta: delta, longitudeDelta: delta }}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsPointsOfInterests={false}
          pointerEvents="none"
        >
          {picked ? <Marker coordinate={{ latitude: at.lat, longitude: at.lng }} /> : null}
        </MapView>
      ) : null}
    </View>
  );
}
