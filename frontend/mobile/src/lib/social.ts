import { Platform } from 'react-native';
import { get } from '@/lib/api';

/**
 * "Continue with Apple / Google": gets the provider's signed identity token on the phone. The API checks it (POST /v1/auth/social).
 *
 * Both libraries are native code: they exist only in a development or store build (not Expo Go, not the browser preview). They are
 * loaded on demand so the rest of the app still starts where they are missing, and the buttons then simply stay hidden.
 *
 * Google needs the OAuth client ids from Google Cloud console > Credentials, as build settings (EAS environment variables, not secret):
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID   the Web client: the identity token is made for this one
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID   the iOS client (iPhone only)
 * (the Android client is found by package name and signing key, no setting here). All three must also be in the API's GOOGLE_CLIENT_IDS.
 * The iPhone build also needs GOOGLE_IOS_URL_SCHEME (see app.config.ts).
 */
const googleWeb = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
const googleIos = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();

export type SocialProvider = 'apple' | 'google';
/** What the phone got from the provider. `name` is only ever sent by Apple, and only the very first time. */
export type SocialToken = { idToken: string; name?: string };

const native = Platform.OS === 'ios' || Platform.OS === 'android';

function apple() {
  try {
    return require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  } catch {
    return null;
  }
}

function google() {
  try {
    const m = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
    return m?.GoogleSignin ? m : null;
  } catch {
    return null;
  }
}

/**
 * Which buttons to show: the API has the provider switched on AND this phone can do it. Apple's rule: where Google is offered on an
 * iPhone, "Continue with Apple" must be offered too, so on iPhone Google only shows together with Apple.
 */
export async function availableProviders(): Promise<Record<SocialProvider, boolean>> {
  const off = { apple: false, google: false };
  if (!native) return off;
  try {
    const on = await get<{ apple: boolean; google: boolean }>('/v1/auth/social/providers');
    const A = Platform.OS === 'ios' ? apple() : null;
    const hasApple = !!(on.apple && A && (await A.isAvailableAsync().catch(() => false)));
    const hasGoogle = !!(on.google && google() && googleWeb && (Platform.OS === 'android' || (googleIos && hasApple)));
    return { apple: hasApple, google: hasGoogle };
  } catch {
    return off; // no answer: no buttons, the email form still works
  }
}

/** The Apple sheet. Returns null when the person closes it. */
export async function appleToken(): Promise<SocialToken | null> {
  const A = apple();
  if (!A) return null;
  try {
    const cred = await A.signInAsync({ requestedScopes: [A.AppleAuthenticationScope.FULL_NAME, A.AppleAuthenticationScope.EMAIL] });
    if (!cred.identityToken) return null;
    const name = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ').trim();
    return { idToken: cred.identityToken, name: name.length >= 2 ? name.slice(0, 40) : undefined };
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return null;
    throw e;
  }
}

/** The Google sheet. Returns null when the person closes it. */
export async function googleToken(): Promise<SocialToken | null> {
  const m = google();
  if (!m) return null;
  m.GoogleSignin.configure({ webClientId: googleWeb, ...(googleIos ? { iosClientId: googleIos } : {}) });
  try {
    if (Platform.OS === 'android') await m.GoogleSignin.hasPlayServices();
    const r = await m.GoogleSignin.signIn();
    if (r.type !== 'success' || !r.data.idToken) return null;
    return { idToken: r.data.idToken };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === m.statusCodes.SIGN_IN_CANCELLED || code === m.statusCodes.IN_PROGRESS) return null;
    throw e;
  }
}
