import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { get, type Activity } from '../api';
import { CATS, CITY_CENTERS } from '../constants';
import { ActivityCard, CitySheet, useCity } from './Explore';
import { Empty, ErrorBanner, go, useLoad, when } from '../ui';

/** Screen 03: venue map. Only public activity venues are plotted, never people. */
export function MapScreen() {
  const [city, setCity] = useCity();
  const [cityOpen, setCityOpen] = useState(false);
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);

  const feed = useLoad(() => {
    const now = new Date();
    const p = new URLSearchParams({ city, from: now.toISOString(), to: new Date(+now + 24 * 3600e3).toISOString(), limit: '50' });
    if (near) {
      p.set('lat', String(near.lat));
      p.set('lng', String(near.lng));
      p.set('radiusKm', '3');
    }
    return get<{ items: Activity[] }>(`/v1/activities?${p}`);
  }, [city, near], 60_000);

  const items = feed.data?.items ?? [];
  const plottable = items.filter((a) => a.lat != null && a.lng != null);
  const center: [number, number] | null = near ? [near.lat, near.lng] : (CITY_CENTERS[city.toLowerCase()] ?? (plottable[0] ? [plottable[0].lat!, plottable[0].lng!] : null));

  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || !center || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(center, 13);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
    let errors = 0;
    tiles.on('tileerror', () => ++errors > 3 && setTilesFailed(true));
    tiles.addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!center]);

  useEffect(() => {
    if (map.current && center) map.current.setView(center, near ? 14 : 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1]]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    for (const a of plottable) {
      const full = a.spotsLeft === 0;
      const icon = L.divIcon({
        className: '',
        html: `<div class="pin${full ? ' full' : ''}" aria-hidden="true">${CATS[a.category]?.emoji ?? '📍'}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });
      L.marker([a.lat!, a.lng!], { icon, keyboard: false, title: a.title }).on('click', () => setSelected(a)).addTo(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data, !!center]);

  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg('Location is not available on this device. Browsing the city instead.');
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // approximate only: ~1 km precision, used for this query and not stored
        setNear({ lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 });
      },
      () => setGeoMsg('Location permission is off, so we are showing the whole city. You can change this in your browser settings.'),
      { maximumAge: 300_000, timeout: 8000 },
    );
  };

  return (
    <>
      <div className="row between">
        <button className="link" onClick={() => setCityOpen(true)}>
          ⌕ {city}
        </button>
        <div className="row">
          {near ? (
            <button className="btn small" onClick={() => setNear(null)}>
              Show whole city
            </button>
          ) : (
            <button className="btn small" onClick={locate}>
              📍 Near me
            </button>
          )}
        </div>
      </div>
      {near && <p className="muted small">Using your approximate area (about 1 km) to find nearby venues. It is not saved or shared.</p>}
      {geoMsg && <p className="banner info">{geoMsg}</p>}
      <ErrorBanner message={feed.error?.message} />

      {!center ? (
        <Empty title="No map for this city yet">We only have map data for Milan in this pilot. You can still browse activities in the list below.</Empty>
      ) : (
        <div className="map-wrap">
          <div ref={el} className="map" role="region" aria-label="Map of activity venues" />
          {tilesFailed && <p className="banner error map-banner">The map could not load. The list below still works.</p>}
          {selected && (
            <a href={`#/activity/${selected.id}`} className="map-card">
              <strong>{selected.title}</strong>
              <span className="muted small">
                {when(selected.startsAt)} · {selected.venueName}
              </span>
              <span className="small">
                {selected.going}/{selected.capacity} confirmed · {selected.spotsLeft} spaces
              </span>
            </a>
          )}
        </div>
      )}

      <h3>{plottable.length === items.length ? 'In the next 24 hours' : 'In the next 24 hours (some venues have no map pin)'}</h3>
      {feed.data && items.length === 0 && (
        <Empty title="Nothing on the map">
          <button className="btn primary" onClick={() => go('/create')}>
            Create an activity
          </button>
        </Empty>
      )}
      <div className="stack">
        {items.map((a) => (
          <ActivityCard key={a.id} a={a} />
        ))}
      </div>
      {cityOpen && <CitySheet city={city} onPick={setCity} onClose={() => setCityOpen(false)} />}
    </>
  );
}
