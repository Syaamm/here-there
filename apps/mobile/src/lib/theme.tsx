import AsyncStorage from '@react-native-async-storage/async-storage';
import { ModeTransition } from '@/components/ModeTransition';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Mode = 'here' | 'there';

const base = {
  forest: '#102F29',
  forest2: '#1B4A40',
  ivory: '#D3EADD',
  text: '#14221F',
  muted: '#5C6B66',
  line: '#E2E8E4',
  surface: '#FFFFFF',
  danger: '#A8402D',
  // The brand accent is green (no amber/orange anywhere): a fresh mid-green for buttons and highlights,
  // a soft tint for chips and callouts, and dark text that stays readable on both.
  accent: '#4DAA84',
  accentSoft: '#DDEFE4',
  onAccent: '#0B2620',
  sand: '#EBF4EE',
  green: '#2F7D65',
  okBg: '#DFF0E8',
  okFg: '#1D5C45',
  warnBg: '#F8ECD0',
  warnFg: '#7A5410',
  badBg: '#F6DCD6',
  badFg: '#8A2F1E',
  infoBg: '#E9F0ED',
  infoFg: '#2C4A41',
};

/** HERE: spontaneous, urban, alive. THERE: open, calm, adventurous. Same system, two moods. */
const modes = {
  here: { ...base, bg: '#FFFFFF', headerBg: '#FFFFFF' },
  there: { ...base, bg: '#FFFFFF', headerBg: '#FFFFFF' },
};
export type Colors = typeof modes.here;

type ThemeState = { mode: Mode; setMode: (m: Mode) => void; /** like setMode, with the full-screen colour-wave transition */ switchMode: (m: Mode) => void; c: Colors };
const Ctx = createContext<ThemeState>({ mode: 'here', setMode: () => {}, switchMode: () => {}, c: modes.here });
export const useTheme = () => useContext(Ctx);

const KEY = 'ht_mode';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>('here');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === 'here' || v === 'there') && setModeState(v))
      .catch(() => {});
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  }, []);

  const [moving, setMoving] = useState<Mode | null>(null);
  const switchMode = useCallback((m: Mode) => setMoving((cur) => (cur || m === mode ? cur : m)), [mode]);

  const value = useMemo(() => ({ mode, setMode, switchMode, c: modes[mode] }), [mode, setMode, switchMode]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {moving ? <ModeTransition target={moving} onCovered={() => setMode(moving)} onDone={() => setMoving(null)} /> : null}
    </Ctx.Provider>
  );
}
