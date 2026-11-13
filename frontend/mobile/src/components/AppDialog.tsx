import { useEffect, useState } from 'react';
import { Alert, type AlertButton, Animated, Easing, Modal, Platform, Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useTheme } from '@/lib/theme';
import { Btn } from './ui';

import { sc, sp, sph } from '@/lib/scale';
/**
 * Pop-ups (confirmations, warnings, notices) in the app's own look on Android: Android's system dialog looks nothing like the
 * app, while iPhone's own alert is good as it is and is kept. `appAlert` takes exactly what React Native's Alert.alert takes,
 * so any Alert.alert can switch to it. The browser preview keeps the browser's dialog (lib/confirm).
 */
type Dialog = { title: string; message?: string; buttons: AlertButton[]; cancelable: boolean; onDismiss?: () => void };

let show: ((d: Dialog) => void) | null = null;
const waiting: Dialog[] = []; // asked for before the host was on screen, or while another pop-up is open

export function appAlert(title: string, message?: string, buttons?: AlertButton[], options?: { cancelable?: boolean; onDismiss?: () => void }) {
  if (Platform.OS !== 'android') return Alert.alert(title, message, buttons, options);
  const d: Dialog = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }], cancelable: options?.cancelable ?? true, onDismiss: options?.onDismiss };
  if (show) show(d);
  else waiting.push(d);
}

/** Mounted once at the root (app/_layout). Shows one pop-up at a time; the next waits its turn. */
export function DialogHost() {
  const { c } = useTheme();
  const [queue, setQueue] = useState<Dialog[]>([]);
  const fade = useState(() => new Animated.Value(0))[0];
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    show = (d) => setQueue((q) => [...q, d]);
    if (waiting.length) setQueue((q) => [...q, ...waiting.splice(0)]);
    return () => {
      show = null;
    };
  }, []);
  const d = queue[0];
  useEffect(() => {
    if (!d) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [d, fade]);
  if (Platform.OS !== 'android' || !d) return null;

  const close = (then?: () => void) => {
    setQueue((q) => q.slice(1));
    then?.();
  };
  // a tap outside or the back button: like the cancel button (or just closing when there is none)
  const dismiss = () => {
    if (!d.cancelable) return;
    const cancel = d.buttons.find((b) => b.style === 'cancel');
    close(() => (cancel?.onPress ? cancel.onPress() : d.onDismiss?.()));
  };
  // two buttons side by side (cancel on the left); three or more stacked, the main one on top and cancel last
  const row = d.buttons.length <= 2;
  const rank = (b: AlertButton) => (b.style === 'cancel' ? 2 : b.style === 'destructive' ? 1 : 0);
  const ordered = row ? [...d.buttons].sort((a, b) => (a.style === 'cancel' ? -1 : b.style === 'cancel' ? 1 : 0)) : [...d.buttons].sort((a, b) => rank(a) - rank(b));
  const variant = (b: AlertButton) => (b.style === 'cancel' ? 'secondary' : b.style === 'destructive' ? 'danger' : 'primary');

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View style={{ flex: 1, opacity: fade }}>
        <Pressable accessibilityLabel="Close" onPress={dismiss} style={{ flex: 1, backgroundColor: 'rgba(10, 24, 20, 0.45)', alignItems: 'center', justifyContent: 'center', padding: sp(28) }}>
          {/* the card itself swallows taps, so only the dimmed area around it closes the pop-up */}
          <Pressable onPress={() => undefined} accessibilityRole="alert" style={{ width: '100%', maxWidth: sc(380) }}>
            <Animated.View
              style={{
                backgroundColor: c.surface,
                borderRadius: sc(22),
                paddingHorizontal: sph(22),
                paddingTop: sp(22),
                paddingBottom: sp(18),
                gap: sp(18),
                elevation: 12,
                transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
              }}
            >
              <View style={{ gap: sp(8) }}>
                <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 27, fontWeight: '500' }}>
                  {d.title}
                </Text>
                {d.message ? <Text style={{ color: c.muted, fontSize: 16, lineHeight: 23 }}>{d.message}</Text> : null}
              </View>
              <View style={{ flexDirection: row ? 'row' : 'column', gap: sp(10) }}>
                {ordered.map((b, i) => (
                  <Btn key={`${b.text}-${i}`} title={b.text ?? 'OK'} variant={variant(b)} onPress={() => close(b.onPress ? () => b.onPress!() : undefined)} style={row ? { flex: 1 } : undefined} />
                ))}
              </View>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
