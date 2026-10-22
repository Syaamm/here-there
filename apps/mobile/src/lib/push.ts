import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

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

/** unsupported: this browser or device cannot do it. default: not asked yet. granted / denied: the person's answer. */
export type PushState = 'unsupported' | 'default' | 'granted' | 'denied';

const webReady = () => typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;

export async function pushState(): Promise<PushState> {
  try {
    if (Platform.OS === 'web') return webReady() ? (Notification.permission as PushState) : 'unsupported';
    if (!Device.isDevice) return 'unsupported';
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

/** Phone: get this device's Expo push token and give it to the server. */
async function subscribeNative() {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'Messages and requests', importance: Notifications.AndroidImportance.DEFAULT });
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('POST', '/v1/push/subscribe', { kind: 'expo', token: t.data });
}

/** Ask permission (must follow a tap) and, if given, register this device. Returns where things stand now. */
export async function enablePush(): Promise<PushState> {
  try {
    if (Platform.OS === 'web') {
      if (!webReady()) return 'unsupported';
      const perm = await Notification.requestPermission();
      if (perm === 'granted') await subscribeWeb();
    } else {
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
