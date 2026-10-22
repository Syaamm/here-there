import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { API_URL, getToken } from './api';

/** What the server sends. 'ready' also fires after every (re)connect, so screens can catch up on what they missed. */
export type LiveEvent =
  | { type: 'ready' }
  | { type: 'message'; conversationId: string; message: { id: string; body: string; createdAt: string; sender: { id: string; displayName: string; photoUrl: string | null } } }
  | { type: 'notification'; notification: { id: string; type: string; title: string; body: string; data: unknown; createdAt: string } };

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let signedIn = false; // the server has said "ready" on this socket
let wanted = false;
let retry = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const url = () => API_URL.replace(/^http/, 'ws') + '/v1/live';

function open() {
  if (!wanted || socket) return;
  const token = getToken();
  if (!token) return;
  const ws = new WebSocket(url());
  socket = ws;
  // the token goes in the first message, never in the address
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = (m) => {
    try {
      const e = JSON.parse(String(m.data)) as LiveEvent;
      if (e.type === 'ready') {
        retry = 0;
        signedIn = true;
        sendPresence();
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
    }
    if (!wanted) return;
    retry = Math.min(retry + 1, 6);
    timer = setTimeout(open, Math.min(1000 * 2 ** retry, 30_000)); // 2 s, 4 s ... up to 30 s
  };
  ws.onerror = () => ws.close();
}

/** Keep a live connection while someone is signed in. */
export function startLive() {
  wanted = true;
  open();
}
export function stopLive() {
  wanted = false;
  if (timer) clearTimeout(timer);
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

// coming back to the app after it slept: reconnect right away instead of waiting out the back-off
AppState.addEventListener('change', (st) => {
  sendPresence();
  if (st === 'active' && wanted && !socket) {
    retry = 0;
    if (timer) clearTimeout(timer);
    open();
  }
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
