import { Controller, Get, Query } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../common/auth';
import { ApiError } from '../common/errors';
import { RateLimiter } from '../common/rate-limiter';
import { parse } from '../common/validate';

export const searchSchema = z.object({
  q: z.string().trim().min(3).max(100),
  city: z.string().trim().max(80).optional(),
});

export type Place = { id: string; name: string; address: string; lat: number; lng: number };

type Hit = { place_id: number; osm_type?: string; osm_id?: number; name?: string; display_name: string; lat: string; lon: string };

const BASE = process.env.PLACES_URL ?? 'https://nominatim.openstreetmap.org';
const MIN_GAP_MS = 1100; // the public OpenStreetMap service allows one request a second, from the whole server
const MAX_WAITING = 4; // beyond this many queued searches the answer is "slow down" rather than a long wait
const TTL_MS = 10 * 60e3;
const MAX_CACHED = 500;

/**
 * Place search for the "public meeting location" field: type a name or address, get back real places with a position.
 * The app never talks to the map service itself: this server does, so the person's device address is not passed on, only
 * the words they typed (never their account), and the one-request-a-second rule is kept for everybody together.
 */
@Controller('v1/places')
export class PlacesController {
  private cache = new Map<string, { at: number; items: Place[] }>();
  private chain: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  private last = 0;

  constructor(private readonly limiter: RateLimiter) {}

  @Get('search')
  async search(@CurrentUser() me: User, @Query() query: unknown) {
    const { q, city } = parse(searchSchema, query);
    this.limiter.hit(`places:${me.id}`, 40, 60_000);
    const key = `${q}|${city ?? ''}`.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return { items: hit.items };
    const items = await this.upstream(city ? `${q}, ${city}` : q);
    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: Date.now(), items });
    return { items };
  }

  /** One request at a time, at least a second apart. */
  private upstream(text: string): Promise<Place[]> {
    if (this.waiting >= MAX_WAITING) throw new ApiError(429, 'RATE_LIMITED', 'Too many searches at once, try again in a moment');
    this.waiting++;
    const run = async () => {
      try {
        const wait = this.last + MIN_GAP_MS - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        this.last = Date.now();
        const url = `${BASE}/search?${new URLSearchParams({ q: text, format: 'jsonv2', limit: '6', addressdetails: '0', 'accept-language': 'en' })}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'HereThereApp/1.0 (place search)' }, signal: AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(String(res.status));
        const all = ((await res.json()) as Hit[]).map(toPlace);
        // the same park or square is often listed twice: keep the first of any two with one name within about 300 m
        return all.filter((p, i) => !all.slice(0, i).some((o) => o.name === p.name && Math.abs(o.lat - p.lat) < 0.003 && Math.abs(o.lng - p.lng) < 0.004));
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

/** "Bar Basso, Via Plinio, Milano, Lombardia, Italia": the first part is the name, the rest is where it is. */
function toPlace(h: Hit): Place {
  const parts = h.display_name.split(', ');
  // an address has no name of its own: it starts with the house number, so read "10, Via Plinio" as "Via Plinio 10"
  const name = (h.name && h.name.trim()) || (/^\d+\w?$/.test(parts[0]) && parts[1] ? `${parts[1]} ${parts[0]}` : parts[0]);
  const rest = name === parts[0] ? parts.slice(1) : name === `${parts[1]} ${parts[0]}` ? parts.slice(2) : parts;
  return {
    id: h.osm_type && h.osm_id ? `osm:${h.osm_type}:${h.osm_id}` : `osm:${h.place_id}`,
    name,
    address: rest.slice(0, 3).join(', '),
    lat: Math.round(Number(h.lat) * 1e5) / 1e5,
    lng: Math.round(Number(h.lon) * 1e5) / 1e5,
  };
}
