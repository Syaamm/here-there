import type { Ref } from 'react';
import { Platform, Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { notifyInputFocus } from '@/lib/keyboard';
import { scaleText, useScale } from '@/lib/scale';

/** Text and TextInput that follow the screen-size scale (see lib/scale). Use these instead of the react-native ones. */
// The phone's own font-size setting is applied on top of the app's Text size; capped so the band, chips, pills and dock never break.
const MAX_FONT_SCALE = 1.3;
// Android adds extra space above and below the letters, which sits text off-centre in pills and buttons; iOS does not.
const androidText = Platform.OS === 'android' ? ({ includeFontPadding: false, textAlignVertical: 'center' } as const) : null;

export function Text(props: TextProps) {
  const k = useScale();
  const style = scaleText(props.style, k);
  return <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} style={androidText ? [androidText, style] : style} />;
}

/** What a ref to a TextInput here gives you (focus, blur, clear...). */
export type InputHandle = { focus: () => void; blur: () => void; clear: () => void; isFocused: () => boolean };

/** `ref` is passed on to the real input (React 19 hands it over as a prop). */
export function TextInput(props: TextInputProps & { ref?: Ref<any> }) {
  const k = useScale();
  return (
    <RNTextInput
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...props}
      onFocus={(e) => {
        notifyInputFocus(); // a page may need to scroll this field above the keyboard
        props.onFocus?.(e);
      }}
      style={scaleText(props.style, k)}
    />
  );
}
