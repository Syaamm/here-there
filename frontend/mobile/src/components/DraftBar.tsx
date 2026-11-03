import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Row, Btn, ErrorBanner, Txt, useGo } from '@/components/ui';
import { get, put, type ServerDraft } from '@/lib/api';
import { setCurrentDraft } from '@/lib/drafts';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/**
 * "Save draft" under a create form, plus a way to open the saved ones. A saved draft belongs to the account, so it is there
 * on another phone too. `onLoad` receives the saved form when one is opened from the drafts list.
 */
export function DraftBar({ kind, data, onLoad }: { kind: 'activity' | 'trip'; data: Record<string, unknown>; onLoad: (data: Record<string, unknown>) => void }) {
  const { t } = useT();
  const go = useGo();
  const router = useRouter();
  const { draft } = useLocalSearchParams<{ draft?: string }>();
  const [id, setId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const loaded = useRef<string | null>(null);

  useEffect(() => {
    if (!draft) {
      loaded.current = null; // the same draft can be opened again later
      return;
    }
    if (loaded.current === draft) return;
    loaded.current = draft;
    get<{ items: ServerDraft[] }>('/v1/me/drafts')
      .then((r) => {
        const d = r.items.find((x) => x.id === draft);
        // an activity draft is for the HERE form and a trip draft for the THERE form; while the app is still switching
        // between them the wrong form may be on screen for a moment, and it must leave the draft for the right one
        if (!d || d.kind !== kind) return;
        // the address keeps its parameters, so drop it: a blank form later must not reopen this draft
        router.setParams({ draft: undefined });
        setId(d.id);
        setCurrentDraft(kind, d.id);
        onLoad(d.data);
      })
      .catch(() => {});
  }, [draft, kind, onLoad]);

  const save = async () => {
    const d = await act.run(() => put<ServerDraft>('/v1/me/drafts', { id: id ?? undefined, kind, data }));
    if (d) {
      setId(d.id);
      setCurrentDraft(kind, d.id);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
  };

  return (
    <>
      <ErrorBanner message={act.error} />
      <Row style={{ gap: 8, alignItems: 'center' }}>
        <Btn title={saved ? t('Saved to your drafts') : t('Save draft')} variant="secondary" small onPress={save} loading={act.busy} style={{ flex: 1 }} />
        <Btn title={t('My drafts ›')} variant="ghost" small onPress={() => go('/drafts')} />
      </Row>
    </>
  );
}
