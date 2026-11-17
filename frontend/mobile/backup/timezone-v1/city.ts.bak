import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { get } from './api';
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
  useSyncExternalStore(subscribe, () => areaKm); // a screen that shows a city redraws when the admin's coverage distance for it arrives
  const shown = chosen || me?.profile?.homeCity || 'Milan';
  useEffect(() => setLiveCity(shown), [shown]);
  useEffect(() => watchArea(shown), [shown]);
  return [shown, pickCity] as const;
}

/**
 * True when the city shown is a real one: chosen by the person, or the home city in their profile. Without either, the feeds
 * show Milan so they are not empty, but that is only a placeholder: nothing may be saved as the person's city from it.
 */
export function useCityKnown() {
  const { me } = useMe();
  useOwner();
  useEffect(load, []);
  const chosen = useSyncExternalStore(subscribe, () => city);
  return !!(chosen || me?.profile?.homeCity);
}

/** The chosen city's centre on the map (null when it was typed by hand, or is the profile's home city). */
export function useCityPos() {
  useOwner();
  useEffect(load, []);
  const chosen = useSyncExternalStore(subscribe, () => city);
  const at = useSyncExternalStore(subscribe, () => pos);
  return chosen ? at : null;
}

/** How far around a city's centre its activities are shown and may be placed (km) when the server has not said otherwise. */
export const CITY_AREA_KM = 25;

// The distance is set per city by an admin (Settings > Places & limits > Coverage). It is read from the server for the city on
// screen, kept for a minute per city, and the built-in 25 km stands in until the answer comes (or when the server cannot be reached).
let areaKm = CITY_AREA_KM;
const areaSeen = new Map<string, { km: number; at: number }>();
function watchArea(name: string) {
  const key = name.trim().toLowerCase();
  const hit = areaSeen.get(key);
  const use = (km: number) => {
    if (km === areaKm) return;
    areaKm = km;
    emit();
  };
  if (hit && Date.now() - hit.at < 60_000) return use(hit.km);
  let alive = true;
  get<{ area?: { km: number } }>(`/v1/regions/limits?city=${encodeURIComponent(name.trim())}`)
    .then((r) => {
      const km = r.area?.km ?? CITY_AREA_KM;
      areaSeen.set(key, { km, at: Date.now() });
      if (alive) use(km);
    })
    .catch(() => {});
  return () => {
    alive = false;
  };
}
/** The coverage distance of the city on screen, in km. */
export const getAreaKm = () => areaKm;
export function useAreaKm() {
  useCity();
  return useSyncExternalStore(subscribe, () => areaKm);
}

/**
 * The query that picks a city's activities: around its centre when it is known (by distance; activities with no position still
 * match by name), or by name only.
 */
export function cityQuery(name: string, at: Near | null): Record<string, string> {
  return at ? { city: name, lat: String(at.lat), lng: String(at.lng), radiusKm: String(areaKm), area: 'true' } : { city: name };
}

/** The saved "Near me" position (null = the whole city), the same on every screen. */
export function useNear() {
  useOwner();
  useEffect(load, []);
  const value = useSyncExternalStore(subscribe, () => near);
  const set = useCallback((n: Near | null) => pickNear(n), []);
  return [value, set] as const;
}
