import { Controller, Get, Ip, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { ApiError, E } from '../common/errors';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';

export const searchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  /** "city": cities, towns and regions (the city picker); "area": neighbourhoods and areas; "venue": any named place on the map (hotels, shops, cafes, parks...) except places closed to the public; "place" (default): anything, a venue or an address */
  kind: z.enum(['place', 'area', 'city', 'destination', 'venue']).default('place'),
  /** where to look first: the chosen city's position. Nearby places rank higher; places elsewhere still show. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** older apps send the city's name instead of its position: it is added to the words searched */
  city: z.string().trim().max(80).optional(),
});

export const reverseSchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/** `label` (destination search only): the name a trip shows, with its country: "Milan, Italy", "Kerala, India", "Italy". */
export type Place = { id: string; name: string; address: string; lat: number; lng: number; label?: string };
type Kind = 'place' | 'area' | 'city' | 'destination' | 'venue';

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; type?: string; name?: string; street?: string; housenumber?: string; district?: string; city?: string; county?: string; state?: string; country?: string };
};
type NominatimHit = { place_id: number; osm_type?: string; osm_id?: number; name?: string; display_name: string; lat: string; lon: string; category?: string; class?: string; type?: string };

/**
 * Places a plan cannot be held at: the ones the public cannot walk into (military, government offices, prisons, police and fire
 * stations, embassies, border posts, power and water works, runways) and the ones that are not for meeting strangers (homes,
 * schools and nurseries). The map's own tags decide; anything not listed here is allowed, so hotels, shops, cafes, bars,
 * restaurants, parks, museums and the rest of the map can all be picked.
 */
const NO_KEYS = new Set(['military']);
const NO_VALUES: Record<string, string[]> = {
  amenity: ['parking', 'bicycle_parking', 'parking_entrance', 'parking_space', 'motorcycle_parking', 'bench', 'waste_basket', 'toilets', 'prison', 'police', 'fire_station', 'embassy', 'border_control', 'courthouse', 'ranger_station', 'kindergarten', 'school', 'childcare', 'grave_yard', 'crematorium', 'mortuary'],
  office: ['government', 'diplomatic', 'administrative', 'police', 'military', 'customs', 'tax', 'intelligence'],
  landuse: ['greenfield', 'construction', 'brownfield', 'military', 'railway', 'industrial', 'quarry', 'landfill', 'residential', 'garages'],
  building: ['military', 'government', 'public', 'civic', 'prison', 'barracks', 'bunker', 'house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'dormitory', 'farm', 'cabin', 'static_caravan', 'school', 'kindergarten'],
  barrier: ['border_control', 'gate', 'lift_gate'],
  power: ['plant', 'substation', 'generator', 'transformer', 'line', 'tower'],
  man_made: ['surveillance', 'wastewater_plant', 'water_works', 'storage_tank', 'petroleum_well', 'works', 'pipeline', 'embankment', 'antenna', 'mast', 'tower'],
  aeroway: ['runway', 'taxiway', 'apron', 'hangar', 'navigationaid', 'helipad', 'holding_position'],
  railway: ['rail', 'yard', 'signal', 'switch', 'light_rail', 'subway', 'tram', 'tram_stop', 'halt', 'stop', 'platform', 'subway_entrance', 'level_crossing'],
  place: ['house', 'plot', 'farm'],
  boundary: ['administrative'],
  government: ['*'],
  emergency: ['*'],
  highway: ['elevator', 'crossing', 'traffic_signals', 'platform', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'service', 'residential', 'track', 'footway', 'path', 'cycleway', 'steps', 'bus_stop', 'street_lamp'],
};
// the map's tags are not always enough (a police headquarters can be tagged only as a building), so the name is checked too, in English and Italian
const NO_NAMES = /\b(caserma|carabinieri|questura|polizia|prefettura|tribunale|giustizia|ministero|carcere|penitenziari\w*|guardia di finanza|base militare|aeronautica militare|esercito|vigili del fuoco|ambasciata|consolato|military|army|navy|air force|barracks|police|sheriff|courthouse|court house|ministry|prison|jail|embassy|consulate|border (?:control|post)|customs|fire station|nuclear|power plant)\b/i;
function allowedVenue(key?: string, value?: string, name?: string): boolean {
  if (name && NO_NAMES.test(name)) return false;
  if (key && NO_KEYS.has(key)) return false;
  const bad = key ? NO_VALUES[key] : undefined;
  if (bad && (bad.includes('*') || (value && bad.includes(value)))) return false;
  return true;
}

// Photon: search-as-you-type over OpenStreetMap (finds "Chalakudy" from "Chalak", ranks places near `lat`/`lng` first).
// Nominatim (same map data, whole words only) answers when Photon cannot.
const PHOTON = process.env.PHOTON_URL ?? 'https://photon.komoot.io';
const NOMINATIM = process.env.PLACES_URL ?? 'https://nominatim.openstreetmap.org';
const MIN_GAP_MS = 300; // searches leave this server one after another, a moment apart, so the free services are not flooded
const MAX_WAITING = 8; // beyond this many queued searches the answer is "slow down" rather than a long wait
const TTL_MS = 10 * 60e3;
const MAX_CACHED = 500;
// destination: anywhere in the world a trip can go, from a whole country down to a neighbourhood
const LAYERS: Record<'city' | 'area' | 'destination', string[]> = { city: ['city', 'district', 'locality', 'county', 'state'], area: ['district', 'locality', 'city'], destination: ['country', 'state', 'city', 'county', 'district', 'locality'] };
// destination search: countries and cities first, then regions, then smaller places (same size keeps Photon's order, which is by fame)
const DEST_SIZE: Record<string, number> = { country: 0, city: 1, state: 1, county: 2, district: 3, locality: 4 };
const destSize = (type?: string) => DEST_SIZE[type ?? ''] ?? 5;
const stateOf = new WeakMap<Place, string>(); // the state each found place is in, to tell apart places that would otherwise read the same
const UA = 'HereThereApp/1.0 (place search)';
// city search: bigger places first (a town called "Chalakudy" before a hamlet called "Chalak"); same size keeps Photon's order
// (Photon calls many cities "administrative": Thrissur is one)
const SIZE: Record<string, number> = { city: 0, administrative: 1, town: 1, state: 2, region: 2, province: 2, local_authority: 3, political: 3, county: 3, municipality: 3, district: 3, borough: 4, suburb: 4, village: 4, quarter: 5, neighbourhood: 5, hamlet: 6, locality: 6, isolated_dwelling: 7 };
const size = (v?: string) => SIZE[v ?? ''] ?? 5;

/**
 * Place search for the city picker and the "public meeting location" field: type part of a name, get back real places with
 * a position. The app never talks to the map service itself: this server does, so the person's device address is not passed
 * on, only the words they typed and the city's position (never their account).
 */
@Controller('v1/places')
export class PlacesController {
  private cache = new Map<string, { at: number; items: Place[] }>();
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private last = 0;

  constructor(private readonly limiter: RateLimiter) {}

  /**
   * Open without signing in for the city picker only (kind=city): "Create your account" asks for a city before there is an account.
   * Someone signed out gets a tighter limit per address; neighbourhoods and other places still need a sign-in.
   */
  @Public()
  @Get('search')
  async search(@CurrentUser() me: User | undefined, @Ip() ip: string, @Query() query: unknown) {
    const s = parse(searchSchema, query);
    if (!me && s.kind !== 'city') throw E.unauthorized();
    this.limiter.hit(me ? `places:${me.id}` : `places:ip:${ip}`, me ? 60 : 30, 60_000);
    let near = s.lat !== undefined && s.lng !== undefined ? { lat: Math.round(s.lat * 100) / 100, lng: Math.round(s.lng * 100) / 100 } : null;
    // a venue search for a city given only by name: find the city's centre first, so the search stays inside it
    if (!near && s.kind === 'venue' && s.city) near = await this.queued(() => this.cityCentre(s.city as string)).catch(() => null);
    const text = !near && s.city && s.kind !== 'city' ? `${s.q}, ${s.city}` : s.q;
    const key = `${s.kind}|${text}|${near ? `${near.lat},${near.lng}` : ''}`.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return { items: hit.items };
    const items = await this.queued(() => this.lookup(text, s.kind, near));
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), items });
    return { items };
  }

  /**
   * "Near me": the town or city a position is in ("Thrissur", "Chalakkudy", "Milan"), with its centre, so the app can make it the
   * city it shows. Only the position goes out (rounded to about 1 km), never the person.
   */
  @Public() // also open signed out (the city picker on "Create your account"), with a tighter limit per address
  @Get('reverse')
  async reverse(@CurrentUser() me: User | undefined, @Ip() ip: string, @Query() query: unknown) {
    const { lat, lng } = parse(reverseSchema, query);
    this.limiter.hit(me ? `places:${me.id}` : `places:ip:${ip}`, me ? 60 : 30, 60_000);
    const at = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
    const key = `reverse|${at.lat},${at.lng}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.items[0] ?? null;
    const items = await this.queued(async () => {
      const params = new URLSearchParams({ lat: String(at.lat), lon: String(at.lng), format: 'jsonv2', zoom: '12', 'accept-language': 'en' }); // 12 = a town; 10 gave the wider area ("Chalakkudy" the taluk, not Chalakudy the town)
      const res = await fetch(`${NOMINATIM}/reverse?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { name?: string; lat?: string; lon?: string; osm_type?: string; osm_id?: number; address?: Record<string, string> };
      const a = j.address ?? {};
      // the settlement the person is in (city, town, municipality, village) comes first; the wider area's name only when there is none
      const name = a.city || a.town || a.municipality || a.village || j.name || a.county || a.state_district;
      if (!name || !j.lat || !j.lon) return [];
      const where = [a.state_district, a.state, a.country].filter((x, i, all): x is string => !!x && x !== name && all.indexOf(x) === i);
      return [{ id: `osm:${j.osm_type ?? 'x'}:${j.osm_id ?? 0}`, name, address: where.slice(0, 3).join(', '), lat: round(Number(j.lat)), lng: round(Number(j.lon)) }];
    });
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), items });
    return items[0] ?? null;
  }

  private centres = new Map<string, { lat: number; lng: number } | null>();
  private async cityCentre(name: string): Promise<{ lat: number; lng: number } | null> {
    const key = name.trim().toLowerCase();
    if (this.centres.has(key)) return this.centres.get(key) ?? null;
    const hit = (await photon(name, 'city', null))[0];
    const at = hit ? { lat: Math.round(hit.lat * 100) / 100, lng: Math.round(hit.lng * 100) / 100 } : null;
    if (at) this.centres.set(key, at);
    return at;
  }

  private async lookup(text: string, kind: Kind, near: { lat: number; lng: number } | null): Promise<Place[]> {
    // venue search with a key set in .env (GOOGLE_PLACES_API_KEY): Google Places first, inside the city; the map search below when there is no key, Google fails or finds nothing
    if (kind === 'venue' && near) {
      const g = await googlePlaces(text, near);
      if (g?.length) return g;
    }
    try {
      return named(dedupe(await photon(text, kind, near)));
    } catch {
      return named(dedupe(await nominatim(text, kind, near)));
    }
  }

  /** One request at a time, a moment apart. */
  private queued<T>(fn: () => Promise<T>): Promise<T> {
    if (this.waiting >= MAX_WAITING) throw new ApiError(429, 'RATE_LIMITED', 'Too many searches at once, try again in a moment');
    this.waiting++;
    const run = async () => {
      try {
        const wait = this.last + MIN_GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.last = Date.now();
        return await fn();
      } catch {
        throw new ApiError(502, 'PLACES_UNAVAILABLE', 'Place search is not available right now. Type the place name and try again later.');
      } finally {
        this.waiting--;
      }
    };
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}

/** Google Places (the places Google and Apple Maps show). The key lives only on the server, in .env; phones never see it. */
const GOOGLE_NO_TYPES = new Set([
  'local_government_office', 'city_hall', 'courthouse', 'police', 'fire_station', 'embassy', 'school', 'primary_school', 'secondary_school',
  'preschool', 'cemetery', 'funeral_home', 'parking', 'electric_vehicle_charging_station', 'locality', 'political', 'country',
  'administrative_area_level_1', 'administrative_area_level_2', 'postal_code', 'street_address', 'route', 'premise', 'subpremise',
]);
type GPlace = { id: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude: number; longitude: number }; types?: string[]; businessStatus?: string };
async function googlePlaces(text: string, near: { lat: number; lng: number }): Promise<Place[] | null> {
  const key = (process.env.GOOGLE_PLACES_API_KEY ?? '').trim();
  if (!key) return null;
  try {
    const [w, s, e, n] = cityBox(near);
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.businessStatus' },
      body: JSON.stringify({ textQuery: text, languageCode: 'en', pageSize: 10, locationRestriction: { rectangle: { low: { latitude: s, longitude: w }, high: { latitude: n, longitude: e } } } }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const out: Place[] = [];
    for (const p of ((await res.json()) as { places?: GPlace[] }).places ?? []) {
      const name = p.displayName?.text?.trim();
      if (!name || !p.location || p.businessStatus === 'CLOSED_PERMANENTLY') continue;
      if (NO_NAMES.test(name) || (p.types ?? []).some((t) => GOOGLE_NO_TYPES.has(t))) continue;
      out.push({ id: `g:${p.id}`, name, address: (p.formattedAddress ?? '').replace(/,s*(Italy|Italia|India)$/i, '').replace(`${name}, `, ''), lat: round(p.location.latitude), lng: round(p.location.longitude) });
    }
    return out;
  } catch {
    return null;
  }
}

async function photon(text: string, kind: Kind, near: { lat: number; lng: number } | null): Promise<Place[]> {
  const params = new URLSearchParams({ q: text, limit: kind === 'venue' ? '15' : '8', lang: 'en' });
  if (near && kind !== 'destination') {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lng));
    // venue search: only inside the city's box (about 30 km around its centre); a bias alone let far-away namesakes win ("hotel" found French town halls)
    if (kind === 'venue') params.set('bbox', cityBox(near).join(','));
  }
  if (kind !== 'place' && kind !== 'venue') LAYERS[kind].forEach((l) => params.append('layer', l));
  const res = await fetch(`${PHOTON}/api/?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(String(res.status));
  const features = ((await res.json()) as { features: PhotonFeature[] }).features;
  if (kind === 'city') features.sort((a, b) => size(a.properties.osm_value) - size(b.properties.osm_value)); // stable: ties keep their order
  if (kind === 'destination') features.sort((a, b) => destSize(a.properties.type) - destSize(b.properties.type));
  const list = features
    .filter((f) => kind !== 'venue' || (!!f.properties.name?.trim() && allowedVenue(f.properties.osm_key, f.properties.osm_value, f.properties.name)))
    .map((f) => {
      const place = fromPhoton(f, kind === 'destination');
      if (place && f.properties.state) stateOf.set(place, f.properties.state);
      return place;
    })
    .filter((p): p is Place => !!p);
  return onCity(list, kind, near);
}

/** Venue search with a city chosen: only places in or around that city (about 30 km). */
const CITY_KM = 30;
const cityBox = (n: { lat: number; lng: number }) => {
  const dLat = CITY_KM / 111;
  const dLng = CITY_KM / (111 * Math.max(0.2, Math.cos((n.lat * Math.PI) / 180)));
  return [n.lng - dLng, n.lat - dLat, n.lng + dLng, n.lat + dLat].map((x) => Math.round(x * 1e4) / 1e4);
};
function onCity(list: Place[], kind: Kind, near: { lat: number; lng: number } | null): Place[] {
  if (kind !== 'venue' || !near) return list;
  const km = (p: Place) => Math.hypot((p.lat - near.lat) * 111, (p.lng - near.lng) * 111 * Math.cos((near.lat * Math.PI) / 180));
  const inside = list.filter((p) => km(p) <= CITY_KM);
  return inside;
}

async function nominatim(text: string, kind: Kind, near: { lat: number; lng: number } | null = null): Promise<Place[]> {
  const params = new URLSearchParams({ q: text, format: 'jsonv2', limit: kind === 'venue' ? '12' : '6', addressdetails: '0', 'accept-language': 'en' });
  if (kind === 'city') params.set('featureType', 'settlement');
  if (kind === 'venue' && near) params.set('viewbox', (([w, so, e, n]) => [w, n, e, so].join(','))(cityBox(near)));
  if (kind === 'venue' && near) params.set('bounded', '1');
  const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(String(res.status));
  const list = ((await res.json()) as NominatimHit[])
    .filter((h) => kind !== 'venue' || (!!h.name?.trim() && allowedVenue(h.category ?? h.class, h.type, h.name)))
    .map((h) => fromNominatim(h, kind === 'destination'));
  return onCity(list, kind, near);
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/** A Photon answer: its name (or "Via Plinio 10" for a bare address) and where it is ("Milano, Lombardia, Italy"). */
function fromPhoton(f: PhotonFeature, withLabel = false): Place | null {
  const p = f.properties;
  const name = p.name?.trim() || (p.street ? [p.street, p.housenumber].filter(Boolean).join(' ') : '');
  if (!name) return null;
  const where = [p.district, p.city, p.county, p.state, p.country].filter((x, i, all): x is string => !!x && x !== name && all.indexOf(x) === i);
  return {
    id: p.osm_type && p.osm_id ? `osm:${p.osm_type.toLowerCase()}:${p.osm_id}` : `osm:${f.geometry.coordinates.join(',')}`,
    name,
    address: where.slice(0, 3).join(', '),
    lat: round(f.geometry.coordinates[1]),
    lng: round(f.geometry.coordinates[0]),
    // "Milan, Italy": the name, the city it is in when it is something smaller, and the country (a country is just its name)
    ...(withLabel && { label: [name, p.city && p.city !== name ? p.city : null, p.country && p.country !== name ? p.country : null].filter(Boolean).join(', ') }),
  };
}

/** "Bar Basso, Via Plinio, Milano, Lombardia, Italia": the first part is the name, the rest is where it is. */
function fromNominatim(h: NominatimHit, withLabel = false): Place {
  const parts = h.display_name.split(', ');
  // an address has no name of its own: it starts with the house number, so read "10, Via Plinio" as "Via Plinio 10"
  const name = (h.name && h.name.trim()) || (/^\d+\w?$/.test(parts[0]) && parts[1] ? `${parts[1]} ${parts[0]}` : parts[0]);
  const rest = name === parts[0] ? parts.slice(1) : name === `${parts[1]} ${parts[0]}` ? parts.slice(2) : parts;
  const country = parts[parts.length - 1];
  return {
    id: h.osm_type && h.osm_id ? `osm:${h.osm_type}:${h.osm_id}` : `osm:${h.place_id}`,
    name,
    address: rest.slice(0, 3).join(', '),
    lat: round(Number(h.lat)),
    lng: round(Number(h.lon)),
    ...(withLabel && { label: country && country !== name ? `${name}, ${country}` : name }),
  };
}

/** Destination search: two different places that would read the same ("Milan, United States" five times) are told apart by their state. */
function named(list: Place[]): Place[] {
  const seen = new Map<string, number>();
  list.forEach((p) => p.label && seen.set(p.label, (seen.get(p.label) ?? 0) + 1));
  return list.map((p) => {
    const st = stateOf.get(p);
    if (!p.label || (seen.get(p.label) ?? 0) < 2 || !st || st === p.name) return p;
    const parts = p.label.split(', ');
    return { ...p, label: [...parts.slice(0, -1), st, parts[parts.length - 1]].join(', ') };
  });
}

/**
 * The same place is often listed twice: keep the first of any two with one name that are within about 300 m, or that read the
 * same ("Bergamo, Lombardy, Italy" as the city and as its province). At most 6.
 */
function dedupe(all: Place[]): Place[] {
  return all.filter((p, i) => !all.slice(0, i).some((o) => o.name === p.name && (o.address === p.address || (Math.abs(o.lat - p.lat) < 0.003 && Math.abs(o.lng - p.lng) < 0.004)))).slice(0, 6);
}
