import Svg, { Ellipse, Path } from 'react-native-svg';

/**
 * The LAMIS mark (the "l" with the sage dot), drawn from the logo file, so it is sharp at any size. The same mark is the app
 * icon, so the loading screen continues straight from the icon that was tapped. `size` is the height in points.
 */
export function LamisMark({ size = 56, ink, dot = '#9CB397' }: { size?: number; ink: string; dot?: string }) {
  // the logo's own drawing ("dot monogram", 160 x 238)
  return (
    <Svg width={(size * 160) / 238} height={size} viewBox="0 0 160 238" accessibilityRole="image" accessibilityLabel="LAMIS">
      <Path d="M0 184.423V15.0374C6.62827e-06 6.7325 6.74788 0 15.0718 0H39.5865C47.9104 0 54.6583 6.73249 54.6583 15.0374V184.423C55.9834 188.72 62.5094 196.917 80 195.331V234H57.6397C31.7892 233.008 2.96972 225.076 0 184.423Z" fill={ink} />
      <Ellipse cx="128.5" cy="206" rx="31.5" ry="32" fill={dot} />
    </Svg>
  );
}
