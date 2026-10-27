import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Row, Btn, ErrorBanner, Txt, useGo } from '@/components/ui';
import { get, put, type ServerDraft } from '@/lib/api';
import { setCurrentDraft } from '@/lib/drafts';
import { useAction } from '@/lib/hooks';

/**
 * "Save draft" under a create form, plus a way to open the saved ones. A saved draft belongs to the account, so it is there
 * on another phone too. `onLoad` receives the saved form when one is opened from the drafts list.
 */
export function DraftBar({ kind, data, onLoad }: { kind: 'activity' | 'trip'; data: Record<string, unknown>; onLoad: (data: Record<string, unknown>) => void }) {
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
    // the address keeps its parameters, so drop it: a blank form later must not reopen this draft
    router.setParams({ draft: undefined });
    get<{ items: ServerDraft[] }>('/v1/me/drafts')
      .then((r) => {
        const d = r.items.find((x) => x.id === draft);
        if (!d) return;
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
        <Btn title={saved ? 'Saved to your drafts' : 'Save draft'} variant="secondary" small onPress={save} loading={act.busy} style={{ flex: 1 }} />
        <Btn title="My drafts ›" variant="ghost" small onPress={() => go('/drafts')} />
      </Row>
      <Txt variant="small">A draft is private to you and stays in your account. It is only checked when you publish.</Txt>
    </>
  );
}
