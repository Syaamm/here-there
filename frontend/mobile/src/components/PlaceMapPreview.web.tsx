import { View } from 'react-native';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

/** The web build has no native map: a soft panel holds the place of the preview. */
export function PlaceMapPreview(_props: { at: { lat: number; lng: number } | null; picked: boolean }) {
  const { c } = useTheme();
  return <View accessibilityElementsHidden importantForAccessibility="no" style={{ height: sc(170), borderRadius: sc(28), backgroundColor: c.sand }} />;
}
