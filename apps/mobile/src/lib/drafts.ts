import { del } from './api';

/** The server draft each create form is currently working from, so posting it can remove it. */
const current: Record<'activity' | 'trip', string | null> = { activity: null, trip: null };
export const setCurrentDraft = (kind: 'activity' | 'trip', id: string | null) => {
  current[kind] = id;
};

/** Called after an activity or trip is posted: the saved copy is no longer needed. */
export async function dropDraft(kind: 'activity' | 'trip') {
  const id = current[kind];
  current[kind] = null;
  if (id) await del(`/v1/me/drafts/${id}`).catch(() => {});
}
