import { useRouter } from 'expo-router';
import { Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { get } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';

type MyReport = { id: string; category: string; targetType: string; status: string; outcome: string; createdAt: string; canAppeal: boolean };
const tone = (s: string) => (s === 'resolved' ? 'ok' : s === 'dismissed' ? 'neutral' : 'warn');

/** Reports you made and where each one stands. A dismissed report can be sent back for a second look, once. */
export default function MyReports() {
  const r = useRouter();
  const list = useLoad(() => get<{ items: MyReport[] }>('/v1/me/reports'), [], undefined, 'me:reports');
  const policy = useLoad(() => get<{ coverage: { text: string }; answerWithin: { urgent: string; normal: string } }>('/v1/reports/policy'), [], undefined, 'reports:policy');
  const { refreshing, onRefresh } = useRefresh(() => list.reload());
  const items = list.data?.items ?? [];
  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">{policy.data ? `${policy.data.coverage.text} Urgent reports are answered within ${policy.data.answerWithin.urgent}, others within ${policy.data.answerWithin.normal}.` : 'The reports you sent, and what became of them.'}</Txt>
      <ErrorBanner message={list.error?.message} />
      {list.loading && !list.data && <Spinner />}
      {!list.loading && items.length === 0 && <Empty title="No reports">Reports you send will show up here.</Empty>}
      {items.map((x) => (
        <Card key={x.id} style={{ padding: 14, borderRadius: 18, gap: 6 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20, flex: 1 }}>{x.category.replace(/_/g, ' ')} · {x.targetType}</Txt>
            <Chip label={x.outcome} tone={tone(x.status)} />
          </Row>
          <Txt variant="small">Sent {new Date(x.createdAt).toLocaleDateString()}</Txt>
          {x.canAppeal ? <Btn title="Ask for a second look" variant="secondary" small onPress={() => r.push(`/appeal?kind=report&targetId=${x.id}` as never)} /> : null}
        </Card>
      ))}
    </Screen>
  );
}
