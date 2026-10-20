import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError } from './api';

export const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong');

/**
 * Loads data whenever the screen is focused (so lists refresh after you come back from a detail
 * screen) and, if `pollMs` is set, keeps refreshing while the screen is visible and the app is open.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    const id = ++seq.current;
    setLoading(true);
    return fn()
      .then((d) => {
        if (id === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => id === seq.current && setError(e))
      .finally(() => id === seq.current && setLoading(false));
  }, deps);

  useFocusEffect(
    useCallback(() => {
      void reload();
      if (!pollMs) return;
      const t = setInterval(() => AppState.currentState === 'active' && void reload(), pollMs);
      return () => clearInterval(t);
    }, [reload, pollMs]),
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
