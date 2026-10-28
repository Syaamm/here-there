import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { TripRow } from '@/components/Cards';
import { Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { get, type Trip } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, usePaged } from '@/lib/paged';

const DAY = 864e5;
const GROUPS: Record<string, { title: string; from: number; to: number; empty: string }> = {
  soon: { title: 'Leaving soon', from: -Infinity, to: 30, empty: 'No trips leave in the next 30 days.' },
  season: { title: 'In the next few months', from: 30, to: 90, empty: 'No trips in the next few months yet.' },
  later: { title: 'Later', from: 90, to: Infinity, empty: 'No trips planned that far ahead yet.' },
};

/** THERE · the full list of one group of trips from Home ("See all"): soonest first, drawn a few at a time as you scroll. */
export default function AllTrips() {
  const { t } = useT();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const group = GROUPS[section ?? 'soon'] ?? GROUPS.soon;
  // the same request (and the same remembered answer) as the Home feed
  const feed = useLoad(() => get<{ total: number; items: Trip[] }>(`/v1/trips?${new URLSearchParams({ limit: '50' })}`), [''], 60_000, 'feed:there');
  const { refreshing, onRefresh } = useRefresh(feed.reload);
  const now = Date.now();
  const list = [...(feed.data?.items ?? [])]
    .filter((x) => {
      const days = (+new Date(x.dateStart) - now) / DAY;
      return days >= group.from && days < group.to;
    })
    .sort((a, b) => +new Date(a.dateStart) - +new Date(b.dateStart));
  const paged = usePaged(list, section ?? 'soon');

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}
      {feed.data && list.length === 0 && <Empty title={t('Nothing here yet')}>{t(group.empty)}</Empty>}
      <View style={{ gap: 12 }}>
        {paged.shown.map((x) => (
          <TripRow key={x.id} t={x} />
        ))}
      </View>
      {feed.data ? <PagedTail paged={paged} /> : null}
    </Screen>
  );
}
