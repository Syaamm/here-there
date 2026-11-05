import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * The current time in ms, ticking every `ms`, but only while this screen is the one showing AND the app is in front:
 * a screen that is covered or an app that is in the background does no work. It catches up at once when it comes back.
 */
export function useClock(ms: number) {
  const [now, setNow] = useState(Date.now());
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), ms);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      sub.remove();
      stop();
    };
  }, [focused, ms]);
  return now;
}
