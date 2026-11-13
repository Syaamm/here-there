import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Btn, ErrorBanner, Row, useGo } from '@/components/ui';
import { ApiError, get, put, type ServerDraft } from '@/lib/api';
import { chooseAsync } from '@/lib/confirm';
import { currentDraftId, draftToUpdate, draftUnchanged, markDraftSaved, ownDraft, setCurrentDraft } from '@/lib/drafts';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useMe } from '@/lib/auth';

import { sc, sp } from '@/lib/scale';
/**
 * "Save draft" under a create form. A saved draft belongs to the account, so it is there on another phone too. Drafts are
 * opened from My drafts: `onLoad` receives the saved form when one is opened.
 */
/** A guest ("Explore the demo") has no account to keep drafts in: no Save draft or My drafts for them (the form itself still works). */
export function DraftBar(props: Parameters<typeof DraftBarInner>[0]) {
  const { isGuest } = useMe();
  return isGuest ? null : <DraftBarInner {...props} />;
}

function DraftBarInner({ kind, data, onLoad, beforeLoad, showMyDrafts = false, named = true }: { kind: 'activity' | 'trip'; data: Record<string, unknown>; onLoad: (data: Record<string, unknown>) => void; /** runs before a draft is opened over the form (the form keeps what was typed as a draft) */ beforeLoad?: () => Promise<void>; /** a "My drafts" link beside the button (the form's first step) */ showMyDrafts?: boolean; /** the form has its name (an activity's name, a trip's destination): a draft needs at least that */ named?: boolean }) {
  const { t } = useT();
  const go = useGo();
  const router = useRouter();
  const { draft } = useLocalSearchParams<{ draft?: string }>();
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const loaded = useRef<string | null>(null);
  // a draft was just opened: once the form shows it, that is its saved copy (nothing to save until something is changed)
  const justOpened = useRef(false);
  useEffect(() => {
    if (!justOpened.current) return;
    justOpened.current = false;
    markDraftSaved(kind, data);
  }, [data, kind]);

  useEffect(() => {
    if (!draft) {
      loaded.current = null; // the same draft can be opened again later
      return;
    }
    if (loaded.current === draft) return;
    loaded.current = draft;
    // the draft you tapped, by its id (not looked for among the first few drafts of the list)
    get<ServerDraft>(`/v1/me/drafts/${encodeURIComponent(draft)}`)
      .then(async (d) => {
        // an activity draft is for the HERE form and a trip draft for the THERE form; while the app is still switching
        // between them the wrong form may be on screen for a moment, and it must leave the draft for the right one
        if (!d || d.kind !== kind) return;
        // the address keeps its parameters, so drop it: a blank form later must not reopen this draft
        router.setParams({ draft: undefined });
        if (currentDraftId(kind) !== d.id) await beforeLoad?.(); // what is in the form now is kept as its own draft
        setCurrentDraft(kind, d.id, d.data); // remembered with its name: a save under another name becomes a new draft
        justOpened.current = true;
        onLoad(d.data);
      })
      .catch(() => {});
  }, [draft, kind, onLoad, beforeLoad]);

  // a message under the button (an error) goes away by itself after 4 seconds
  useEffect(() => {
    if (!act.error) return;
    const timer = setTimeout(() => act.setError(null), 4000);
    return () => clearTimeout(timer);
  }, [act.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const unchanged = draftUnchanged(kind, data);
  const save = async () => {
    if (!named || unchanged || act.busy) return;
    // the draft it came from, while it keeps its name: ask whether to update it or keep it and save the changes as a new draft
    // (under a new name it is a new draft anyway, and the original stays)
    let id = draftToUpdate(kind, data);
    if (id) {
      const pick = await chooseAsync(t('Save your changes'), t('Update the draft you opened, or keep it as it was and save this as a new draft?'), t('Update this draft'), t('Save as new draft'));
      if (!pick) return;
      if (pick === 'b') id = null;
    }
    const d = await act.run(async () => {
      try {
        return await put<ServerDraft>('/v1/me/drafts', { id: id ?? undefined, kind, data });
      } catch (e) {
        // the draft this form came from was deleted meanwhile: keep this one as a new draft instead of saying "not found"
        if (e instanceof ApiError && e.status === 404) return await put<ServerDraft>('/v1/me/drafts', { kind, data });
        throw e;
      }
    });
    if (d) {
      setCurrentDraft(kind, d.id, data);
      ownDraft(d.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  return (
    <>
      <ErrorBanner message={act.error} />
      <Row style={{ gap: sp(8), alignItems: 'center' }}>
        {/* a draft needs its name, and something new to save: until then Save draft is off */}
        <Btn title={saved ? t('Saved to your drafts') : t('Save draft')} variant="secondary" small onPress={save} loading={act.busy} disabled={!named || (unchanged && !saved)} style={{ flex: 1 }} />
        {showMyDrafts ? <Btn title={t('My drafts ›')} variant="ghost" small onPress={() => go('/drafts')} /> : null}
      </Row>
    </>
  );
}
