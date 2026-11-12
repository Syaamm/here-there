import { useEffect, useRef } from 'react';

/** A spot the person pinned on a map and wants to start a plan from. */
export type DroppedPin = { kind: 'activity' | 'trip'; lat: number; lng: number; name: string; address: string };

let pending: DroppedPin | null = null;
const listeners = new Set<() => void>();

/** Hands the pin to the create form (the forms stay mounted, so they pick it up at once). */
export function sendDroppedPin(p: DroppedPin) {
  pending = p;
  listeners.forEach((l) => l());
}

/** The create form for `kind` calls this: `onPin` runs once for each pin sent to it. */
export function useDroppedPin(kind: DroppedPin['kind'], onPin: (p: DroppedPin) => void) {
  const handler = useRef(onPin);
  handler.current = onPin;
  useEffect(() => {
    const take = () => {
      if (pending && pending.kind === kind) {
        const p = pending;
        pending = null;
        handler.current(p);
      }
    };
    take();
    listeners.add(take);
    return () => void listeners.delete(take);
  }, [kind]);
}
