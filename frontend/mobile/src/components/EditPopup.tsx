import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Keyboard, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type HostInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardOverlap, keyboardTaps } from '@/lib/keyboard';
import { useTheme } from '@/lib/theme';

/** Where the pop-up grows from and shrinks back into: the card that was tapped, in window coordinates. */
export type Origin = { x: number; y: number; width: number; height: number };

// quick off the mark and gently into place (open), smooth both ends (close)
const easeOpen = Easing.bezier(0.2, 0.9, 0.1, 1);
const easeClose = Easing.bezier(0.4, 0, 0.2, 1);

/**
 * An editing window that grows out of a card and folds back into it. The window's plain background is reshaped between the
 * card's exact box (place, width and height) and the window's own, fading in as it leaves the card and out as it lands, so the
 * real card (a photo too) shows through at both ends with no colour laid over it. The contents fade in once it is mostly open
 * and out first when closing. Where the window sits
 * is measured (status bar, navigation bar and keyboard all move it), on opening and again on closing. Opacity and transform
 * only, on the native driver (smooth on Android).
 * The form is edited live, so closing keeps the changes: Done, a tap on the dimmed page and Android's back button all call
 * `onDone` (which sets `closing`); `onClosed` runs once it has folded away. `header` is the window's top row (Done).
 */
export function EditPopup({ from, header, onDone, onClosed, closing, children, overlay }: { from: Origin; header: ReactNode; onDone: () => void; onClosed: () => void; /** true plays the fold, then onClosed */ closing: boolean; children: ReactNode; /** something that fills the screen over the window (a calendar sheet): it has to live inside this pop-up, since a sheet on the page below would be hidden behind it */ overlay?: ReactNode }) {
  const { c } = useTheme();
  const { width: W, height: H } = useWindowDimensions();
  const { inset: keyboard, box, onLayout } = useKeyboardOverlap(); // the window moves up above the keyboard and shrinks to fit
  const insets = useSafeAreaInsets();
  const width = Math.min(W - 32, 560);
  const v = useRef(new Animated.Value(0)).current; // 0 = the card, 1 = the open window
  // the card against the window: centre offset and size ratio (set from measurements, no re-render)
  const dx = useRef(new Animated.Value(0)).current;
  const dy = useRef(new Animated.Value(0)).current;
  const sx = useRef(new Animated.Value(1)).current;
  const sy = useRef(new Animated.Value(1)).current;
  const place = useRef<HostInstance>(null); // the window's frame, never transformed, to measure
  const opened = useRef(false);

  const aim = (then: () => void) =>
    place.current?.measureInWindow((x, y, w, h) => {
      dx.setValue(from.x + from.width / 2 - (x + w / 2));
      dy.setValue(from.y + from.height / 2 - (y + h / 2));
      sx.setValue(from.width / Math.max(1, w));
      sy.setValue(from.height / Math.max(1, h));
      then();
    });
  const run = (to: 0 | 1, done?: () => void) => Animated.timing(v, { toValue: to, duration: to ? 320 : 280, easing: to ? easeOpen : easeClose, useNativeDriver: true }).start(() => done?.());

  const open = () => {
    if (opened.current) return;
    opened.current = true;
    aim(() => run(1));
  };
  useEffect(() => {
    if (!closing) return;
    const fold = () => aim(() => run(0, onClosed));
    if (!Keyboard.isVisible()) return void fold();
    // the window drops as the keyboard goes down: aim once it has settled (or after a moment, if the phone never says so)
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      clearTimeout(timer);
      sub.remove();
      fold();
    });
    const timer = setTimeout(() => {
      sub.remove();
      fold();
    }, 450);
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [closing]);

  const card = Animated.subtract(1, v); // 1 at the card, 0 open
  const toward = (ratio: Animated.Value) => Animated.add(Animated.multiply(Animated.subtract(ratio, 1), card), 1);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onDone} statusBarTranslucent navigationBarTranslucent>
      <Animated.View ref={box} onLayout={onLayout} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top + 12, paddingBottom: Animated.add(keyboard, insets.bottom + 12) }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.4)', opacity: v }]}>
          <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={onDone} />
        </Animated.View>
        <View ref={place} onLayout={open} collapsable={false} style={{ width, maxHeight: H * 0.82, flexShrink: 1 }}>
          {/* the window's background: reshaped between the card's box and its own; see-through at the card, so the card itself shows */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: c.bg,
                borderRadius: 26,
                opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
                transform: [{ translateX: Animated.multiply(dx, card) }, { translateY: Animated.multiply(dy, card) }, { scaleX: toward(sx) }, { scaleY: toward(sy) }],
              },
            ]}
          />
          {/* the contents: in once the window is mostly open, out first when it folds */}
          <Animated.View style={{ flexShrink: 1, opacity: v.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, 1] }) }}>
            <View style={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8 }}>{header}</View>
            <ScrollView keyboardShouldPersistTaps={keyboardTaps} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 20, gap: 14 }}>
              {children}
            </ScrollView>
          </Animated.View>
        </View>
        {overlay}
      </Animated.View>
    </Modal>
  );
}
