import { useRouter } from 'expo-router';
import { Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { useRefresh } from '@/lib/hooks';
import { localeTag, useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';

type MyReport = { id: string; category: string; targetType: string; status: string; outcome: string; createdAt: string; canAppeal: boolean };
const tone = (s: string) => (s === 'resolved' ? 'ok' : s === 'dismissed' ? 'neutral' : 'warn');

/** Reports you made and where each one stands. A dismissed report can be sent back for a second look, once. */
export default function MyReports() {
  const { t } = useT();
  const r = useRouter();
  const list = useCursorList<MyReport>('/v1/me/reports', {}, 'me:reports');
  const { refreshing, onRefresh } = useRefresh(() => list.reload());
  const items = list.data?.items ?? [];
  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={list.error?.message} />
      {list.loading && !list.data && <Spinner />}
      {!list.loading && items.length === 0 && <Empty title={t('No reports')} />}
      {items.map((x) => (
        <Card key={x.id} style={{ padding: 14, borderRadius: 18, gap: 6 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20, flex: 1 }}>{x.category === 'host_no_show' ? t('Host did not show up') : x.category.replace(/_/g, ' ')} · {x.targetType}</Txt>
            <Chip label={x.outcome} tone={tone(x.status)} />
          </Row>
          <Txt variant="small">{t('Sent {date}', { date: new Date(x.createdAt).toLocaleDateString(localeTag()) })}</Txt>
          {x.canAppeal ? <Btn title={t('Ask for a second look')} variant="secondary" small onPress={() => r.push(`/appeal?kind=report&targetId=${x.id}` as never)} /> : null}
        </Card>
      ))}
      <PagedTail paged={list} />
    </Screen>
  );
}
