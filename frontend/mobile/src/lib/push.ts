import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { api } from './api';
import { t } from './i18n';

type NotificationsModule = typeof import('expo-notifications');
let notificationsModule: NotificationsModule | null | undefined;
/** The phone's notifications module, or null where it is missing (Expo Go on some Android versions): importing it up front would crash the whole app. */
function loadNotifications(): NotificationsModule | null {
  if (notificationsModule === undefined) {
    // Expo Go on Android has no push support at all, so do not even try to load it there
    if (Platform.OS === 'android' && Constants.executionEnvironment === 'storeClient') return (notificationsModule = null);
    try {
      notificationsModule = require('expo-notifications') as NotificationsModule;
    } catch {
      notificationsModule = null;
    }
  }
  return notificationsModule;
}

type FirebaseModule = typeof import('@react-native-firebase/messaging');
let firebaseModule: FirebaseModule | null | undefined;
/**
 * Firebase messaging (FCM, the way phone push is sent for both iPhone and Android), or null where it is not in the app: Expo Go,
 * the browser, or a build made without the Firebase files (google-services.json / GoogleService-Info.plist). Everything that
 * needs it falls back to Expo's push route in that case, so the app keeps working everywhere.
 */
function loadFirebase(): FirebaseModule | null {
  if (firebaseModule === undefined) {
    if (Platform.OS === 'web' || Constants.executionEnvironment === 'storeClient' || Constants.appOwnership === 'expo') return (firebaseModule = null);
    try {
      // Firebase's native part is not in Expo Go or in builds made without it: check before loading, because loading it there throws
      if (!TurboModuleRegistry.get('NativeRNFBTurboApp') && !NativeModules.RNFBAppModule) return (firebaseModule = null);
      const m = require('@react-native-firebase/messaging') as FirebaseModule;
      m.getMessaging(); // throws when the app was built without the Firebase files
      firebaseModule = m;
    } catch {
      firebaseModule = null;
    }
  }
  return firebaseModule;
}

/** unsupported: this browser or device cannot do it. default: not asked yet. granted / denied: the person's answer. */
export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

const webReady = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

export async function pushState(): Promise<PushState> {
  try {
    if (Platform.OS === 'web') return webReady() ? (Notification.permission as PushState) : 'unsupported';
    if (!Device.isDevice) return 'unsupported';
    const fb = loadFirebase();
    if (fb) {
      const s = await fb.hasPermission(fb.getMessaging());
      return s === fb.AuthorizationStatus.DENIED ? 'denied' : s === fb.AuthorizationStatus.NOT_DETERMINED ? 'default' : 'granted';
    }
    const Notifications = loadNotifications();
    if (!Notifications) return 'unsupported';
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain ? 'default' : 'denied';
  } catch {
    return 'unsupported';
  }
}

function keyBytes(key: string) {
  const pad = '='.repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/** Browser: register the service worker (/sw.js, which shows the notification) and give the server this browser's address. */
async function subscribeWeb() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('GET', '/v1/push/config');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  await api('POST', '/v1/push/subscribe', { kind: 'web', token: JSON.stringify(sub) });
}

/** Phone: get this device's push token (Firebase when the build has it, otherwise Expo's) and give it to the server. */
async function subscribeNative() {
  const Notifications = loadNotifications();
  const fb = loadFirebase();
  if (fb) {
    // the channel Firebase messages arrive on (Android 8 and later)
    if (Platform.OS === 'android' && Notifications) await Notifications.setNotificationChannelAsync('default', { name: t('Messages and requests'), importance: Notifications.AndroidImportance.DEFAULT }).catch(() => undefined);
    await api('POST', '/v1/push/subscribe', { kind: 'fcm', token: await fb.getToken(fb.getMessaging()) });
    return;
  }
  if (!Notifications) return;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: t('Messages and requests'), importance: Notifications.AndroidImportance.DEFAULT });
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const pushToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('POST', '/v1/push/subscribe', { kind: 'expo', token: pushToken.data });
}

/** Ask permission (must follow a tap) and, if given, register this device. Returns where things stand now. */
export async function enablePush(): Promise<PushState> {
  try {
    if (Platform.OS === 'web') {
      if (!webReady()) return 'unsupported';
      const perm = await Notification.requestPermission();
      if (perm === 'granted') await subscribeWeb();
    } else {
      const fb = loadFirebase();
      if (fb) {
        const s = await fb.requestPermission(fb.getMessaging());
        if (s === fb.AuthorizationStatus.AUTHORIZED || s === fb.AuthorizationStatus.PROVISIONAL) await subscribeNative();
        return pushState();
      }
      const Notifications = loadNotifications();
      if (!Notifications) return 'unsupported';
      const r = await Notifications.requestPermissionsAsync();
      if (r.granted) await subscribeNative();
    }
  } catch {
    /* fall through to the real state below */
  }
  return pushState();
}

/** After sign-in: if permission was already given, quietly make sure this device is registered for this account. */
export async function resyncPush() {
  try {
    if ((await pushState()) !== 'granted') return;
    if (Platform.OS === 'web') await subscribeWeb();
    else await subscribeNative();
  } catch {
    /* push is optional */
  }
}

/** On phones, tapping a notification opens the chat or activity it is about. */
export function usePushTaps() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const fb = loadFirebase();
    if (fb) {
      // Firebase: the alert tapped while the app was in the background, the one that started the app, and a changed device token
      try {
        const m = fb.getMessaging();
        const open = (msg: { data?: Record<string, unknown> } | null) => {
          const url = msg?.data?.url;
          if (typeof url === 'string' && url.startsWith('/')) router.push(url as never);
        };
        void fb.getInitialNotification(m).then(open, () => undefined);
        const a = fb.onNotificationOpenedApp(m, open);
        const b = fb.onTokenRefresh(m, (token) => void api('POST', '/v1/push/subscribe', { kind: 'fcm', token }).catch(() => undefined));
        return () => {
          a();
          b();
        };
      } catch {
        return;
      }
    }
    const Notifications = loadNotifications();
    if (!Notifications) return;
    try {
      const sub = Notifications.addNotificationResponseReceivedListener((r) => {
        const url = (r.notification.request.content.data as { url?: string } | undefined)?.url;
        if (typeof url === 'string') router.push(url as never);
      });
      return () => sub.remove();
    } catch {
      /* push is optional */
    }
  }, [router]);
}
