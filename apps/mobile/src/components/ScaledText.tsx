import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { scaleText, useScale } from '@/lib/scale';

/** Text and TextInput that follow the screen-size scale (see lib/scale). Use these instead of the react-native ones. */
export function Text(props: TextProps) {
  const k = useScale();
  return <RNText {...props} style={scaleText(props.style, k)} />;
}

export function TextInput(props: TextInputProps) {
  const k = useScale();
  return <RNTextInput {...props} style={scaleText(props.style, k)} />;
}
