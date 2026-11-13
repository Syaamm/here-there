import { useEffect, useSyncExternalStore } from 'react';
import { get, photoSrc } from './api';
import { TRIP_PHOTOS } from '@/components/Cards';
import { CAT_COLORS, CAT_IMAGES, CATS, TRIP_TAGS } from './constants';

/**
 * The categories an admin manages (Settings > Categories in the admin console). The app starts with the ones it always had (CATS,
 * CAT_COLORS and TRIP_TAGS in constants.ts) and, once the server answers, replaces them with the admin's list: the same objects
 * are updated in place, so every `CATS[key]` lookup in the app also knows the new ones. A screen that LISTS categories calls
 * `useCategories()` so it redraws when the list arrives. If the server cannot be reached the built-in list stays.
 */
type Remote = { key: string; label: string; emoji: string; color: string; imageUrl?: string | null };

let here: string[] = ['coffee', 'drinks', 'food', 'sports', 'culture'];
const thereLabels: Record<string, string> = {};
let loadedAt = 0;
let loading = false;
let version = 0;
const subs = new Set<() => void>();
const subscribe = (fn: () => void) => (subs.add(fn), () => void subs.delete(fn));

function apply(r: { here?: Remote[]; there?: Remote[] }) {
  if (r.here?.length) {
    here = r.here.map((c) => c.key);
    for (const c of r.here) {
      CATS[c.key] = { label: c.label, emoji: c.emoji };
      if (c.color) CAT_COLORS[c.key] = c.color;
      // the picture an admin gave it (the ones the app shipped with stay as the fallback)
      if (c.imageUrl) CAT_IMAGES[c.key] = { uri: photoSrc(c.imageUrl)! };
    }
  }
  if (r.there?.length) {
    TRIP_TAGS.splice(0, TRIP_TAGS.length, ...r.there.map((c) => c.key));
    for (const c of r.there) {
      thereLabels[c.key] = c.label;
      CATS[`there:${c.key}`] = { label: c.label, emoji: c.emoji };
      if (c.color) CAT_COLORS[`there:${c.key}`] = c.color;
      if (c.imageUrl) TRIP_PHOTOS[c.key] = { uri: photoSrc(c.imageUrl)! };
    }
  }
  version++;
  subs.forEach((f) => f());
}

export async function refreshCategories(force = false) {
  if (loading || (!force && Date.now() - loadedAt < 60_000)) return;
  loading = true;
  try {
    apply(await get<{ here?: Remote[]; there?: Remote[] }>('/v1/categories'));
    loadedAt = Date.now();
  } catch {
    // keep what the app already has
  } finally {
    loading = false;
  }
}

/** The name of a travel category (the admin's wording; a key the list does not know is shown with a capital letter). */
export const tagLabel = (k: string) => thereLabels[k] ?? k[0].toUpperCase() + k.slice(1);
/** A travel category's emoji, for the card without a photo. */
export const tagEmoji = (k: string) => CATS[`there:${k}`]?.emoji ?? '';
export const tagColor = (k: string) => CAT_COLORS[`there:${k}`] ?? '#E8E2D3';

/** The HERE category keys to offer, in the admin's order. Redraws the screen when the list changes. */
export function useCategories() {
  useEffect(() => void refreshCategories(), []);
  useSyncExternalStore(subscribe, () => version);
  return { here, there: TRIP_TAGS };
}
