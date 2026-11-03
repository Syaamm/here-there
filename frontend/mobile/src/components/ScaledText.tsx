import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { notifyInputFocus } from '@/lib/keyboard';
import { scaleText, useScale } from '@/lib/scale';

/** Text and TextInput that follow the screen-size scale (see lib/scale). Use these instead of the react-native ones. */
export function Text(props: TextProps) {
  const k = useScale();
  return <RNText {...props} style={scaleText(props.style, k)} />;
}

export function TextInput(props: TextInputProps) {
  const k = useScale();
  return (
    <RNTextInput
      {...props}
      onFocus={(e) => {
        notifyInputFocus(); // a page may need to scroll this field above the keyboard
        props.onFocus?.(e);
      }}
      style={scaleText(props.style, k)}
    />
  );
}
