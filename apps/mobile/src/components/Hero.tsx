import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAT_IMAGES } from '@/lib/constants';
import { useTheme } from '@/lib/theme';

/** White rounded-square button that floats on top of a hero image. */
export function FloatingButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 }}
    >
      <Ionicons name={icon} size={22} color="#102F29" />
    </Pressable>
  );
}

/**
 * The picture area at the top of a detail screen: a coloured block (a stand-in until real photos exist) with a floating
 * back button, an optional action on the right (the ⋯ menu), and an optional emoji. Full-bleed on phones.
 */
export function Hero({ color, emoji, category, right, height = 220, rounded, plain }: { color: string; /** the page has its own header bar above, so no floating back / menu buttons and no extra top space */ plain?: boolean; emoji?: string; /** show this category's photo instead of the plain block */ category?: string; right?: ReactNode; height?: number; rounded?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={{ height: height + (rounded || plain ? 0 : Math.max(insets.top, 20)), backgroundColor: color, borderRadius: rounded ? 24 : 0, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }}>
      {category && CAT_IMAGES[category] ? <Image source={CAT_IMAGES[category]} resizeMode="cover" accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} /> : null}
      {emoji && !(category && CAT_IMAGES[category]) ? (
        <Text style={{ fontSize: 72, opacity: 0.45 }} accessibilityElementsHidden>
          {emoji}
        </Text>
      ) : null}
      {plain ? null : (
        <View style={{ position: 'absolute', left: 16, right: 16, top: rounded ? 16 : Math.max(insets.top, 20) + 12, flexDirection: 'row', justifyContent: 'space-between' }}>
          <FloatingButton icon="chevron-back" label="Go back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          {right}
        </View>
      )}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 1, backgroundColor: c.line, opacity: rounded ? 0 : 1 }} />
    </View>
  );
}
