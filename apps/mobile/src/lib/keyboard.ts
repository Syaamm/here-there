import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { Animated, Dimensions, Easing, Keyboard, Platform, TextInput, type ScrollViewInstance } from 'react-native';

/** True while the on-screen keyboard is up (phones). The floating dock hides then, so its room at the bottom is given back. */
export function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

/**
 * How much of the screen's bottom the on-screen keyboard covers, as an animated number that follows the keyboard's own
 * movement. Put it as the bottom padding of a screen that ends at the bottom edge (a chat): the input then sits exactly
 * on top of the keyboard, with no guessing about offsets and no gap.
 */
export function useKeyboardInset() {
  const inset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const ios = Platform.OS === 'ios';
    const move = (to: number, ms: number) => Animated.timing(inset, { toValue: to, duration: ms, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    const subs = ios
      ? [
          // one event covers showing, hiding and the keyboard changing height (emoji, suggestions)
          Keyboard.addListener('keyboardWillChangeFrame', (e) => move(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY), e.duration || 250)),
          Keyboard.addListener('keyboardWillHide', (e) => move(0, e.duration || 250)),
        ]
      : [Keyboard.addListener('keyboardDidShow', (e) => move(e.endCoordinates.height, 120)), Keyboard.addListener('keyboardDidHide', () => move(0, 120))];
    return () => subs.forEach((s) => s.remove());
  }, [inset]);
  return inset;
}

let keyboardHeight = 0; // how tall the keyboard is right now (0 when it is down)
let sheetsOpen = 0; // pop-up sheets showing: while one is, the page behind it must not scroll for a field that is in the sheet
const focusListeners = new Set<() => void>();
/** Called by every text field when it gets focus, so a page can scroll it into view. */
export const notifyInputFocus = () => focusListeners.forEach((f) => f());

/**
 * Keeps the text field you are typing in above the keyboard. The page ends at the bottom of the screen and is padded by
 * the keyboard's height (useKeyboardInset), so it is the visible part above the keyboard that scrolls: when a field
 * gets focus, or the keyboard comes up under it, the page scrolls just far enough to show it with some air below.
 * `active` is false for a page that is not the one on screen, so hidden pages never scroll. A pop-up sheet passes
 * `inSheet`: it scrolls for its own fields, and while it is open the page behind stays still.
 */
export function useScrollFieldIntoView(scroller: RefObject<ScrollViewInstance | null>, offset: MutableRefObject<number>, active: boolean, inSheet = false) {
  useEffect(() => {
    if (Platform.OS === 'web' || !active) return;
    if (inSheet) sheetsOpen++;
    const reveal = () => {
      if (!keyboardHeight) return;
      if (sheetsOpen > 0 && !inSheet) return;
      const input = TextInput.State.currentlyFocusedInput?.();
      if (!input) return;
      input.measureInWindow((_x, y, _w, h) => {
        const keyboardTop = Dimensions.get('window').height - keyboardHeight;
        const hidden = y + h + 28 - keyboardTop; // how much of the field (plus a little air) is under the keyboard
        if (hidden > 0) scroller.current?.scrollTo({ y: offset.current + hidden, animated: true });
      });
    };
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardHeight = e.endCoordinates.height;
      setTimeout(reveal, 40);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeight = 0;
    });
    const onFocus = () => setTimeout(reveal, 90); // moving from one field to the next while the keyboard stays up
    focusListeners.add(onFocus);
    return () => {
      if (inSheet) sheetsOpen--;
      show.remove();
      hide.remove();
      focusListeners.delete(onFocus);
    };
  }, [scroller, offset, active, inSheet]);
}

/**
 * Turns whatever is typed into a date as YYYY-MM-DD: digits only, dashes put in by themselves. Works with the plain
 * number keypad (the punctuation keypad exists only on iPhones, so Android showed ordinary letters).
 */
export function formatDay(input: string) {
  const d = input.replace(/\D/g, '').slice(0, 8);
  return d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
}
