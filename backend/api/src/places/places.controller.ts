import { Controller, Get, Ip, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, Public } from '../common/auth';
import { ApiError, E } from '../common/errors';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';

export const searchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  /** "city": cities, towns and regions (the city picker); "area": neighbourhoods and areas (where an activity meets); "place" (default): anything, a venue or an address */
  kind: z.enum(['place', 'area', 'city', 'destination']).default('place'),
  /** where to look first: the chosen city's position. Nearby places rank higher; places elsewhere still show. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  /** older apps send the city's name instead of its position: it is added to the words searched */
  city: z.string().trim().max(80).optional(),
});

export const reverseSchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

/** `label` (destination search only): the name a trip shows, with its country: "Milan, Italy", "Kerala, India", "Italy". */
export type Place = { id: string; name: string; address: string; lat: number; lng: number; label?: string };
type Kind = 'place' | 'area' | 'city' | 'destination';

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { osm_type?: string; osm_id?: number; osm_value?: string; type?: string; name?: string; street?: string; housenumber?: string; district?: string; city?: string; county?: string; state?: string; country?: string };
};
type NominatimHit = { place_id: number; osm_type?: string; osm_id?: number; name?: string; display_name: string; lat: string; lon: string };

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
    const near = s.lat !== undefined && s.lng !== undefined ? { lat: Math.round(s.lat * 100) / 100, lng: Math.round(s.lng * 100) / 100 } : null;
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

  private async lookup(text: string, kind: Kind, near: { lat: number; lng: number } | null): Promise<Place[]> {
    try {
      return named(dedupe(await photon(text, kind, near)));
    } catch {
      return named(dedupe(await nominatim(text, kind)));
    }
  }

  /** One request at a time, a moment apart. */
  private queued(fn: () => Promise<Place[]>): Promise<Place[]> {
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

async function photon(text: string, kind: Kind, near: { lat: number; lng: number } | null): Promise<Place[]> {
  const params = new URLSearchParams({ q: text, limit: '8', lang: 'en' });
  if (near && kind !== 'destination') {
    params.set('lat', String(near.lat));
    params.set('lon', String(near.lng));
  }
  if (kind !== 'place') LAYERS[kind].forEach((l) => params.append('layer', l));
  const res = await fetch(`${PHOTON}/api/?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(String(res.status));
  const features = ((await res.json()) as { features: PhotonFeature[] }).features;
  if (kind === 'city') features.sort((a, b) => size(a.properties.osm_value) - size(b.properties.osm_value)); // stable: ties keep their order
  if (kind === 'destination') features.sort((a, b) => destSize(a.properties.type) - destSize(b.properties.type));
  return features
    .map((f) => {
      const place = fromPhoton(f, kind === 'destination');
      if (place && f.properties.state) stateOf.set(place, f.properties.state);
      return place;
    })
    .filter((p): p is Place => !!p);
}

async function nominatim(text: string, kind: Kind): Promise<Place[]> {
  const params = new URLSearchParams({ q: text, format: 'jsonv2', limit: '6', addressdetails: '0', 'accept-language': 'en' });
  if (kind === 'city') params.set('featureType', 'settlement');
  const res = await fetch(`${NOMINATIM}/search?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as NominatimHit[]).map((h) => fromNominatim(h, kind === 'destination'));
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
