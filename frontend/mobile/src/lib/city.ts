import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useMe } from './auth';
import { setLiveCity } from './live';

const KEY = 'ht_city';

/** The city the user is browsing. Chosen manually, so location permission is never required to use the app. */
export function useCity() {
  const { me } = useMe();
  const [city, setCity] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setCity(v))
      .catch(() => {});
  }, []);

  const update = (c: string) => {
    setCity(c);
    AsyncStorage.setItem(KEY, c).catch(() => {});
  };
  const shown = city || me?.profile?.homeCity || 'Milan';
  useEffect(() => setLiveCity(shown), [shown]);
  return [shown, update] as const;
}
