import { useFonts } from 'expo-font';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import type { TextStyle } from 'react-native';

/**
 * The app's one typeface: Inter (the design's font, docs/DESIGN.md page 39), the same on iPhone and Android, instead of each
 * phone's own system font. Each weight is its own font file (Android cannot make a custom font bolder by itself), so a text's
 * weight picks the file: 400 Regular, 500 Medium, 600 SemiBold, 700 Bold, the four weights of the design's type guide. Lighter
 * weights use Regular; heavier ones (800, 900) use Bold, so no heading is heavier than the design. Only these four files are in the app.
 */
const FILES = {
  Satoshi_400Regular: require('../../assets/fonts/Satoshi-Regular.ttf'),
  Satoshi_500Medium: require('../../assets/fonts/Satoshi-Medium.ttf'),
  Satoshi_700Bold: require('../../assets/fonts/Satoshi-Bold.ttf'),
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
};

// until the font files are loaded (or if loading failed) text keeps the phone's own font, so nothing ever shows blank
let interReady = false;

/** Loads the font files once, at start (the root layout waits for it). True once loaded, or once it has failed. */
export function useAppFonts() {
  const [loaded, error] = useFonts(FILES);
  if (loaded) interReady = true;
  return loaded || !!error;
}

/** The Inter file for a weight ('600', 'bold', 600...). */
export function interFamily(weight: TextStyle['fontWeight']): string | undefined {
  if (!interReady) return undefined;
  const w = weight === 'bold' ? 700 : weight == null || weight === 'normal' ? 400 : Number(weight) || 400;
  if (w >= 700) return 'Inter_700Bold';
  if (w >= 600) return 'Inter_600SemiBold';
  if (w >= 500) return 'Inter_500Medium';
  return 'Inter_400Regular';
}

/** Style for a text drawn outside the app's Text (a tab label, a wheel): the Inter file for the weight, with no extra bolding on top. */
export function fontOf(weight: TextStyle['fontWeight']): TextStyle {
  const fontFamily = interFamily(weight);
  return fontFamily ? { fontFamily, fontWeight: 'normal' } : { fontWeight: weight };
}

/**
 * Satoshi for headlines, brand and UI (bold / large text); Inter stays for body, interface and long text.
 * Set USE_SATOSHI to false to go straight back to Inter everywhere (or restore backup/satoshi-v1).
 */
export const USE_SATOSHI = true;

/** The Satoshi file for a text, or undefined when Inter should be used. Headline = weight 600+ or size 20+. */
export function satoshiFamily(weight: TextStyle['fontWeight'], size?: number): string | undefined {
  if (!USE_SATOSHI || !interReady) return undefined;
  const w = weight === 'bold' ? 700 : weight == null || weight === 'normal' ? 400 : Number(weight) || 400;
  if (w < 600 && !(size != null && size >= 20)) return undefined;
  if (w >= 600) return 'Satoshi_700Bold';
  return w >= 500 ? 'Satoshi_500Medium' : 'Satoshi_400Regular';
}
