import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Btn, Card, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { del, type ServerDraft } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';
import { localeTag, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { dateText } from '@/lib/format';

import { sc, sp } from '@/lib/scale';
/**
 * Drafts are kept apart for HERE and THERE: in HERE mode only activity drafts show, in THERE mode only trip drafts. Opening one
 * fills the create form with it. (A person keeps at most 10 drafts per kind, so all of them always arrive in the first page.)
 */
export default function Drafts() {
  const { t } = useT();
  const r = useRouter();
  const { mode } = useTheme();
  const kind = mode === 'there' ? 'trip' : 'activity';
  const list = useCursorList<ServerDraft>('/v1/me/drafts', {}, 'me:drafts');
  const { refreshing, onRefresh } = useRefresh(() => list.reload());
  const act = useAction(() => void list.reload());
  // Delete is instant: the draft leaves the list at once and the server is told in the background (nothing else on the page
  // waits or flickers); if the server refuses, it comes back and the reason is shown
  const [gone, setGone] = useState<Set<string>>(new Set());
  const items = (list.data?.items ?? []).filter((d) => d.kind === kind && !gone.has(d.id));
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

  // the list only holds this mode's drafts, so the create form that opens is always the matching one
  const open = (d: ServerDraft) => r.push({ pathname: '/(tabs)/create', params: { draft: d.id } } as never);

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={list.error?.message ?? act.error} />
      {list.loading && !list.data && <Spinner />}
      {!list.loading && items.length === 0 && <Empty title={t('No drafts')}>{t('Saved drafts show up here.')}</Empty>}
      {items.map((d) => (
        <Card key={d.id} style={{ padding: sp(14), borderRadius: sc(18), gap: sp(8) }}>
          <Txt variant="small">{t('Saved {date}', { date: dateText(d.updatedAt) })}</Txt>
          <Txt variant="h3" style={{ fontSize: 16, lineHeight: 22 }}>{d.title ?? t('Untitled')}</Txt>
          <Row style={{ gap: sp(8) }}>
            <Btn title={t('Continue')} onPress={() => open(d)} style={{ flex: 1 }} />
            <Btn title={t('Delete')} variant="danger" onPress={() => remove(d.id)} />
          </Row>
        </Card>
      ))}
      <PagedTail paged={list} />
    </Screen>
  );
}
