import { del } from './api';

type Kind = 'activity' | 'trip';

/**
 * The server draft each create form is working from, with the name it had when it was opened or last saved. A draft is
 * one plan by its name (an activity's name, a trip's destination): saving with the same name updates it, whatever else
 * changed; saving after the name was changed keeps the original and saves the form as a new draft.
 */
const current: Record<Kind, { id: string; name: string; snap: string } | null> = { activity: null, trip: null };
/** The form as it was saved, to tell whether anything changed since. */
const snapOf = (form: Record<string, unknown> | object | undefined) => (form ? JSON.stringify(form) : '');

/** A form's name: the activity name, or where the trip goes. */
export const draftName = (kind: Kind, form: Record<string, unknown> | object) => {
  const v = (form as Record<string, unknown>)[kind === 'trip' ? 'destination' : 'title'];
  return typeof v === 'string' ? v.trim() : '';
};
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const setCurrentDraft = (kind: Kind, id: string | null, form?: Record<string, unknown> | object) => {
  current[kind] = id ? { id, name: form ? draftName(kind, form) : (current[kind]?.name ?? ''), snap: form ? snapOf(form) : (current[kind]?.snap ?? '') } : null;
};

/** Drafts this phone saved from a form itself (not ones opened from My drafts): leaving the app may update them without asking. */
const owned = new Set<string>();
export const ownDraft = (id: string) => void owned.add(id);
/** The draft leaving the app may update quietly: the form's own draft while it keeps its name; else none (a new draft). */
export function draftToUpdateQuietly(kind: Kind, form: Record<string, unknown> | object) {
  const id = draftToUpdate(kind, form);
  return id && owned.has(id) ? id : null;
}

/** The form now counts as the saved copy of its draft (right after a draft was opened and filled in). */
export const markDraftSaved = (kind: Kind, form: Record<string, unknown> | object) => {
  const c = current[kind];
  if (c) current[kind] = { ...c, snap: snapOf(form) };
};

/** Nothing changed since the form was saved as (or opened from) its draft: saving again would do nothing. */
export const draftUnchanged = (kind: Kind, form: Record<string, unknown> | object) => {
  const c = current[kind];
  return !!c && c.snap === snapOf(form);
};

/** The draft a form is working from, without letting go of it. */
export const currentDraftId = (kind: Kind) => current[kind]?.id ?? null;

/** The draft this form's save should update: the one it came from while it still has that name, else none (a new draft). */
export function draftToUpdate(kind: Kind, form: Record<string, unknown> | object) {
  const c = current[kind];
  return c && same(c.name, draftName(kind, form)) ? c.id : null;
}

/** Hands over the draft a form is working from and forgets it, so the next blank form starts a new one. */
export function takeCurrentDraft(kind: Kind) {
  const id = current[kind]?.id ?? null;
  current[kind] = null;
  return id;
}

/**
 * Called after an activity or trip is posted: the draft it was made from is no longer needed, if it is still that draft
 * (same name). A draft whose name was changed before posting stays, since the posted plan is a different one.
 */
export async function dropDraft(kind: Kind, form?: Record<string, unknown> | object) {
  const id = form ? draftToUpdate(kind, form) : (current[kind]?.id ?? null);
  current[kind] = null;
  if (id) await del(`/v1/me/drafts/${id}`).catch(() => {});
}
