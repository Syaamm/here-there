import { useSyncExternalStore } from 'react';

/**
 * The number on the Message tab. One shared value, so any screen can change it the instant something is read, instead
 * of the badge waiting for the next time it asks the server.
 */
let count = 0;
const subs = new Set<() => void>();
const refreshers = new Set<() => void>();

export const setUnread = (n: number) => {
  if (n === count) return;
  count = n;
  subs.forEach((f) => f());
};
/** Move the number right away, e.g. -1 when an alert is opened. */
export const bumpUnread = (d: number) => setUnread(Math.max(0, count + d));
export const useUnread = () =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
    () => count,
    () => count,
  );

/** The tab bar registers how to ask the server; anyone can then ask for a fresh number. */
export const onUnreadRefresh = (fn: () => void) => {
  refreshers.add(fn);
  return () => {
    refreshers.delete(fn);
  };
};
export const refreshUnread = () => refreshers.forEach((f) => f());
