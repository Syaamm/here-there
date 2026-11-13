import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Dimensions, Platform, StyleSheet, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';

/**
 * One size for the whole UI across phones. The design is drawn for a 390 pt wide phone; on a narrower or wider phone
 * everything (text, and the main controls) is nudged by the same factor so the screen keeps the same proportions,
 * between 90% and 110%. Tablets and desktop browsers are not scaled: they get more room instead.
 */
const BASE = 390;
/** Negative letter spacing for big bold titles: the same on both platforms (the same Inter files are used on both). */
export const tracking = (n: number) => n;
// Phones: everything (writing, spacing, radii, icons, element sizes) is drawn at the SAME fraction of the 390 pt design as the screen is wide, so a
// line that fits on one phone breaks in the same place on every other one (a bigger phone is a bigger picture of the same screen; only lists show more).
// The limits keep the tiniest and the largest phones sensible. Tablets and desktop are not scaled: they get more room instead.
export const scaleFor = (w: number) => (w >= 640 ? 1 : Math.min(1.25, Math.max(0.82, w / BASE)));

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
  ['compact', 'Compact', 0.92], // the default (the smallest writing)
  ['medium', 'Medium', 1], // the design's sizes as drawn
  ['large', 'Large', 1.12],
];
/**
 * Writing is drawn at this fraction of its size on top of the choice (only "More compact" shrinks it). 0.73: close to the app as it
 * looks on the owner's iPhone with its text size at the smallest (0.82 x 0.82 = 0.67), a little bigger, so a phone left at its
 * normal text size shows compact writing. Controls are not shrunk: the phone's text size never moved them.
 */
// 1 / 1.12 (was 0.73): Compact's controls are 12% larger (TEXT_SIZES), and the writing is brought back by exactly that, so the sizes of the
// design's type guide (lib/type: body 16, caption 12...) are drawn at their real size on a 390 pt phone. Controls are not shrunk.
const TEXT_SHRINK: Partial<Record<TextSize, number>> = {}; // none any more: Medium is the design as drawn
const SizeCtx = createContext<{ size: TextSize; setSize: (s: TextSize) => void }>({ size: 'compact', setSize: () => {} });
export const useTextSize = () => useContext(SizeCtx);
/** The multiplier of the chosen text size (1 on Compact). */
export const useTextBoost = () => TEXT_SIZES.find(([v]) => v === useContext(SizeCtx).size)?.[2] ?? 1;
const SIZE_KEY = 'ht_text_size_v2'; // v1 had five sizes with other names; its choice is moved over once below
const OLD_KEY = 'ht_text_size';
const OLD_TO_NEW: Record<string, TextSize> = { 'more-compact': 'compact', compact: 'medium', standard: 'large', large: 'large', larger: 'large' };

// The same factor for code that sizes things outside a component (style objects built at render time).
let current = scaleFor(Dimensions.get('window').width); // from the first line of the app, so styles made when a file loads are already right
let currentBase = current;
/** n points at the 390 pt design width, adjusted for this screen and the chosen text size. */
export const sc = (n: number) => Math.round(n * current * 10) / 10;
/** n points adjusted for the screen only, never the text size: the dock keeps its size whatever the writing size is. */
export const scBase = (n: number) => Math.round(n * currentBase * 10) / 10;

/**
 * Breathing room. Gaps, and the padding and margins above, below and inside things, are drawn SPACE times what the 390 pt grid says, and
 * the padding at the sides SPACE_SIDE times, so screens are airy and the text is not squeezed. This is the one place to make every screen
 * more or less spacious: raise or lower these two numbers. (Sides grow less so that lines do not start to wrap.)
 */
export const SPACE = 1.25;
export const SPACE_SIDE = 1.1;
export const sp = (n: number) => sc(Math.round(n * SPACE * 10) / 10);
export const sph = (n: number) => sc(Math.round(n * SPACE_SIDE * 10) / 10);


export function ScaleProvider({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const [size, setSizeState] = useState<TextSize>('compact'); // what a phone shows until the person picks a size in Settings
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
  const k = scaleFor(width); // spacing, icons and controls follow the screen only; the writing also follows the Text size choice (below)
  current = k; // set while rendering, before any child reads it
  currentBase = scaleFor(width);
  return (
    <SizeCtx.Provider value={{ size, setSize }}>
      <Ctx.Provider value={k}>
        <TextCtx.Provider value={k * boost * (TEXT_SHRINK[size] ?? 1)}>{children}</TextCtx.Provider>
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
  void width; // the whole app is already drawn in proportion to the screen's width (see scaleFor), so nothing is shrunk twice
  return 1;
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
