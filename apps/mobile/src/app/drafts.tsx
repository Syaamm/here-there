import { useRouter } from 'expo-router';
import { Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { del, type ServerDraft } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useTheme } from '@/lib/theme';

/** Activities and trips saved for later. Opening one fills the create form with it. */
export default function Drafts() {
  const r = useRouter();
  const { switchMode, mode } = useTheme();
  const list = useCursorList<ServerDraft>('/v1/me/drafts', {}, 'me:drafts');
  const { refreshing, onRefresh } = useRefresh(() => list.reload());
  const act = useAction(() => void list.reload());
  const items = list.data?.items ?? [];

  const open = (d: ServerDraft) => {
    const want = d.kind === 'trip' ? 'there' : 'here';
    if (mode !== want) switchMode(want);
    r.push({ pathname: '/(tabs)/create', params: { draft: d.id } } as never);
  };

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">Things you started and saved for later. Only you can see them.</Txt>
      <ErrorBanner message={list.error?.message ?? act.error} />
      {list.loading && !list.data && <Spinner />}
      {!list.loading && items.length === 0 && <Empty title="No drafts">Use Save draft on the create screen and it will wait here.</Empty>}
      {items.map((d) => (
        <Card key={d.id} style={{ padding: 14, borderRadius: 18, gap: 8 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Chip label={d.kind === 'trip' ? 'Trip' : 'Activity'} tone="info" />
            <Txt variant="small">Saved {new Date(d.updatedAt).toLocaleDateString()}</Txt>
          </Row>
          <Txt variant="h3" style={{ fontSize: 16, lineHeight: 22 }}>{d.title ?? 'Untitled'}</Txt>
          <Row style={{ gap: 8 }}>
            <Btn title="Continue" small onPress={() => open(d)} style={{ flex: 1 }} />
            <Btn title="Delete" small variant="danger" onPress={() => void act.run(() => del(`/v1/me/drafts/${d.id}`))} loading={act.busy} />
          </Row>
        </Card>
      ))}
      <PagedTail paged={list} />
    </Screen>
  );
}
