import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { put, type ServerDraft } from './api';
import { confirmAsync } from './confirm';
import { currentDraftId, setCurrentDraft, takeCurrentDraft } from './drafts';
import { t } from './i18n';
import { showToast } from './toast';

type Kind = 'activity' | 'trip';

/** Keeps what was typed as a draft in the account, and says so. Called when the person leaves the form. */
async function stash(kind: Kind, form: object) {
  const id = takeCurrentDraft(kind);
  try {
    await put<ServerDraft>('/v1/me/drafts', { id: id ?? undefined, kind, data: form });
    showToast(t('Saved to drafts'));
  } catch (e) {
    showToast(e instanceof Error ? e.message : t('Could not save your draft'), 'error');
  }
}

/** Saves the form as a draft but keeps working from it (the app went to the background); false when it could not be saved. */
async function keep(kind: Kind, form: object) {
  try {
    const d = await put<ServerDraft>('/v1/me/drafts', { id: currentDraftId(kind) ?? undefined, kind, data: form });
    setCurrentDraft(kind, d.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the HERE and THERE create forms share, so they behave the same:
 *  - leaving the form (another tab or page, or switching HERE/THERE) saves what was typed as a draft, says "Saved to drafts",
 *    and calls `onReset`, which the form uses to come back empty;
 *  - leaving the app with something typed keeps it as a draft, and "Draft saved" shows for 2 seconds on coming back (a message
 *    cannot be drawn over other apps); the form is left as it was, and posting it later removes the draft;
 *  - `clearAll` asks, then empties the form without saving anything.
 * `hasContent` says whether the person has typed anything worth keeping. Set `posted.current = true` once the form was published.
 */
export function useFormDraft<T extends object>(kind: Kind, form: T, hasContent: (f: T) => boolean, onReset: () => void) {
  // the latest values, readable from handlers that must not change when the form does
  const latest = useRef(form);
  latest.current = form;
  const has = useRef(hasContent);
  has.current = hasContent;
  const reset = useRef(onReset);
  reset.current = onReset;
  const posted = useRef(false);
  const left = useRef(false);

  // the cleanup of a focus effect runs when the screen loses focus (or unmounts); with no changing dependencies it never runs for any other reason
  useFocusEffect(
    useCallback(
      () => () => {
        if (left.current) return;
        left.current = true;
        if (!posted.current && has.current(latest.current)) void stash(kind, latest.current);
        reset.current();
      },
      [kind],
    ),
  );

  const saving = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        saving.current = !posted.current && !left.current && has.current(latest.current) ? keep(kind, latest.current) : null;
      } else if (s === 'active' && saving.current) {
        const pending = saving.current;
        saving.current = null;
        void pending.then((ok) => ok && showToast(t('Draft saved'), 'ok', 2000));
      }
    });
    return () => sub.remove();
  }, [kind]);

  // everything typed goes, and the form stops being linked to a draft it was opened from (that draft stays as it is)
  const clearAll = async () => {
    if (!(await confirmAsync(t('Clear everything?'), t('This removes what you have entered. Drafts you already saved stay in My drafts.'), t('Clear all'), true))) return;
    left.current = true; // emptied on purpose: nothing to save on the way out
    takeCurrentDraft(kind);
    reset.current();
  };

  return { posted, clearAll };
}
