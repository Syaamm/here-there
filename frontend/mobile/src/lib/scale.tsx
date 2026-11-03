import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';

/**
 * One size for the whole UI across phones. The design is drawn for a 390 pt wide phone; on a narrower or wider phone
 * everything (text, and the main controls) is nudged by the same factor so the screen keeps the same proportions,
 * between 90% and 110%. Tablets and desktop browsers are not scaled: they get more room instead.
 */
const BASE = 390;
export const scaleFor = (w: number) => (w >= 640 ? 1 : Math.min(1.1, Math.max(0.9, w / BASE)));

const Ctx = createContext(1);
export const useScale = () => useContext(Ctx);

/**
 * How big the writing is, as the person likes it (Settings → Text size). The design was drawn compact, which reads as
 * tiny on an iPhone, so iPhones start on "Standard" (12% bigger than the drawing); Android starts on "Compact", the
 * drawing's own size. Text and the main controls follow, but never the dock (see scBase).
 */
export type TextSize = 'compact' | 'standard' | 'large' | 'larger';
export const TEXT_SIZES: [TextSize, string, number][] = [
  ['compact', 'Compact', 1],
  ['standard', 'Standard', 1.12],
  ['large', 'Large', 1.25],
  ['larger', 'Larger', 1.4],
];
const SizeCtx = createContext<{ size: TextSize; setSize: (s: TextSize) => void }>({ size: 'standard', setSize: () => {} });
export const useTextSize = () => useContext(SizeCtx);
/** The multiplier of the chosen text size (1 on Compact). */
export const useTextBoost = () => TEXT_SIZES.find(([v]) => v === useContext(SizeCtx).size)?.[2] ?? 1;
const SIZE_KEY = 'ht_text_size';

// The same factor for code that sizes things outside a component (style objects built at render time).
let current = 1;
let currentBase = 1;
/** n points at the 390 pt design width, adjusted for this screen and the chosen text size. */
export const sc = (n: number) => Math.round(n * current * 10) / 10;
/** n points adjusted for the screen only, never the text size: the dock keeps its size whatever the writing size is. */
export const scBase = (n: number) => Math.round(n * currentBase * 10) / 10;

export function ScaleProvider({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const [size, setSizeState] = useState<TextSize>(Platform.OS === 'ios' ? 'standard' : 'compact');
  useEffect(() => {
    AsyncStorage.getItem(SIZE_KEY)
      .then((v) => (v === 'compact' || v === 'standard' || v === 'large' || v === 'larger') && setSizeState(v))
      .catch(() => {});
  }, []);
  const setSize = useCallback((s: TextSize) => {
    setSizeState(s);
    AsyncStorage.setItem(SIZE_KEY, s).catch(() => {});
  }, []);
  const boost = TEXT_SIZES.find(([v]) => v === size)?.[2] ?? 1;
  const k = scaleFor(width) * boost;
  current = k; // set while rendering, before any child reads it
  currentBase = scaleFor(width);
  return (
    <SizeCtx.Provider value={{ size, setSize }}>
      <Ctx.Provider value={k}>{children}</Ctx.Provider>
    </SizeCtx.Provider>
  );
}

/** Scales fontSize and lineHeight in a style (text without an explicit size inherits and stays as is). */
export function scaleText(style: StyleProp<TextStyle>, k: number): StyleProp<TextStyle> {
  if (k === 1 || !style) return style;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || (flat.fontSize == null && flat.lineHeight == null)) return style;
  return { ...flat, ...(flat.fontSize != null && { fontSize: flat.fontSize * k }), ...(flat.lineHeight != null && { lineHeight: flat.lineHeight * k }) };
}
