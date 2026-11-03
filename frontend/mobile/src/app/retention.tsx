import { Card, Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { get } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

type Item = { what: string; kept: string; why: string };

/** How long each kind of data is kept. Read from the server, so it is always exactly what the clean-up does. */
export default function Retention() {
  const { t } = useT();
  const list = useLoad(() => get<{ items: Item[] }>('/v1/retention'), [], undefined, 'retention');
  const { refreshing, onRefresh } = useRefresh(list.reload);
  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">{t('We do not keep things longer than we need to. Old data is deleted automatically.')}</Txt>
      <ErrorBanner message={list.error?.message} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.items.length === 0 && <Empty title={t('Nothing to show')} />}
      {list.data?.items.map((i) => (
        <Card key={i.what} style={{ padding: 14, borderRadius: 18, gap: 4 }}>
          <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{i.what}</Txt>
          <Txt>{i.kept}</Txt>
          <Txt variant="small">{i.why}</Txt>
        </Card>
      ))}
    </Screen>
  );
}
