import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { get } from './api';
import { useMe } from './auth';

/**
 * What is NEW on Reports & Blocked gets a red dot: a warning you have not asked a review of yet, and a review that has just been
 * decided (accepted or rejected). Which ones you have seen is kept on this phone, per account, as "kind:id:state", so a change of
 * state (a request decided) is new again. A request still waiting for an answer is not "new": nothing has happened to it.
 */
const KEY = (uid: string) => `ht_seen_reports:${uid}`;

export type RbState = 'new' | 'open' | 'upheld' | 'rejected' | 'decided';
export const keyOf = (kind: 'report' | 'appeal', id: string, state: string) => `${kind}:${id}:${state}`;
/** Only these are worth a dot. */
export const needsDot = (state: string) => state === 'new' || state === 'upheld' || state === 'rejected';

export async function readSeen(uid: string): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY(uid));
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

export async function markSeen(uid: string, keys: string[]) {
  if (keys.length === 0) return;
  try {
    const have = await readSeen(uid);
    keys.forEach((k) => have.add(k));
    await AsyncStorage.setItem(KEY(uid), JSON.stringify([...have].slice(-400)));
  } catch {
    /* the dot may show again: harmless */
  }
}

type AboutMe = { id: string; canAppeal: boolean; appeal: { state: string } | null };
type Appeal = { id: string; kind: string; state: string };

/** How many things on Reports & Blocked are new: the red dot on Settings (and on the gear in Profile). */
export function useReportsBadge() {
  const { me } = useMe();
  const [n, setN] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!me || me.role === 'guest') return;
      let live = true;
      void Promise.all([
        get<{ items: AboutMe[] }>('/v1/me/reports-about-me?limit=30').catch(() => ({ items: [] as AboutMe[] })),
        get<{ items: Appeal[] }>('/v1/me/appeals?limit=30').catch(() => ({ items: [] as Appeal[] })),
        readSeen(me.id),
      ]).then(([reports, appeals, seen]) => {
        if (!live) return;
        const keys = [
          ...reports.items.map((x) => ({ k: keyOf('report', x.id, x.appeal ? x.appeal.state : x.canAppeal ? 'new' : 'decided'), s: x.appeal ? x.appeal.state : x.canAppeal ? 'new' : 'decided' })),
          ...appeals.items.filter((a) => a.kind !== 'report').map((a) => ({ k: keyOf('appeal', a.id, a.state), s: a.state })),
        ];
        setN(keys.filter((x) => needsDot(x.s) && !seen.has(x.k)).length);
      });
      return () => {
        live = false;
      };
    }, [me?.id, me?.role]),
  );
  return n;
}
