import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { del, type ServerDraft } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';
import { localeTag, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/** Activities and trips saved for later. Opening one fills the create form with it. */
export default function Drafts() {
  const { t } = useT();
  const r = useRouter();
  const { switchMode, mode } = useTheme();
  const list = useCursorList<ServerDraft>('/v1/me/drafts', {}, 'me:drafts');
  const { refreshing, onRefresh } = useRefresh(() => list.reload());
  const act = useAction(() => void list.reload());
  // Delete is instant: the draft leaves the list at once and the server is told in the background (nothing else on the page
  // waits or flickers); if the server refuses, it comes back and the reason is shown
  const [gone, setGone] = useState<Set<string>>(new Set());
  const items = (list.data?.items ?? []).filter((d) => !gone.has(d.id));
  const remove = (id: string) => {
    setGone((g) => new Set(g).add(id));
    void act.run(() => del(`/v1/me/drafts/${id}`)).then((ok) => {
      if (ok === undefined)
        setGone((g) => {
          const n = new Set(g);
          n.delete(id);
          return n;
        });
    });
  };

  const open = (d: ServerDraft) => {
    const want = d.kind === 'trip' ? 'there' : 'here';
    const go = () => r.push({ pathname: '/(tabs)/create', params: { draft: d.id } } as never);
    if (mode !== want) switchMode(want, go); // the wave plays first, the form opens once it has covered the screen
    else go();
  };

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={list.error?.message ?? act.error} />
      {list.loading && !list.data && <Spinner />}
      {!list.loading && items.length === 0 && <Empty title={t('No drafts')}>{t('Saved drafts show up here.')}</Empty>}
      {items.map((d) => (
        <Card key={d.id} style={{ padding: 14, borderRadius: 18, gap: 8 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Chip label={d.kind === 'trip' ? t('Trip') : t('Activity')} tone="info" />
            <Txt variant="small">{t('Saved {date}', { date: new Date(d.updatedAt).toLocaleDateString(localeTag()) })}</Txt>
          </Row>
          <Txt variant="h3" style={{ fontSize: 16, lineHeight: 22 }}>{d.title ?? t('Untitled')}</Txt>
          <Row style={{ gap: 8 }}>
            <Btn title={t('Continue')} small onPress={() => open(d)} style={{ flex: 1 }} />
            <Btn title={t('Delete')} small variant="danger" onPress={() => remove(d.id)} />
          </Row>
        </Card>
      ))}
      <PagedTail paged={list} />
    </Screen>
  );
}
