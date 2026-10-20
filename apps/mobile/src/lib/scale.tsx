import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, type StyleProp, type TextStyle } from 'react-native';

/**
 * One size for the whole UI across phones. The design is drawn for a 390 pt wide phone; on a narrower or wider phone
 * everything (text, and the main controls) is nudged by the same factor so the screen keeps the same proportions,
 * between 90% and 110%. Tablets and desktop browsers are not scaled: they get more room instead.
 */
const BASE = 390;
export const scaleFor = (w: number) => (w >= 640 ? 1 : Math.min(1.1, Math.max(0.9, w / BASE)));

const Ctx = createContext(1);
export const useScale = () => useContext(Ctx);

// The same factor for code that sizes things outside a component (style objects built at render time).
let current = 1;
/** n points at the 390 pt design width, adjusted for this screen. */
export const sc = (n: number) => Math.round(n * current * 10) / 10;

export function ScaleProvider({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const k = scaleFor(width);
  current = k; // set while rendering, before any child reads it
  return <Ctx.Provider value={k}>{children}</Ctx.Provider>;
}

/** Scales fontSize and lineHeight in a style (text without an explicit size inherits and stays as is). */
export function scaleText(style: StyleProp<TextStyle>, k: number): StyleProp<TextStyle> {
  if (k === 1 || !style) return style;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || (flat.fontSize == null && flat.lineHeight == null)) return style;
  return { ...flat, ...(flat.fontSize != null && { fontSize: flat.fontSize * k }), ...(flat.lineHeight != null && { lineHeight: flat.lineHeight * k }) };
}
