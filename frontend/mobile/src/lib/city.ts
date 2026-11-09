import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useMe } from './auth';
import { setLiveCity } from './live';

// Saved per ACCOUNT on this phone: each person who signs in here gets back their own last city, never the one someone else
// left behind (it used to be one value for the phone, so signing in as another person showed the previous person's city).
let owner: string | null = null; // whose city is loaded: the signed-in person's id
const keyOf = (base: string) => `${base}:${owner ?? 'guest'}`;
const KEY = () => keyOf('ht_city');
const NEAR_KEY = () => keyOf('ht_near');
const POS_KEY = () => keyOf('ht_city_pos');

export type Near = { lat: number; lng: number };

/**
 * The city and the "Near me" position are ONE choice for the whole app, kept here (not in each screen) and saved on the phone
 * for the person signed in (each account keeps its own):
 * pick Thrissur once and every screen shows Thrissur, also after the app is closed, until the person picks something else.
 * Picking a city drops the "Near me" position (the two are different ways of saying where you are), and "Near me" stays
 * until the person taps "Whole city" or picks a city.
 * A city picked from the search also keeps its position on the map: the app then shows what is around it (any spelling of the
 * name, nearby towns), not only what was posted under exactly that name.
 */
let city = '';
let near: Near | null = null;
let pos: Near | null = null; // the chosen city's centre, when it was picked from the search
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  const mine = owner;
  AsyncStorage.multiGet([KEY(), NEAR_KEY(), POS_KEY()])
    .then((rows) => {
      if (mine !== owner) return; // someone else signed in meanwhile: their own load takes over
      const [c, n, cp] = [rows[0]?.[1], rows[1]?.[1], rows[2]?.[1]];
      // a choice made while this was still loading wins over the saved one
      if (c && !city) {
        city = c;
        pos = point(cp);
      }
      if (n && !near) near = point(n);
      emit();
    })
    .catch(() => {});
}

/** A saved position, or null when there is none (or it is damaged). */
function point(raw: string | null | undefined): Near | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Near;
    return typeof p.lat === 'number' && typeof p.lng === 'number' ? { lat: p.lat, lng: p.lng } : null;
  } catch {
    return null;
  }
}

function pickCity(next: string, at?: Near | null) {
  city = next;
  pos = at ?? null;
  near = null;
  emit();
  AsyncStorage.multiSet([[KEY(), next]]).catch(() => {});
  (pos ? AsyncStorage.setItem(POS_KEY(), JSON.stringify(pos)) : AsyncStorage.removeItem(POS_KEY())).catch(() => {});
  AsyncStorage.removeItem(NEAR_KEY()).catch(() => {});
}

function pickNear(next: Near | null) {
  near = next;
  emit();
  (next ? AsyncStorage.setItem(NEAR_KEY(), JSON.stringify(next)) : AsyncStorage.removeItem(NEAR_KEY())).catch(() => {});
}

/** Another person signed in (or out): forget the previous person's city and load this person's own. */
function setOwner(id: string | null) {
  if (id === owner) return;
  owner = id;
  city = '';
  near = null;
  pos = null;
  loaded = false;
  emit();
  load();
}
/** Keeps the city store on the signed-in person (every hook that reads the city calls it). */
function useOwner() {
  const { me } = useMe();
  const id = me?.id ?? null;
  useEffect(() => setOwner(id), [id]);
}

/** The city the user is browsing. Chosen manually, so location permission is never required to use the app. */
export function useCity() {
  const { me } = useMe();
  useOwner();
  useEffect(load, []);
  const chosen = useSyncExternalStore(subscribe, () => city);
  const shown = chosen || me?.profile?.homeCity || 'Milan';
  useEffect(() => setLiveCity(shown), [shown]);
  return [shown, pickCity] as const;
}

/** The chosen city's centre on the map (null when it was typed by hand, or is the profile's home city). */
export function useCityPos() {
  useOwner();
  useEffect(load, []);
  const chosen = useSyncExternalStore(subscribe, () => city);
  const at = useSyncExternalStore(subscribe, () => pos);
  return chosen ? at : null;
}

/** How far around the chosen city activities are shown (km). */
export const CITY_AREA_KM = 25;

/**
 * The query that picks a city's activities: around its centre when it is known (by distance; activities with no position still
 * match by name), or by name only.
 */
export function cityQuery(name: string, at: Near | null): Record<string, string> {
  return at ? { city: name, lat: String(at.lat), lng: String(at.lng), radiusKm: String(CITY_AREA_KM), area: 'true' } : { city: name };
}

/** The saved "Near me" position (null = the whole city), the same on every screen. */
export function useNear() {
  useOwner();
  useEffect(load, []);
  const value = useSyncExternalStore(subscribe, () => near);
  const set = useCallback((n: Near | null) => pickNear(n), []);
  return [value, set] as const;
}
