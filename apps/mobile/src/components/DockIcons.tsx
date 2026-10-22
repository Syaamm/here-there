import Svg, { Circle, Path } from 'react-native-svg';

type Props = { size: number; color: string; focused: boolean };

/**
 * The dock's hand-drawn icons: Home (rounded house with a smile), Search (thin lens) and Message (round bubble with
 * three dots). Outline when idle, solid when the tab is open; the smile and the dots are cut out of the solid shape.
 */
export function HomeIcon({ size, color, focused }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.4 3.1a2.6 2.6 0 0 1 3.2 0l5.6 4.3c.7.5 1.1 1.4 1.1 2.3v6.6a3.2 3.2 0 0 1-3.2 3.2H6.9a3.2 3.2 0 0 1-3.2-3.2V9.7c0-.9.4-1.8 1.1-2.3z"
        fill={focused ? color : 'none'}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path d="M9.3 14.4c.7.9 1.7 1.4 2.7 1.4s2-.5 2.7-1.4" stroke={focused ? '#fff' : color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function SearchIcon({ size, color, focused }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.6} cy={10.6} r={6.6} stroke={color} strokeWidth={focused ? 2.1 : 1.6} />
      <Path d="M15.6 15.6 20.6 20.6" stroke={color} strokeWidth={focused ? 2.1 : 1.6} strokeLinecap="round" />
    </Svg>
  );
}

export function MessageIcon({ size, color, focused }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3.2c-4.9 0-8.8 3.5-8.8 7.9 0 2.1.9 4 2.4 5.4-.1 1-.5 2-1.2 2.8-.2.3 0 .7.4.7 1.5 0 2.8-.5 3.8-1.2.9.3 2.4.6 3.4.6 4.9 0 8.8-3.5 8.8-7.9S16.9 3.2 12 3.2z"
        fill={focused ? color : 'none'}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Circle cx={8.4} cy={11.2} r={1.1} fill={focused ? '#fff' : color} />
      <Circle cx={12} cy={11.2} r={1.1} fill={focused ? '#fff' : color} />
      <Circle cx={15.6} cy={11.2} r={1.1} fill={focused ? '#fff' : color} />
    </Svg>
  );
}
