import { useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { View } from 'react-native';
import { TripRow } from '@/components/Cards';
import { Empty, ErrorBanner, Screen, Spinner } from '@/components/ui';
import { type Trip } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { SOON_DAYS } from '@/features/ExploreThere';

import { sc, sp } from '@/lib/scale';
const DAY = 864e5;
// the same edges as THERE Home (features/ExploreThere): Leaving soon is the next two weeks
const GROUPS: Record<string, { title: string; from: number; to: number; empty: string }> = {
  soon: { title: 'Happening soon', from: -Infinity, to: SOON_DAYS, empty: 'No trips leave in the next two weeks.' },
  season: { title: 'Coming up', from: SOON_DAYS, to: 90, empty: 'No trips in the next few months yet.' },
  later: { title: 'Later', from: 90, to: Infinity, empty: 'No trips planned that far ahead yet.' },
};

/** THERE · the full list of one group of trips from Home ("See all"): the server sends them a page at a time as you scroll. */
export default function AllTrips() {
  const { t } = useT();
  const { section, style } = useLocalSearchParams<{ section?: string; style?: string }>();
  const group = GROUPS[section ?? 'soon'] ?? GROUPS.soon;
  const now = useRef(Date.now()).current;
  // the same request as the Home feed (your own trips left out, ranked for you), for this group's departures, a page at a time
  const params: Record<string, string> = {
    excludeMine: 'true',
    ...(style ? { tags: style } : {}),
    ...(Number.isFinite(group.from) ? { startFrom: new Date(now + group.from * DAY).toISOString() } : {}),
    ...(Number.isFinite(group.to) ? { startTo: new Date(now + group.to * DAY).toISOString() } : {}),
  };
  const list = useCursorList<Trip>('/v1/trips', params, `trips:all:${section ?? 'soon'}:${style ?? ''}`);
  const { refreshing, onRefresh } = useRefresh(list.reload);

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={list.error?.message} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.items.length === 0 && <Empty icon="airplane-outline" title={t('Nothing here yet')}>{t(group.empty)}</Empty>}
      <View style={{ gap: sp(12) }}>
        {list.items.map((x) => (
          <TripRow key={x.id} t={x} />
        ))}
      </View>
      <PagedTail paged={list} />
    </Screen>
  );
}
