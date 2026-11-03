import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onToast, type ToastMessage } from '@/lib/toast';
import { useTheme } from '@/lib/theme';
import { Txt } from './ui';

const SHOW_MS = 3000;

/** The small notice at the top of the screen. It slides in, stays 3 seconds, then fades away. It never takes touches. */
export function Toast() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [t, setT] = useState<ToastMessage | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () =>
      onToast((next) => {
        if (timer.current) clearTimeout(timer.current);
        setT(next);
        AccessibilityInfo.announceForAccessibility(next.text);
        fade.setValue(0);
        Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
        timer.current = setTimeout(() => {
          Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(({ finished }) => finished && setT(null));
        }, next.ms ?? SHOW_MS);
      }),
    [fade],
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!t) return null;
  const bad = t.tone === 'error';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, alignItems: 'center', zIndex: 1000, elevation: 20 }}>
      <Animated.View
        accessibilityLiveRegion="polite"
        style={{
          opacity: fade,
          transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          maxWidth: 420,
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: bad ? c.danger : c.forest,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}
      >
        <Ionicons name={bad ? 'alert-circle-outline' : 'checkmark-circle-outline'} size={16} color="#fff" />
        <Txt variant="h3" color="#fff" style={{ fontSize: 12, lineHeight: 16, flexShrink: 1 }}>{t.text}</Txt>
      </Animated.View>
    </View>
  );
}
