export type ToastMessage = { id: number; text: string; tone: 'ok' | 'error'; /** how long it stays, in milliseconds (3 seconds when not given) */ ms?: number };

const listeners = new Set<(t: ToastMessage) => void>();
let counter = 0;

/** A short in-app notice ("Saved to drafts") that goes away by itself. Shown by the Toast in the root layout. */
export function showToast(text: string, tone: ToastMessage['tone'] = 'ok', ms?: number) {
  const t = { id: ++counter, text, tone, ms };
  listeners.forEach((l) => l(t));
}

export function onToast(listener: (t: ToastMessage) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
