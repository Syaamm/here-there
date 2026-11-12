import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';

/**
 * One size for the whole UI across phones. The design is drawn for a 390 pt wide phone; on a narrower or wider phone
 * everything (text, and the main controls) is nudged by the same factor so the screen keeps the same proportions,
 * between 90% and 110%. Tablets and desktop browsers are not scaled: they get more room instead.
 */
const BASE = 390;
/** Negative letter spacing for big bold titles: the same on both platforms (the same Inter files are used on both). */
export const tracking = (n: number) => n;
export const scaleFor = (w: number) => (w >= 640 ? 1 : Math.min(1.1, Math.max(0.9, w / BASE)));

const Ctx = createContext(1);
export const useScale = () => useContext(Ctx);
const TextCtx = createContext(1);
/** The factor writing is drawn at (the controls' factor, and for "More compact" a smaller one for the words themselves). */
export const useTextScale = () => useContext(TextCtx);

/**
 * How big the writing is, as the person likes it (Settings → Text size), on top of the phone's own Large Text setting (which the
 * app follows, up to 1.3 times; see ScaledText). The default for every phone, iPhone and Android, is "More compact": it is how the
 * app looked on the owner's iPhone XS with its text size at the smallest (controls as in Standard, writing drawn at 82% of its
 * size), so a phone left at its normal text size shows the app like that. Text and the main controls follow the choice, but never the dock (see scBase).
 */
export type TextSize = 'compact' | 'medium' | 'large';
export const TEXT_SIZES: [TextSize, string, number][] = [
  ['compact', 'Compact', 1.12], // what used to be "More compact"
  ['medium', 'Medium', 1], // what used to be "Compact"
  ['large', 'Large', 1.12], // what used to be "Standard"
];
/**
 * Writing is drawn at this fraction of its size on top of the choice (only "More compact" shrinks it). 0.73: close to the app as it
 * looks on the owner's iPhone with its text size at the smallest (0.82 x 0.82 = 0.67), a little bigger, so a phone left at its
 * normal text size shows compact writing. Controls are not shrunk: the phone's text size never moved them.
 */
const TEXT_SHRINK: Partial<Record<TextSize, number>> = { compact: 0.73 };
const SizeCtx = createContext<{ size: TextSize; setSize: (s: TextSize) => void }>({ size: 'compact', setSize: () => {} });
export const useTextSize = () => useContext(SizeCtx);
/** The multiplier of the chosen text size (1 on Compact). */
export const useTextBoost = () => TEXT_SIZES.find(([v]) => v === useContext(SizeCtx).size)?.[2] ?? 1;
const SIZE_KEY = 'ht_text_size_v2'; // v1 had five sizes with other names; its choice is moved over once below
const OLD_KEY = 'ht_text_size';
const OLD_TO_NEW: Record<string, TextSize> = { 'more-compact': 'compact', compact: 'medium', standard: 'large', large: 'large', larger: 'large' };

// The same factor for code that sizes things outside a component (style objects built at render time).
let current = 1;
let currentBase = 1;
/** n points at the 390 pt design width, adjusted for this screen and the chosen text size. */
export const sc = (n: number) => Math.round(n * current * 10) / 10;
/** n points adjusted for the screen only, never the text size: the dock keeps its size whatever the writing size is. */
export const scBase = (n: number) => Math.round(n * currentBase * 10) / 10;

export function ScaleProvider({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const [size, setSizeState] = useState<TextSize>('compact');
  useEffect(() => {
    AsyncStorage.getItem(SIZE_KEY)
      .then(async (v) => {
        if (v === 'compact' || v === 'medium' || v === 'large') return setSizeState(v);
        const old = await AsyncStorage.getItem(OLD_KEY);
        if (old && OLD_TO_NEW[old]) setSizeState(OLD_TO_NEW[old]);
      })
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
      <Ctx.Provider value={k}>
        <TextCtx.Provider value={k * (TEXT_SHRINK[size] ?? 1)}>{children}</TextCtx.Provider>
      </Ctx.Provider>
    </SizeCtx.Provider>
  );
}

/**
 * How much smaller the chat (and anything else that asks) is drawn on a phone narrower than the 390 pt design: 1 from 390 up,
 * 0.96 at 375, 0.92 at 360 and never below 0.82 (320). Only for what asks for it; the rest of the app is as before.
 */
export function useSmallPhoneShrink() {
  const { width } = useWindowDimensions();
  return width >= 390 || width >= 640 ? 1 : Math.max(0.82, Math.round((width / 390) * 100) / 100);
}

/** Inside it all writing (and what follows the app's scale) is `factor` times its size. Changes nothing outside it. */
export function ScaleScope({ factor, children }: { factor: number; children: ReactNode }) {
  const k = useScale();
  const tk = useTextScale();
  return factor === 1 ? <>{children}</> : <Ctx.Provider value={k * factor}><TextCtx.Provider value={tk * factor}>{children}</TextCtx.Provider></Ctx.Provider>;
}

/** Scales fontSize and lineHeight in a style (text without an explicit size inherits and stays as is). */
export function scaleText(style: StyleProp<TextStyle>, k: number): StyleProp<TextStyle> {
  if (k === 1 || !style) return style;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || (flat.fontSize == null && flat.lineHeight == null)) return style;
  return { ...flat, ...(flat.fontSize != null && { fontSize: flat.fontSize * k }), ...(flat.lineHeight != null && { lineHeight: flat.lineHeight * k }) };
}
