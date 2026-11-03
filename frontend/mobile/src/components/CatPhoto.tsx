import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { catColor, CAT_IMAGES } from '@/lib/constants';

/** A category's photo as a cropped block (the tint shows while it loads). Children are drawn on top. */
export function CatPhoto({ category, style, children }: { category: string; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const src = CAT_IMAGES[category];
  return (
    <View style={[{ backgroundColor: catColor(category), overflow: 'hidden' }, style]}>
      {src ? <Image source={src} contentFit="cover" accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} /> : null}
      {children}
    </View>
  );
}
