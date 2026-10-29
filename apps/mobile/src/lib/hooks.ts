import AsyncStorage from '@react-native-async-storage/async-storage';
import { liveIsUp } from './live';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, LayoutAnimation, Platform, UIManager } from 'react-native';
import { ApiError, writeCount } from './api';
import { t } from './i18n';

export const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : t('Something went wrong'));

// Android needs this switched on before a list can slide its rows into place
if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

// What was loaded last time, by name, so a screen you come back to shows it at once while it refreshes quietly.
const cache = new Map<string, unknown>();

// ...and kept on the phone for the next time the app opens (one person's data only, never a chat's messages)
const DISK = 'ht_load_cache_v1';
let owner: string | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveSoon() {
  if (!owner || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const entries: Record<string, unknown> = {};
    cache.forEach((v, k) => {
      if (!k.startsWith('chat:')) entries[k] = v;
    });
    AsyncStorage.setItem(DISK, JSON.stringify({ owner, entries })).catch(() => {});
  }, 2000);
}
// Reading the remembered answers starts the moment the app starts, while the sign-in is still being checked with the server,
// so by the time we know who it is the memory is usually already in hand (used once; later restores read it again).
let early: Promise<string | null> | null = AsyncStorage.getItem(DISK).catch(() => null);
/** Load what was remembered last time for this person (nothing if it was someone else's). Done before the first screen. */
export async function restoreLoadCache(userId: string) {
  owner = userId;
  try {
    const raw = await (early ?? AsyncStorage.getItem(DISK));
    early = null;
    const saved = raw ? (JSON.parse(raw) as { owner?: string; entries?: Record<string, unknown> }) : null;
    if (saved?.owner === userId && saved.entries) for (const [k, v] of Object.entries(saved.entries)) if (!cache.has(k)) cache.set(k, v);
  } catch {
    // an unreadable memory is simply an empty one
  }
}
// screens showing a remembered answer, so a change made elsewhere reaches them while they are out of sight
const watchers = new Map<string, Set<(v: unknown) => void>>();
const keyOf = (cacheKey: string, deps: unknown[]) => `${cacheKey}|${JSON.stringify(deps)}`;

/** The memory name of a server-paged list (see useCursorList), so something can fill it ahead of time. */
export const cursorDeps = (path: string, params: Record<string, string>) => [path + JSON.stringify(params)];

/** Forget everything (when someone signs out, so the next person never sees it). */
export const clearLoadCache = () => {
  cache.clear();
  owner = null;
  AsyncStorage.removeItem(DISK).catch(() => {});
};

/** Put an answer in the memory ahead of time (a chat's messages, fetched quietly), so opening it needs no waiting. */
export function primeCache<T>(cacheKey: string, deps: unknown[], data: T) {
  const key = keyOf(cacheKey, deps);
  if (JSON.stringify(cache.get(key)) === JSON.stringify(data)) return;
  cache.set(key, data);
  saveSoon();
  watchers.get(key)?.forEach((f) => f(data));
}

/** Change a remembered answer from another screen (the inbox learns a message was sent), so it is already right when you get back to it. */
export function patchCache<T>(cacheKey: string, deps: unknown[], update: (old: T) => T) {
  const key = keyOf(cacheKey, deps);
  if (!cache.has(key)) return;
  primeCache(cacheKey, deps, update(cache.get(key) as T));
}

/** While the live connection is up, a screen it covers polls this many times less often (it still catches anything missed). */
const LIVE_POLL_STRETCH = 5;

/**
 * Loads data whenever the screen is focused (so lists refresh after you come back from a detail screen) and, if
 * `pollMs` is set, keeps refreshing while the screen is visible and the app is open.
 *
 * It never flashes: a loading state exists only while there is nothing to show yet; a refresh happens in the background
 * and the screen re-draws only if the answer is different. Give it a `cacheKey` and the last answer is shown instantly the
 * next time (a chat, the inbox). If what is loaded changes (the deps: another chat, another activity) the old answer is
 * dropped straight away, so the previous page never shows for a moment inside the new one.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number, cacheKey?: string, opts?: {
  /** when the deps change, keep showing the previous answer until the new one arrives (filters), instead of starting blank */
  keep?: boolean;
  /** when a refresh brings a different answer, let the rows slide into their new places (a chat moving up) */
  animate?: boolean;
  /** the live connection tells this screen about changes: while it is working, the poll is only a rare safety net */
  live?: boolean;
}) {
  const depsKey = JSON.stringify(deps);
  const full = cacheKey ? `${cacheKey}|${depsKey}` : null;
  const start = full && cache.has(full) ? (cache.get(full) as T) : null;
  const [data, setData] = useState<T | null>(start);
  const dataRef = useRef<T | null>(start);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(start === null);
  const have = useRef(start !== null); // is there something on screen already?
  const seq = useRef(0);
  const lastDeps = useRef(depsKey);
  const fetched = useRef({ at: 0, writes: -1 }); // when this was last loaded, and how many changes had been made then

  // an answer put in the memory (or patched) by another screen reaches this one even while it is out of sight
  useEffect(() => {
    if (!full) return;
    const f = (v: unknown) => {
      have.current = true;
      dataRef.current = v as T;
      setData(v as T);
      setLoading(false);
    };
    if (!watchers.has(full)) watchers.set(full, new Set());
    watchers.get(full)!.add(f);
    return () => {
      watchers.get(full)?.delete(f);
    };
  }, [full]);

  if (lastDeps.current !== depsKey) {
    // a different thing is being loaded: show its remembered answer, or nothing (never the old thing's)
    lastDeps.current = depsKey;
    if (!(opts?.keep && dataRef.current !== null)) {
      have.current = start !== null;
      dataRef.current = start;
      setData(start);
      setLoading(start === null);
    }
    setError(null);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    const id = ++seq.current;
    if (!have.current) setLoading(true);
    return fn()
      .then((d) => {
        if (id === seq.current) {
          have.current = true;
          fetched.current = { at: Date.now(), writes: writeCount() };
          if (full) {
            cache.set(full, d);
            saveSoon();
          }
          const old = dataRef.current;
          if (old === null || JSON.stringify(old) !== JSON.stringify(d)) {
            // a different answer while something is already on screen: rows glide to their new places
            if (opts?.animate && old !== null) LayoutAnimation.configureNext(LayoutAnimation.create(260, 'easeInEaseOut', 'opacity'));
            dataRef.current = d;
            setData(d);
          } // the same answer: nothing is redrawn at all
          setError(null);
        }
      })
      .catch((e) => id === seq.current && setError(e))
      .finally(() => id === seq.current && setLoading(false));
  }, deps);

  useFocusEffect(
    useCallback(() => {
      // Coming back to a page: if it was loaded moments ago and nothing was changed since, it is still right, so do not ask
      // again (nothing to refresh, nothing to flicker). A change made anywhere, or a few seconds more, and it is asked.
      const fresh = have.current && Date.now() - fetched.current.at < 15_000 && fetched.current.writes === writeCount();
      if (!fresh) void reload();
      if (!pollMs) return;
      // with the live connection up, a screen it covers asks only every few ticks instead of every one
      let tick = 0;
      const t = setInterval(() => {
        if (AppState.currentState !== 'active') return;
        if (opts?.live && liveIsUp() && ++tick % LIVE_POLL_STRETCH !== 0) return;
        void reload();
      }, pollMs);
      return () => clearInterval(t);
    }, [reload, pollMs, opts?.live]),
  );

  return { data, error, loading, reload };
}

/** Drives pull-to-refresh: `<Screen onRefresh={onRefresh} refreshing={refreshing}>`. */
export function useRefresh(reload: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  }, [reload]);
  return { refreshing, onRefresh };
}

/** Runs a mutation, keeps the error for display, then runs `after`. */
export function useAction(after?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.();
      return r;
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, error, busy, setError };
}
