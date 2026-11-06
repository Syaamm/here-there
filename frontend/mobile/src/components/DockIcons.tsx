import { useContext, useEffect } from 'react';
import { Animated, View, type ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { DOCK, DockFillContext, useAnim } from '@/lib/dock';
import { useMe } from '@/lib/auth';
import { useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';
import { Avatar } from '@/components/ui';

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

/**
 * Dock icon: an outline when idle, solid when its tab is open. The swap is instant. Inside the dock the button sets `fill`
 * from the tap itself; `render(true)` is the solid icon.
 */
function TabGlyph({ size, focused, render }: { size: number; focused: boolean; render: (solid: boolean) => React.ReactElement }) {
  const own = useAnim(focused ? 1 : 0); // 0 outline .. 1 solid
  const shared = useContext(DockFillContext);
  const fill = shared ?? own;
  useEffect(() => {
    if (!shared) own.setValue(focused ? 1 : 0);
  }, [focused, shared, own]);
  const layer = { position: 'absolute', left: 0, top: 0, width: size, height: size } as const;
  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={{ ...layer, opacity: fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>{render(false)}</Animated.View>
      <Animated.View style={{ ...layer, opacity: fill }}>{render(true)}</Animated.View>
    </View>
  );
}

type Custom = (p: Props) => React.ReactElement;
/** Tab icon from one of the hand-drawn SVGs above, all at the one dock icon size. */
export const svgTabIcon = (Icon: Custom) =>
  function TabSvgIcon({ focused }: { color: ColorValue; size?: number; focused: boolean }) {
    // The solid icon appears the moment a tab is touched, before the tab bar has handed out its "open" colour, so the two
    // looks carry their own colours: the open one is never drawn in the inactive grey.
    const { c } = useTheme();
    const { isWide } = useLayout();
    const open = isWide ? c.green : c.text;
    return <TabGlyph size={DOCK.icon} focused={focused} render={(solid) => <Icon size={DOCK.icon} color={solid ? open : c.muted} focused={solid} />} />;
  };

/** Profile tab: the member's own round photo (initial when there is none), ringed while the tab is open. */
export function ProfileGlyph({ focused }: { focused: boolean }) {
  const { c } = useTheme();
  const { me } = useMe();
  const fill = useContext(DockFillContext); // set from the touch, like the other icons
  // 28 square in all: 2 ring + 1 gap + 22 photo
  return (
    <View style={{ width: DOCK.avatar, height: DOCK.avatar, borderRadius: DOCK.avatar / 2, padding: 3, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: DOCK.avatar / 2, borderWidth: 2, borderColor: c.text, opacity: fill ?? (focused ? 1 : 0) }} />
      <Avatar name={me?.profile?.displayName} uri={me?.profile?.photoUrl} size={DOCK.avatar - 6} />
    </View>
  );
}
