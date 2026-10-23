import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo';

/**
 * The app icon: HERE (the default) or THERE. The choice is always remembered. In an installed build it also changes the
 * real home-screen icon (a native feature). Expo Go and the browser cannot do that, so there the choice is kept and
 * shown inside the app, and the real icon changes as soon as the installed app is used.
 */
export type AppIcon = 'here' | 'there';
const ALT_NAME = 'There'; // the alternate icon declared in app.config.ts; HERE is the default icon (null)
const KEY = 'ht_app_icon';

type Native = typeof import('expo-alternate-app-icons');
function load(): Native | null {
  // Ask whether the native part exists BEFORE loading the package. Loading it without one (Expo Go, a browser) makes
  // the bundler report a fatal "cannot find native module" error that a try/catch cannot stop.
  if (!requireOptionalNativeModule('ExpoAlternateAppIcons')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-alternate-app-icons') as Native;
  } catch {
    return null;
  }
}

/** Can this device change its real home-screen icon (an installed iOS or Android build, not Expo Go or the web)? */
export function canChangeIcon(): boolean {
  try {
    return !!load()?.supportsAlternateIcons;
  } catch {
    return false;
  }
}

/** What the phone is showing right now, when it can tell. */
function nativeIcon(): AppIcon | null {
  try {
    const m = load();
    return m?.supportsAlternateIcons ? (m.getAppIconName() === ALT_NAME ? 'there' : 'here') : null;
  } catch {
    return null;
  }
}

/** The remembered choice (what the phone shows wins, where it can say). */
export async function savedIcon(): Promise<AppIcon> {
  const real = nativeIcon();
  if (real) return real;
  try {
    return (await AsyncStorage.getItem(KEY)) === 'there' ? 'there' : 'here';
  } catch {
    return 'here';
  }
}

/** Remember the choice, and change the real icon too where the device allows it. */
export async function chooseIcon(icon: AppIcon): Promise<true> {
  try {
    await AsyncStorage.setItem(KEY, icon);
  } catch {
    // not remembering is not worth failing for
  }
  if (canChangeIcon()) await load()!.setAlternateAppIcon(icon === 'there' ? ALT_NAME : null);
  return true;
}
