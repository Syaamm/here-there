import L from 'leaflet';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { HeaderBar, TabHeader } from '@/components/TabHeader';
import { Btn, Empty } from '@/components/ui';
import { CATS } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { MapOverlay, useMapData, type Group } from './mapShared';

const CSS_ID = 'leaflet-css';
/** Leaflet's own stylesheet, added once (the app is bundled by Metro, which has no CSS import for packages here). */
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID;
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
  // soften the tiles towards the app's pale green-grey look, so the icons are what stand out
  const style = document.createElement('style');
  style.textContent = '.leaflet-tile-pane{filter:grayscale(.55) saturate(.7) brightness(1.06) contrast(.92)}';
  document.head.appendChild(style);
}

const icon = (g: Group, active: boolean, green: string, forest: string) => {
  const full = g.items.every((a) => a.spotsLeft === 0);
  const badge = g.items.length > 1 ? `<div style="position:absolute;top:1px;right:1px;min-width:18px;height:18px;border-radius:9px;padding:0 4px;box-sizing:border-box;background:#0F2F28;border:1.5px solid #fff;color:#fff;font:800 10px/15px sans-serif;text-align:center">${g.items.length}</div>` : '';
  return L.divIcon({
    className: '',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    html: `<div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer"><div style="width:36px;height:36px;border-radius:18px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:17px;background:${active ? forest : '#fff'};border:3px solid ${active ? '#fff' : full ? '#999' : green};box-shadow:0 2px 6px rgba(0,0,0,.25)">${CATS[g.items[0].category]?.emoji ?? '📍'}</div>${badge}</div>`,
  });
};

/**
 * Browser version of the map: the same full-screen, icons-only map, drawn with Leaflet and light OpenStreetMap-based
 * tiles, since react-native-maps only exists on iOS and Android.
 */
export function MapHere() {
  const { c } = useTheme();
  const data = useMapData();
  const { center, groups, selected, setSelected, target } = data;
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [broken, setBroken] = useState(false);
  const focused = useIsFocused();
  const pick = useRef(setSelected);
  pick.current = setSelected;

  // create the map once the container exists
  useEffect(() => {
    if (!box.current || !center || map.current || broken) return;
    ensureCss();
    let m: L.Map;
    try {
      m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView(center, 13);
    } catch {
      setBroken(true);
      return;
    }
    // no tile ever loaded (offline or blocked) after several attempts: show the designed unavailable state
    let loaded = 0;
    let failed = 0;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    })
      .on('tileload', () => loaded++)
      .on('tileerror', () => {
        if (++failed >= 4 && loaded === 0) setBroken(true);
      })
      .addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('click', () => pick.current(null));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!center, broken]);

  // draw the activity icons whenever they or the selection change
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const gr of groups) {
      L.marker([gr.lat, gr.lng], { icon: icon(gr, selected?.key === gr.key, c.green, c.forest), title: gr.items.length > 1 ? `${gr.items.length} activities` : gr.items[0].title, keyboard: true })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          pick.current(gr);
        })
        .addTo(g);
    }
  }, [groups, selected, c.green, c.forest]);

  // a map that was hidden while another tab was open must re-measure itself, or its tiles are drawn offset
  useEffect(() => {
    if (!focused) return;
    const t = setTimeout(() => map.current?.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [focused]);

  useEffect(() => {
    if (target) map.current?.flyTo([target.lat, target.lng], target.zoom === 'venue' ? 16 : 14, { duration: 0.6 });
  }, [target]);

  if (broken)
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, padding: 24, justifyContent: 'center', gap: 12 }}>
        <Empty title="Map unavailable">We could not load the map. Check your connection, then try again. The list still works.</Empty>
        <Btn title="Try again" onPress={() => setBroken(false)} />
      </View>
    );

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
      <div ref={box} role="application" aria-label="Map of activity venues" style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      <MapOverlay data={data} />
      </View>
    </View>
  );
}
