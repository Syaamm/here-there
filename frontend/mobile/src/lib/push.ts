import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { API_URL, api } from './api';
import { currentOpenChat } from './live';
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
    // Android: the phone's own notification permission (Android 13 and later ask for it); Firebase's "permission" on Android only
    // says whether notifications are switched on, and asking Firebase never shows the prompt, so nobody was ever asked
    if (fb && Platform.OS !== 'android') {
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

/**
 * This device's push address as last given to the server, so signing out can take it back. Kept on the phone too, so it is
 * known even when the app signs out right after starting (an expired sign-in), before it registered again.
 */
let registered: string | null = null;
const TOKEN_KEY = 'ht_push_token';
async function register(kind: 'web' | 'fcm' | 'expo', token: string) {
  await api('POST', '/v1/push/subscribe', { kind, token });
  registered = token;
  void AsyncStorage.setItem(TOKEN_KEY, token).catch(() => undefined);
}

/** For a sign-out the person chose: this device's push address, sent with the sign-out itself (it still has a valid sign-in). */
export function pushTokenForSignOut(): string | undefined {
  const t = registered ?? undefined;
  registered = null;
  return t;
}

/**
 * Every sign-out, chosen or not (expired sign-in, suspended account): the server forgets this device's push address, so a
 * signed-out phone never shows the account's messages on its lock screen. Needs no sign-in (POST /v1/push/forget).
 * Signing in again registers the device again.
 */
export async function forgetPushDevice(known?: string) {
  registered = null;
  const token = known ?? (await AsyncStorage.getItem(TOKEN_KEY).catch(() => null)) ?? undefined;
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  if (token) await api('POST', '/v1/push/forget', { token }).catch(() => undefined);
}

/** Browser: register the service worker (/sw.js, which shows the notification) and give the server this browser's address. */
async function subscribeWeb() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>('GET', '/v1/push/config');
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }));
  await register('web', JSON.stringify(sub));
}

/**
 * The Android channel pushes arrive on ("alerts", which the server names). High importance: a banner drops down from the top,
 * as in WhatsApp. (A channel's importance cannot change once made, so this is a new channel; the old "default" one is left.)
 */
async function alertsChannel(Notifications: NotificationsModule | null) {
  if (!Notifications) return;
  await Notifications.setNotificationChannelAsync('alerts', { name: t('Messages and requests'), importance: Notifications.AndroidImportance.HIGH }).catch(() => undefined);
}

/** Phone: get this device's push token (Firebase when the build has it, otherwise Expo's) and give it to the server. */
async function subscribeNative() {
  const Notifications = loadNotifications();
  const fb = loadFirebase();
  if (fb) {
    // the channel Firebase messages arrive on (Android 8 and later): high importance, so they drop down as a banner
    if (Platform.OS === 'android') await alertsChannel(Notifications);
    await register('fcm', await fb.getToken(fb.getMessaging()));
    return;
  }
  if (!Notifications) return;
  if (Platform.OS === 'android') await alertsChannel(Notifications);
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const pushToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await register('expo', pushToken.data);
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
      if (fb && Platform.OS !== 'android') {
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

/**
 * Settings > Send a test push: registers this phone again WITHOUT hiding errors, asks the server to push to every device of the
 * account (POST /v1/push/test) and returns a plain report of each step, so a push that never arrives can be traced to its cause.
 */
export async function testPush(): Promise<string> {
  const lines: string[] = [`Server: ${API_URL}`];
  const fb = Platform.OS === 'web' ? null : loadFirebase();
  lines.push(`Permission: ${await pushState()}`);
  if (Platform.OS !== 'web') lines.push(`Firebase in this build: ${fb ? 'yes' : 'NO (falls back to Expo push)'}`);
  try {
    if (Platform.OS === 'web') await subscribeWeb();
    else await subscribeNative();
    lines.push(`This phone registered: yes (${(registered ?? '').slice(0, 12)}…)`);
  } catch (e) {
    lines.push(`This phone registered: NO: ${(e as Error)?.message ?? String(e)}`);
  }
  try {
    const r = await api<{ firebaseProject: string | null; devices: { kind: string; token: string; result: string; detail?: string }[]; note?: string }>('POST', '/v1/push/test');
    lines.push(`Server's Firebase project: ${r.firebaseProject ?? 'NONE (no key on the server)'}`);
    for (const d of r.devices) lines.push(`• ${d.kind} ${d.token}: ${d.result}${d.detail ? ` (${d.detail})` : ''}`);
    if (r.note) lines.push(r.note);
  } catch (e) {
    lines.push(`Server test failed: ${(e as Error)?.message ?? String(e)}`);
  }
  return lines.join('\n');
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

/**
 * After sign-in on a phone: the first time only, ask for notifications by itself (the phone's own prompt), so people get pushes
 * without having to find the Turn on button. Asked once per phone; a "no" is respected (Turn on in Inbox and Settings stays).
 * Otherwise, and on the web (where asking needs a tap), it just re-registers a device that already said yes.
 */
export async function askPushOnce() {
  try {
    if (Platform.OS !== 'web' && (await pushState()) === 'default' && !(await AsyncStorage.getItem(ASKED_KEY))) {
      await AsyncStorage.setItem(ASKED_KEY, '1');
      await enablePush();
      return;
    }
  } catch {
    /* push is optional */
  }
  await resyncPush();
}
const ASKED_KEY = 'ht_push_asked';

/** A chat's address in a push ("/chat/<id>"): its banner is not shown while that chat is open on screen. */
const isOpenChat = (url: unknown) => typeof url === 'string' && !!currentOpenChat() && url === `/chat/${currentOpenChat()}`;

// The same message can reach the app twice while it is open (iPhone hands it to the notification handler and to Firebase): one
// banner each, remembered for a few seconds by its words.
const shownAt = new Map<string, number>();
function alreadyShown(title: string, body: string) {
  const key = `${title}\n${body}`;
  const now = Date.now();
  for (const [k, at] of shownAt) if (now - at > 5000) shownAt.delete(k);
  if (shownAt.has(key)) return true;
  shownAt.set(key, now);
  return false;
}

let handlerSet = false;
/** With the app open, notifications drop down as the phone's own banner (like WhatsApp), except for the chat open on screen. */
function showBannersInApp(Notifications: NotificationsModule) {
  if (handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const c = n.request.content;
      const show = !isOpenChat((c.data as { url?: unknown } | undefined)?.url) && !alreadyShown(c.title ?? '', c.body ?? '');
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}

// One tap can be reported twice (the phone's notification module and Firebase both pass it on), and the notification that started
// the app is reported again whenever this hook mounts again (after signing out and in): each is opened once only.
let lastOpened = { url: '', at: 0 };
const openedMessages = new Set<string>();

/** On phones: banners with the app open, and tapping a notification opens the chat or activity it is about. */
export function usePushTaps() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const Notifications = loadNotifications();
    const fb = loadFirebase();
    const open = (url: unknown, messageId?: string) => {
      if (typeof url !== 'string' || !url.startsWith('/')) return;
      if (messageId) {
        if (openedMessages.has(messageId)) return;
        openedMessages.add(messageId);
      }
      const now = Date.now();
      if (lastOpened.url === url && now - lastOpened.at < 2000) return;
      lastOpened = { url, at: now };
      router.push(url as never);
    };
    const stops: (() => void)[] = [];
    try {
      if (Notifications) {
        showBannersInApp(Notifications);
        // a banner shown by the app itself (below), or any notification when the build has no Firebase
        const sub = Notifications.addNotificationResponseReceivedListener((r) => open((r.notification.request.content.data as { url?: unknown } | undefined)?.url));
        stops.push(() => sub.remove());
      }
      if (fb) {
        // Firebase: the notification tapped while the app was in the background, the one that started the app, a changed token
        const m = fb.getMessaging();
        void fb.getInitialNotification(m).then((msg) => open(msg?.data?.url, msg?.messageId), () => undefined);
        stops.push(fb.onNotificationOpenedApp(m, (msg) => open(msg?.data?.url, msg?.messageId)));
        stops.push(fb.onTokenRefresh(m, (token) => void register('fcm', token).catch(() => undefined)));
        // with the app open, Firebase hands the message to the app instead of showing it: show it as a banner (a moment later,
        // so one the phone already showed through the handler above is not shown twice)
        stops.push(
          fb.onMessage(m, (msg) => {
            const title = msg.notification?.title ?? '';
            const body = msg.notification?.body ?? '';
            const url = msg.data?.url;
            const thread = typeof msg.data?.thread === 'string' ? msg.data.thread : undefined;
            if (!Notifications || (!title && !body) || isOpenChat(url)) return;
            setTimeout(() => {
              if (alreadyShown(title, body)) return;
              void Notifications.scheduleNotificationAsync({
                // the same thread (one chat) reuses one notification, as the pushes do: the newest message replaces the last
                ...(thread ? { identifier: thread } : {}),
                content: { title, body, data: { url }, sound: true },
                trigger: Platform.OS === 'android' ? { channelId: 'alerts' } : null,
              }).catch(() => undefined);
            }, 350);
          }),
        );
      }
    } catch {
      /* push is optional */
    }
    return () => stops.forEach((s) => s());
  }, [router]);
}
