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
  // the floating dock: a frosted pill, and the fade behind it
  dockFill: 'rgba(255,255,255,0.88)',
  fadeFrom: 'rgba(255,255,255,0)',
  fadeTo: 'rgba(255,255,255,0.78)',
  /** the stand-in picture block of a detail page (until real photos exist) */
  heroBlock: '#D3EADD',
  /** hint text inside empty fields: far lighter than real text, so it never reads as a value */
  placeholder: '#B9C2BE',
  // the glass capsule behind the open dock tab: body, rim, glow, bright top edge and the tint gathering at the bottom
  glassFill: 'rgba(47,125,101,0.05)',
  glassRim: 'rgba(47,125,101,0.14)',
  glassGlow: '#2F7D65',
  glassShine: 'rgba(255,255,255,0.35)',
  glassEdge: 'rgba(255,255,255,0.55)',
  glassTint: 'rgba(47,125,101,0)',
  glassTintEnd: 'rgba(47,125,101,0.09)',
};

/**
 * THERE's own colours (the brand standard): warm ivory #E9E5DD as the page, deep forest #102F29 for text, deep green
 * and sand as the accents. Open, calm, adventurous. Used everywhere in THERE, and only there.
 */
const there: typeof base & { bg: string; headerBg: string } = {
  ...base,
  bg: '#E9E5DD',
  headerBg: '#E9E5DD',
  forest: '#102F29',
  forest2: '#1B4A40',
  text: '#102F29',
  muted: '#56625B',
  line: '#D3CCBD',
  surface: '#F4F1EA',
  accent: '#2F6B57', // deep green
  accentSoft: '#DAD2BE', // sand tint: chips, callouts, selected backgrounds
  onAccent: '#F4F1EA',
  sand: '#D8CDB5',
  green: '#24604D', // deep green for text and icons that carry the accent
  okBg: '#D3E0D4',
  okFg: '#1D4F3D',
  warnBg: '#E9DCBC',
  warnFg: '#6E4D12',
  badBg: '#EBD1C8',
  badFg: '#8A2F1E',
  infoBg: '#DDD7C9',
  infoFg: '#2C4A41',
  dockFill: 'rgba(244,241,234,0.92)',
  fadeFrom: 'rgba(233,229,221,0)',
  fadeTo: 'rgba(233,229,221,0.82)',
  heroBlock: '#D8CDB5',
  placeholder: '#B5B09F',
  // sand glass with a deep green rim and glow, on ivory
  glassFill: 'rgba(216,205,181,0.45)',
  glassRim: 'rgba(36,96,77,0.22)',
  glassGlow: '#24604D',
  glassShine: 'rgba(255,255,255,0.45)',
  glassEdge: 'rgba(255,255,255,0.6)',
  glassTint: 'rgba(216,205,181,0)',
  glassTintEnd: 'rgba(190,176,144,0.38)',
};

/** HERE: spontaneous, urban, alive (white and green). THERE: open, calm, adventurous (ivory, forest, sand). */
const modes = {
  here: { ...base, bg: '#FFFFFF', headerBg: '#FFFFFF' },
  there,
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
