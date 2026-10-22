import L from 'leaflet';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { HeaderBar, TabHeader } from '@/components/TabHeader';
import { Btn, Empty } from '@/components/ui';
import { CATS } from '@/lib/constants';
import { useTheme } from '@/lib/theme';
import { MapOverlay, PIN_PATH, pinWidth, useMapData, type Group } from './mapShared';

const CSS_ID = 'leaflet-css';
/** Leaflet's own stylesheet, added once (the app is bundled by Metro, which has no CSS import for packages here). */
function ensureCss() {
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID;
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
  // a light, flat, grey base map: the colour drained from the tiles so the pins are what stand out
  const style = document.createElement('style');
  style.textContent = '.leaflet-tile-pane{filter:grayscale(1) brightness(1.07) contrast(.88)}';
  document.head.appendChild(style);
}

/** The same pin as PinIcon: red teardrop; the selected one fills green from the bottom up. A badge shows the count. */
const icon = (g: Group, active: boolean, green: string, forest: string) => {
  const full = g.items.every((a) => a.spotsLeft === 0);
  const count = g.items.length;
  const w = pinWidth(count);
  const id = 'pin' + Math.random().toString(36).slice(2);
  const grow = active ? '<animate attributeName="y" from="24" to="0" dur=".35s" fill="freeze"/><animate attributeName="height" from="0" to="24" dur=".35s" fill="freeze"/>' : '';
  return L.divIcon({
    className: '',
    iconSize: [w, w],
    iconAnchor: [w / 2, w - 1],
    html: `<div style="position:relative;width:${w}px;height:${w}px;cursor:pointer;filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))"><svg width="${w}" height="${w}" viewBox="0 0 24 24"><defs><clipPath id="${id}"><rect x="0" width="24" y="${active ? 0 : 24}" height="${active ? 24 : 0}">${grow}</rect></clipPath></defs><path d="${PIN_PATH}" fill="${full ? '#9A9A9A' : '#D32F2F'}"/><path d="${PIN_PATH}" fill="${green}" clip-path="url(#${id})"/><circle cx="12" cy="9.8" r="3.2" fill="#fff"/></svg><div style="position:absolute;top:-2px;right:-6px;min-width:18px;height:18px;border-radius:9px;padding:0 4px;box-sizing:border-box;background:${forest};border:1.5px solid #fff;color:#fff;font:800 10px/15px sans-serif;text-align:center">${count}</div></div>`,
  });
};

/**
 * Browser version of the map: the same full-screen, icons-only map, drawn with Leaflet and light OpenStreetMap-based
 * tiles, since react-native-maps only exists on iOS and Android.
 */
export function MapHere() {
  const { c } = useTheme();
  const data = useMapData();
  const { center, groups, selected, setSelected, target, zoomCmd } = data;
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
    // OpenStreetMap tiles (no key needed), softened to a light flat grey by the stylesheet filter above.
    // No tile ever loaded (offline or blocked) after several attempts: show the designed unavailable state.
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

  // the +/− buttons in the overlay
  useEffect(() => {
    if (!zoomCmd) return;
    if (zoomCmd.d > 0) map.current?.zoomIn();
    else map.current?.zoomOut();
  }, [zoomCmd]);

  useEffect(() => {
    if (target) map.current?.flyTo([target.lat, target.lng], target.zoom === 'venue' ? 16 : target.zoom === 'near' ? 14 : 13, { duration: 0.6 });
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
