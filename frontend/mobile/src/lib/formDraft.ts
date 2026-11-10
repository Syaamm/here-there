import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { put, type ServerDraft } from './api';
import { chooseAsync, confirmAsync } from './confirm';
import { draftName, draftToUpdate, draftToUpdateQuietly, draftUnchanged, ownDraft, setCurrentDraft, takeCurrentDraft } from './drafts';
import { t } from './i18n';
import { useMe } from './auth';
import { showToast } from './toast';

type Kind = 'activity' | 'trip';

/** Keeps what was typed as a draft in the account, and says so. Called when the person leaves the form. */
async function stash(kind: Kind, form: object) {
  // already saved as it is: nothing to do. Changed: a new draft, so the draft it was opened from is never overwritten without asking
  const unchanged = draftUnchanged(kind, form);
  takeCurrentDraft(kind);
  if (unchanged) return;
  try {
    await put<ServerDraft>('/v1/me/drafts', { id: draftToUpdateQuietly(kind, form) ?? undefined, kind, data: form });
    showToast(t('Saved to drafts'));
  } catch (e) {
    showToast(e instanceof Error ? e.message : t('Could not save your draft'), 'error');
  }
}

/** Saves the form as a draft but keeps working from it (the app went to the background); false when it could not be saved. */
async function keep(kind: Kind, form: object) {
  if (draftUnchanged(kind, form)) return false; // already saved as it is
  try {
    // a draft this form saved itself is updated; one opened from My drafts and then changed is never overwritten without asking
    // (leaving the app cannot ask): the changes become a new draft, and the next time the app is left that one is updated
    const d = await put<ServerDraft>('/v1/me/drafts', { id: draftToUpdateQuietly(kind, form) ?? undefined, kind, data: form });
    ownDraft(d.id);
    setCurrentDraft(kind, d.id, form);
    return true;
  } catch {
    return false;
  }
}

/**
 * What the HERE and THERE create forms share, so they behave the same:
 *  - leaving the form for another tab or page, or switching HERE/THERE, keeps it exactly as it was (no draft is made);
 *  - leaving the app with something typed keeps it as a draft, and "Draft saved" shows for 2 seconds on coming back (a message
 *    cannot be drawn over other apps); the form is left as it was, and posting it later removes the draft;
 *  - once it was published (`posted.current = true`), leaving it calls `onReset` so it comes back empty;
 *  - `stashNow` saves what was typed as a draft before another draft is opened over it, so nothing is lost;
 *  - `clearAll` asks, then empties the form without saving anything.
 * `hasContent` says whether the person has typed anything worth keeping.
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
  // a guest has no account to keep drafts in: leaving or restarting the form never tries to save one
  const { isGuest } = useMe();
  const guest = useRef(isGuest);
  guest.current = isGuest;

  // the cleanup of a focus effect runs when the screen loses focus (or unmounts): a published form starts over next time
  useFocusEffect(
    useCallback(
      () => () => {
        if (posted.current) reset.current();
      },
      [],
    ),
  );

  const stashNow = useCallback(async () => {
    if (!guest.current && !posted.current && has.current(latest.current)) await stash(kind, latest.current);
  }, [kind]);

  const saving = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') {
        saving.current = !guest.current && !posted.current && has.current(latest.current) ? keep(kind, latest.current) : null;
      } else if (s === 'active' && saving.current) {
        const pending = saving.current;
        saving.current = null;
        void pending.then((ok) => ok && showToast(t('Draft saved'), 'ok', 2000));
      }
    });
    return () => sub.remove();
  }, [kind]);

  /**
   * "Restart": what was entered is kept as a draft (by the same rules as Save draft), then every field is emptied and the form
   * starts again from step 1. Nothing new since the last save: nothing is saved. A draft opened from My drafts and changed: asks
   * whether to update it or save a new one. No name yet (a draft needs one): asks before letting it go. Cancel: nothing happens.
   */
  const restart = async () => {
    const form = latest.current;
    if (!guest.current && !posted.current && has.current(form) && !draftUnchanged(kind, form)) {
      if (!draftName(kind, form)) {
        const msg = kind === 'trip' ? t('A draft needs a destination, so what you entered will be cleared.') : t('A draft needs an activity name, so what you entered will be cleared.');
        if (!(await confirmAsync(t('Restart without saving?'), msg, t('Restart'), true))) return;
      } else {
        let id = draftToUpdateQuietly(kind, form);
        if (!id && draftToUpdate(kind, form)) {
          const pick = await chooseAsync(t('Save your changes'), t('Update the draft you opened, or keep it as it was and save this as a new draft?'), t('Update this draft'), t('Save as new draft'));
          if (!pick) return;
          id = pick === 'a' ? draftToUpdate(kind, form) : null;
        }
        try {
          await put<ServerDraft>('/v1/me/drafts', { id: id ?? undefined, kind, data: form });
          showToast(t('Saved to drafts'));
        } catch (e) {
          showToast(e instanceof Error ? e.message : t('Could not save your draft'), 'error');
          return; // not saved: the form stays as it is, so nothing is lost
        }
      }
    }
    takeCurrentDraft(kind);
    reset.current(); // a fresh, empty form on step 1
  };

  // everything typed goes, and the form stops being linked to a draft it was opened from (that draft stays as it is)
  const clearAll = async () => {
    if (!(await confirmAsync(t('Clear everything?'), t('This removes what you have entered. Drafts you already saved stay in My drafts.'), t('Clear all'), true))) return;
    takeCurrentDraft(kind);
    reset.current();
  };

  return { posted, clearAll, stashNow, restart };
}
