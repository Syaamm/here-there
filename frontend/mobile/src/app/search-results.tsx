import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityCard } from '@/components/Cards';
import { Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { type Activity } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { FS } from '@/lib/type';

/**
 * Every activity a map search found, as a list, a page of 20 at a time as you scroll (the server sends only the next page after the
 * last row shown). The map's search words, place, kind and area arrive as the address's parameters, so the list is the very same
 * question the map asked. Picking one opens it.
 */
export default function SearchResults() {
  const { t } = useT();
  const router = useRouter();
  const raw = useLocalSearchParams<Record<string, string>>();
  // only what the activities list understands is passed on
  const keys = ['q', 'category', 'city', 'lat', 'lng', 'radiusKm', 'from', 'to'] as const;
  const params: Record<string, string> = {};
  for (const k of keys) if (typeof raw[k] === 'string' && raw[k]) params[k] = raw[k]!;
  const [round, setRound] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const list = useCursorList<Activity>('/v1/activities', params, `search:results:${round}:${JSON.stringify(params)}`);
  const onRefresh = () => {
    setRefreshing(true);
    setRound((r) => r + 1);
    setTimeout(() => setRefreshing(false), 700);
  };
  const what = [params.q && `“${params.q}”`, raw.place].filter(Boolean).join(' · ');
  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      {what ? <Txt variant="h3" accessibilityRole="header" style={{ fontSize: FS.body }}>{what}</Txt> : null}
      <ErrorBanner message={list.error?.message} />
      {list.loading && !list.data ? <Spinner rows={3} /> : null}
      {list.data && list.items.length === 0 ? <Empty title={t('Nothing found')}>{t('Try other words or another place.')}</Empty> : null}
      <Grid min={340}>
        {list.items.map((a) => (
          <ActivityCard key={a.id} a={a} onPress={() => router.navigate(`/activity/${a.id}` as never)} />
        ))}
      </Grid>
      <PagedTail paged={list} />
    </Screen>
  );
}
