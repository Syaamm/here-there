import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { post } from '@/lib/api';
import { alertRoute } from '@/lib/alerts';
import { useT } from '@/lib/i18n';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';
import { bumpUnread, refreshUnread } from '@/lib/unread';
import { Txt } from './ui';

import { sc, sp } from '@/lib/scale';
type Shown = { id: string; type: string; title: string; body: string; data: Parameters<typeof alertRoute>[0]['data']; product: 'here' | 'there' };

const SHOW_MS = 7000;

/**
 * An alert for the OTHER product arrives while the app is open (a HERE join request while you browse trips): a banner at
 * the top says so. Tapping it opens the thing; the page flips the app to its own product by itself (useEnterMode).
 * Alerts for the product you are in are not announced here: they appear in that product's inbox as always.
 * (When the app is closed or in the background the same alert comes as a push, and tapping that does the same.)
 */
export function AlertBanner() {
  const { t } = useT();
  const { c, mode, switchMode } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [n, setN] = useState<Shown | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(({ finished }) => finished && setN(null));
  };

  useLiveEvents((e) => {
    if (e.type !== 'notification') return;
    const { id, type, title, body, data } = e.notification;
    const d = data as Shown['data'];
    // chat messages keep to the Chats tab and the badge; only alerts that belong to the other product are announced
    if (type === 'chat_message' || !d?.product || d.product === mode) return;
    if (timer.current) clearTimeout(timer.current);
    setN({ id, type, title, body, data: d, product: d.product });
    AccessibilityInfo.announceForAccessibility(`${title}. ${body}`);
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    timer.current = setTimeout(hide, SHOW_MS);
  });
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!n) return null;
  const name = n.product.toUpperCase();
  const open = () => {
    const shown = n;
    hide();
    bumpUnread(-1); // opening it reads it
    void post(`/v1/notifications/${shown.id}/read`).then(refreshUnread, () => undefined);
    const to = alertRoute(shown);
    // the colour fade plays first and the page opens once it has covered the screen, so it is never seen before the switch
    if (to) switchMode(shown.product, () => router.push(to as never));
  };
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{ position: 'absolute', top: insets.top + 8, left: sc(12), right: sc(12), alignItems: 'center', zIndex: 1100, elevation: 24, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${n.title}. ${n.body}. ${t('Open in {name}', { name })}`}
        onPress={open}
        style={({ pressed }) => [
          { width: '100%', maxWidth: sc(440), flexDirection: 'row', gap: sp(12), alignItems: 'center', padding: sp(12), borderRadius: sc(18), backgroundColor: c.forest, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: sc(4) } },
          pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
        ]}
      >
        <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: sc(38), height: sc(38), borderRadius: sc(12), backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="notifications-outline" size={sc(18)} color="#fff" />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="h3" color="#fff" numberOfLines={1} style={{ fontSize: 16, lineHeight: 21 }}>{n.title}</Txt>
          <Txt variant="small" color="rgba(255,255,255,0.85)" numberOfLines={2} style={{ lineHeight: 17 }}>{n.body}</Txt>
          <Txt variant="label" color="rgba(255,255,255,0.7)" style={{ fontSize: 12, marginTop: 2 }}>{t('Open in {name}', { name })}</Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Dismiss')} hitSlop={12} onPress={hide}>
          <Ionicons name="close" size={sc(18)} color="rgba(255,255,255,0.8)" />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}
