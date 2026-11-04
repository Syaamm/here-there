import { Platform } from 'react-native';

// Touch feedback. expo-haptics is loaded lazily and every call is guarded: it does nothing on the web or where the phone has no
// haptic motor, so a screen can call it without checking anything.
let haptics: typeof import('expo-haptics') | null = null;
try {
  if (Platform.OS !== 'web') haptics = require('expo-haptics');
} catch {
  haptics = null;
}

/** A small tap (Light) for ordinary controls, a firmer one (Medium) for the main action of a screen. */
export const tap = (kind: 'Light' | 'Medium' = 'Light') => {
  try {
    void haptics?.impactAsync(haptics.ImpactFeedbackStyle[kind]);
  } catch {
    /* no haptics here */
  }
};
