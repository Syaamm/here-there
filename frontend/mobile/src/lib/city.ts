import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useMe } from './auth';
import { setLiveCity } from './live';

const KEY = 'ht_city';
const NEAR_KEY = 'ht_near';

export type Near = { lat: number; lng: number };

/**
 * The city and the "Near me" position are ONE choice for the whole app, kept here (not in each screen) and saved on the phone:
 * pick Thrissur once and every screen shows Thrissur, also after the app is closed, until the person picks something else.
 * Picking a city drops the "Near me" position (the two are different ways of saying where you are), and "Near me" stays
 * until the person taps "Whole city" or picks a city.
 */
let city = '';
let near: Near | null = null;
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
  AsyncStorage.multiGet([KEY, NEAR_KEY])
    .then((rows) => {
      const [c, n] = [rows[0]?.[1], rows[1]?.[1]];
      // a choice made while this was still loading wins over the saved one
      if (c && !city) city = c;
      if (n && !near) {
        try {
          const p = JSON.parse(n) as Near;
          if (typeof p.lat === 'number' && typeof p.lng === 'number') near = p;
        } catch {
          /* a damaged value is ignored */
        }
      }
      emit();
    })
    .catch(() => {});
}

function pickCity(next: string) {
  city = next;
  near = null;
  emit();
  AsyncStorage.multiSet([[KEY, next]]).catch(() => {});
  AsyncStorage.removeItem(NEAR_KEY).catch(() => {});
}

function pickNear(next: Near | null) {
  near = next;
  emit();
  (next ? AsyncStorage.setItem(NEAR_KEY, JSON.stringify(next)) : AsyncStorage.removeItem(NEAR_KEY)).catch(() => {});
}

/** The city the user is browsing. Chosen manually, so location permission is never required to use the app. */
export function useCity() {
  const { me } = useMe();
  useEffect(load, []);
  const chosen = useSyncExternalStore(subscribe, () => city);
  const shown = chosen || me?.profile?.homeCity || 'Milan';
  useEffect(() => setLiveCity(shown), [shown]);
  return [shown, pickCity] as const;
}

/** The saved "Near me" position (null = the whole city), the same on every screen. */
export function useNear() {
  useEffect(load, []);
  const value = useSyncExternalStore(subscribe, () => near);
  const set = useCallback((n: Near | null) => pickNear(n), []);
  return [value, set] as const;
}
