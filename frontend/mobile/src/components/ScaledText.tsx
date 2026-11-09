import { useState, type Ref } from 'react';
import { Platform, StyleSheet, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { notifyInputFocus } from '@/lib/keyboard';
import { scaleText, useScale } from '@/lib/scale';

/** Text and TextInput that follow the screen-size scale (see lib/scale). Use these instead of the react-native ones. */
// The phone's own font-size setting is applied on top of the app's Text size; capped so the band, chips, pills and dock never break.
const MAX_FONT_SCALE = 1.3;
// the forest of both modes: the cursor and selection of every field (a field can still pass its own)
const FOREST = '#102F29';

/**
 * Android paints selected text with the selection colour itself: a solid colour (the forest many fields pass) covered the
 * words in a block of green. There it is made see-through, so selected text stays readable; the cursor keeps the solid colour.
 */
function softSelection(color: TextInputProps['selectionColor']) {
  if (Platform.OS !== 'android') return color ?? FOREST;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return color ?? 'rgba(16,47,41,0.25)';
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.25)`;
}
// Android adds extra space above and below the letters, which sits text off-centre in pills and buttons; iOS does not.
const androidText = Platform.OS === 'android' ? ({ includeFontPadding: false, textAlignVertical: 'center' } as const) : null;

// Without the font padding Android sets lines of text tight against each other; iOS spaces them about 1.25 times the size by itself.
// Text that has a size but no line height gets that spacing here (text that sets its own line height is left alone).
function withLineHeight(style: TextProps['style']): TextProps['style'] {
  if (Platform.OS !== 'android' || !style) return style;
  const flat = StyleSheet.flatten(style);
  if (!flat || flat.fontSize == null || flat.lineHeight != null) return style;
  return { ...flat, lineHeight: Math.round(flat.fontSize * 1.22) };
}

export function Text(props: TextProps) {
  const k = useScale();
  const style = withLineHeight(scaleText(props.style, k));
  // text on screen is never selectable (only what is typed in a field is), whatever a screen passes
  return <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} selectable={false} style={androidText ? [androidText, style] : style} />;
}

/** What a ref to a TextInput here gives you (focus, blur, clear...). */
export type InputHandle = { focus: () => void; blur: () => void; clear: () => void; isFocused: () => boolean };

/** `ref` is passed on to the real input (React 19 hands it over as a prop). */
export function TextInput(props: TextInputProps & { ref?: Ref<any> }) {
  const k = useScale();
  // the faded hint ("Say something...") goes away the moment the field is tapped and the keyboard comes up, not only once something is typed
  const [focused, setFocused] = useState(false);
  return (
    <RNTextInput
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      underlineColorAndroid="transparent"
      cursorColor={FOREST}
      {...props}
      placeholder={focused ? undefined : props.placeholder}
      selectionColor={softSelection(props.selectionColor)}
      onFocus={(e) => {
        setFocused(true);
        notifyInputFocus(); // a page may need to scroll this field above the keyboard
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      style={androidText ? [{ includeFontPadding: false }, scaleText(props.style, k)] : scaleText(props.style, k)}
    />
  );
}
