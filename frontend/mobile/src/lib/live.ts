import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { API_URL, freshToken } from './api';

/** What the server sends. 'ready' also fires after every (re)connect, so screens can catch up on what they missed. */
export type LiveEvent =
  | { type: 'ready' }
  | { type: 'message'; conversationId: string; message: { id: string; body: string; kind?: string; createdAt: string; sender: { id: string; displayName: string; photoUrl: string | null } } }
  | { type: 'notification'; notification: { id: string; type: string; title: string; body: string; data: unknown; createdAt: string } }
  | { type: 'alerts-changed' }
  | { type: 'feed-changed' }
  // the members, dates, place, plan or a poll of one group changed (carries only which group)
  | { type: 'group-changed'; kind: 'activity' | 'trip'; id: string };

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let signedIn = false; // the server has said "ready" on this socket
let wanted = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSeen = 0; // when anything last arrived on the socket: a connection that has gone silent is dead even if it still says OPEN
let beat: ReturnType<typeof setInterval> | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null; // closes the socket a while after the app went to the background
let awaySince = 0;
const BEAT_MS = 20_000; // ask the server for a sign of life this often
const DEAD_MS = 50_000; // silent this long: drop the socket and connect again
const SLEEP_MS = 30_000; // in the background this long: close the socket (push covers the gap)

const url = () => API_URL.replace(/^http/, 'ws') + '/v1/live';

let opening = false;
function open() {
  if (!wanted || socket || opening) return;
  opening = true;
  // the short-lived token may have ended while the app was asleep: get a fresh one before connecting
  void freshToken()
    .then((token) => {
      if (!wanted || socket || !token) return;
      connect(token);
    })
    .finally(() => {
      opening = false;
    });
}

function connect(token: string) {
  const ws = new WebSocket(url());
  socket = ws;
  // the token goes in the first message, never in the address
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (m) => {
    lastSeen = Date.now();
    try {
      const e = JSON.parse(String(m.data)) as LiveEvent | { type: 'pong' };
      if (e.type === 'pong') return;
      if (e.type === 'ready') {
        retry = 0;
        signedIn = true;
        startBeat();
        sendPresence();
        sendScope();
        sendChat();
      }
      listeners.forEach((l) => l(e));
    } catch {
      /* ignore anything unreadable */
    }
  };
  ws.onclose = () => {
    if (socket === ws) {
      socket = null;
      signedIn = false;
      stopBeat();
    }
    // not while the app is in the background: it reconnects when it comes back (push covers the gap)
    if (!wanted || !inFront()) return;
    retry = Math.min(retry + 1, 6);
    // 2 s, 4 s ... up to 30 s, each with a random share added so phones do not all come back at the same moment after a server restart
    timer = setTimeout(open, Math.min(1000 * 2 ** retry, 30_000) * (0.5 + Math.random()));
  };
  ws.onerror = () => ws.close();
}

/** A phone that slept or changed network can keep a socket that still says OPEN but receives nothing. The server answers a ping, so silence means dead. */
function startBeat() {
  stopBeat();
  lastSeen = Date.now();
  beat = setInterval(() => {
    const ws = socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - lastSeen > DEAD_MS) {
      ws.close(); // onclose connects again
      return;
    }
    try {
      ws.send(JSON.stringify({ type: 'ping' }));
    } catch {
      ws.close();
    }
  }, BEAT_MS);
}
function stopBeat() {
  if (beat) clearInterval(beat);
  beat = null;
}
const inFront = () => Platform.OS === 'web' || AppState.currentState !== 'background';

/** Is the live connection working right now? Screens it keeps up to date can then look again far less often. */
export const liveIsUp = () => !!socket && signedIn && socket.readyState === WebSocket.OPEN;

/** Keep a live connection while someone is signed in. */
export function startLive() {
  wanted = true;
  open();
}
export function stopLive() {
  wanted = false;
  if (timer) clearTimeout(timer);
  if (sleepTimer) clearTimeout(sleepTimer);
  stopBeat();
  const s = socket;
  socket = null;
  s?.close();
}

/** Is the app on screen and in front? A hidden tab or a window behind another one is not: those still get push. */
const onScreen = () => (Platform.OS === 'web' ? typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus() : AppState.currentState === 'active');
function sendPresence() {
  if (socket && signedIn && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'presence', visible: onScreen() }));
}
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', sendPresence);
  window.addEventListener('focus', sendPresence);
  window.addEventListener('blur', sendPresence);
}

/** Tell the server which city the feeds show, so a change in another city does not wake this phone. */
let liveCity = '';
function sendScope() {
  if (socket && signedIn && socket.readyState === WebSocket.OPEN && liveCity) socket.send(JSON.stringify({ type: 'scope', city: liveCity }));
}
export function setLiveCity(city: string) {
  if (city === liveCity) return;
  liveCity = city;
  sendScope();
}

/** Tell the server which chat is open in front (or none), so a message to it needs no alert and no push for this person. */
let openChat: string | null = null;
function sendChat() {
  if (socket && signedIn && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'chat', id: openChat }));
}
export function setOpenChat(id: string | null) {
  if (id === openChat) return;
  openChat = id;
  sendChat();
}
/** The chat open on screen now (its notifications are not shown as banners), or null. */
export const currentOpenChat = () => openChat;
/** Only closes the chat it opened: a second chat that opened a moment earlier stays open. */
export function clearOpenChat(id: string) {
  if (openChat === id) setOpenChat(null);
}

// Going to the background: tell the server, and close the socket after a while (push covers the gap; an open socket keeps the radio awake).
// Coming back: a short absence is checked with a ping, a longer one starts from a fresh connection, because the old one may be dead without saying so.
AppState.addEventListener('change', (st) => {
  sendPresence();
  if (Platform.OS === 'web') return;
  if (st === 'background') {
    awaySince = awaySince || Date.now();
    if (sleepTimer) clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      if (AppState.currentState !== 'background') return;
      if (timer) clearTimeout(timer);
      const s = socket;
      socket = null;
      signedIn = false;
      stopBeat();
      s?.close();
    }, SLEEP_MS);
    return;
  }
  if (st !== 'active') return;
  if (sleepTimer) clearTimeout(sleepTimer);
  const away = awaySince ? Date.now() - awaySince : 0;
  awaySince = 0;
  if (!wanted) return;
  if (!socket || away > SLEEP_MS) {
    // gone, or away long enough that it cannot be trusted: start fresh right away
    retry = 0;
    if (timer) clearTimeout(timer);
    const s = socket;
    socket = null;
    signedIn = false;
    stopBeat();
    s?.close();
    open();
    return;
  }
  // a short absence: ask for a sign of life; no answer within 4 s means the connection died
  const probe = socket;
  const before = lastSeen;
  try {
    probe.send(JSON.stringify({ type: 'ping' }));
  } catch {
    probe.close();
  }
  setTimeout(() => {
    if (socket === probe && lastSeen === before) probe.close(); // onclose connects again
  }, 4000);
});

/** Run `fn` for every live event while the component is on screen. */
export function useLiveEvents(fn: Listener) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}
