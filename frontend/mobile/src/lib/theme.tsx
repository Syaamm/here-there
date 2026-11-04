import AsyncStorage from '@react-native-async-storage/async-storage';
import { ModeTransition } from '@/components/ModeTransition';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
  /** the band every page's static header sits on (the page rises over it as a rounded sheet): deep forest in HERE, sand in THERE */
  band: '#102F29',
  /** true when the band is dark (light text and status bar on it), false when it is light (forest text, dark status bar) */
  bandIsDark: true as boolean,
  /** text and icons on the band: titles, wordmark, city, back chevron, "Step n/4" */
  onBand: '#FFFFFF',
  /** taglines and secondary lines on the band */
  onBandMuted: 'rgba(255,255,255,0.8)',
  /** small labels on the band ("Step n/4", the wizard's kicker) */
  onBandDim: 'rgba(255,255,255,0.7)',
  /** the switch's idle label on the band */
  onBandFaint: 'rgba(255,255,255,0.62)',
  /** the HERE | THERE switch's rim and its open segment on the band */
  bandLine: 'rgba(255,255,255,0.45)',
  bandSel: 'rgba(255,255,255,0.22)',
  /** the city pill on the band */
  bandChip: 'rgba(235,239,238,0.2)',
  /** the round back button's disc */
  bandBack: 'rgba(255,255,255,0.16)',
  /** the wizard's four step bars: the empty track and the filled part */
  bandTrack: 'rgba(255,255,255,0.22)',
  bandFill: '#FFFFFF',
  /** the accent dot of the wordmark (two greens as drawn), and the city pin, on the band */
  bandDot: '#67A987',
  bandDotAlt: '#5FC29F',
  bandPin: '#43A047',
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
  dockFill: 'rgba(255,255,255,0.97)',
  fadeFrom: 'rgba(255,255,255,0)',
  fadeTo: 'rgba(255,255,255,0.78)',
  /** the stand-in picture block of a detail page (until real photos exist) */
  heroBlock: '#D3EADD',
  /** hint text inside empty fields: far lighter than real text, so it never reads as a value */
  placeholder: '#B9C2BE',
  // the capsule behind the open dock tab: a solid soft grey-green with a barely-there rim (no glow, shine or tint)
  glassFill: '#EBEFEE',
  glassRim: 'rgba(16,47,41,0.04)',
  glassGlow: '#EBEFEE',
  glassShine: 'rgba(255,255,255,0)',
  glassEdge: 'rgba(255,255,255,0)',
  glassTint: 'rgba(235,239,238,0)',
  glassTintEnd: 'rgba(235,239,238,0)',
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
  surface: '#FFFFFF', // the design's cards, search and fields are white on the ivory page
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
  dockFill: '#FFFFFF',
  fadeFrom: 'rgba(233,229,221,0)',
  fadeTo: 'rgba(233,229,221,0.82)',
  heroBlock: '#D8CDB5',
  // THERE's band is sand (not green) with deep-forest text; the page stays ivory and rises over it
  band: '#D8CDB5',
  bandIsDark: false,
  onBand: '#102F29',
  onBandMuted: 'rgba(16,47,41,0.8)',
  onBandDim: 'rgba(16,47,41,0.72)',
  onBandFaint: 'rgba(16,47,41,0.6)',
  bandLine: 'rgba(16,47,41,0.45)',
  bandSel: 'rgba(16,47,41,0.14)',
  bandChip: 'rgba(255,255,255,0.55)',
  bandBack: 'rgba(255,255,255,0.6)',
  bandTrack: 'rgba(16,47,41,0.15)',
  bandFill: '#102F29',
  bandDot: '#2F6B57',
  bandDotAlt: '#2F6B57',
  bandPin: '#2F6B57',
  placeholder: '#9B9A95',
  // the open dock tab: a soft ivory capsule with a fine rim and a faint shadow, on the white dock
  glassFill: '#F4F1E9',
  glassRim: 'rgba(16,47,41,0.07)',
  glassGlow: '#7A6E4F',
  glassShine: 'rgba(255,255,255,0.7)',
  glassEdge: 'rgba(255,255,255,0)',
  glassTint: 'rgba(238,232,218,0)',
  glassTintEnd: 'rgba(226,218,198,0.5)',
};

/** HERE: spontaneous, urban, alive (white and green). THERE: open, calm, adventurous (ivory, forest, sand). */
const modes = {
  here: { ...base, bg: '#FFFFFF', headerBg: '#FFFFFF' },
  there,
};
export type Colors = typeof modes.here;

type ThemeState = { mode: Mode; setMode: (m: Mode) => void; /** like setMode, with the full-screen colour-wave transition */ switchMode: (m: Mode) => void; /** the saved mode has been read, so `mode` is the real one */ ready: boolean; c: Colors };
const Ctx = createContext<ThemeState>({ mode: 'here', setMode: () => {}, switchMode: () => {}, ready: true, c: modes.here });
export const useTheme = () => useContext(Ctx);

/**
 * A page that belongs to one product (an activity is HERE, a trip is THERE): when it opens in the other one, flip to its
 * own, with the colour-wave. Once per visit, so a person who then switches by hand is not pulled back. This is what makes
 * a tapped alert, a push or a shared link land in the right product, whichever one the app was in.
 */
export function useEnterMode(want: Mode | undefined) {
  const { mode, switchMode, ready } = useTheme();
  const done = useRef(false);
  useEffect(() => {
    if (!want || !ready || done.current) return;
    done.current = true;
    if (mode !== want) switchMode(want);
  }, [want, ready, mode, switchMode]);
}

const KEY = 'ht_mode';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>('here');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === 'here' || v === 'there') && setModeState(v))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  }, []);

  const [moving, setMoving] = useState<Mode | null>(null);
  const switchMode = useCallback((m: Mode) => setMoving((cur) => (cur || m === mode ? cur : m)), [mode]);

  const value = useMemo(() => ({ mode, setMode, switchMode, ready, c: modes[mode] }), [mode, setMode, switchMode, ready]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {moving ? <ModeTransition target={moving} onCovered={() => setMode(moving)} onDone={() => setMoving(null)} /> : null}
    </Ctx.Provider>
  );
}
