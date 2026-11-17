import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from 'react-native';
import { ageGroupLabel, catColor, CAT_IMAGES, CATS } from '@/lib/constants';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';

/** A small dark tag for a card's age group ("All ages", "18–25"…): laid over a corner of the card's picture. */
export function AgeBadge({ age, top }: { age?: string | null; top?: boolean }) {
  const { t } = useT();
  if (!age) return null;
  return (
    <View pointerEvents="none" accessibilityLabel={`${t('Age group')}: ${t(ageGroupLabel(age))}`} style={{ position: 'absolute', left: sc(5), ...(top ? { top: sc(5) } : { bottom: sc(5) }), backgroundColor: 'rgba(8,20,17,0.72)', borderRadius: sc(999), paddingHorizontal: sc(7), paddingVertical: sc(2) }}>
      <Text numberOfLines={1} style={{ color: '#fff', fontSize: 10, lineHeight: 14, fontWeight: '600' }}>{t(ageGroupLabel(age))}</Text>
    </View>
  );
}

/** A category's photo as a cropped block (the tint shows while it loads). Children are drawn on top. */
export function CatPhoto({ category, style, children, age, ageTop }: { category: string; style?: StyleProp<ViewStyle>; children?: ReactNode; /** the activity's age group: shown as a small tag on the picture */ age?: string | null; ageTop?: boolean }) {
  const src = CAT_IMAGES[category];
  return (
    <View style={[{ backgroundColor: catColor(category), overflow: 'hidden' }, style]}>
      {src ? <Image source={src} contentFit="cover" accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} /> : null}
      {!src && CATS[category]?.emoji ? <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 28, opacity: 0.9 }}>{CATS[category].emoji}</Text></View> : null}
      {children}
      <AgeBadge age={age} top={ageTop} />
    </View>
  );
}
