import { View } from 'react-native';
import { ActivityCard } from '@/components/Cards';
import { Empty, ErrorBanner, Grid, Screen, SectionHeader, Spinner, Txt } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { feedRange, splitFeed } from '@/lib/feed';
import { useLoad, useRefresh } from '@/lib/hooks';

const EMPTY: Record<string, string> = {
  soon: 'Nothing starts in the next 2 hours.',
  tonight: 'Nothing else planned for tonight.',
  tomorrow: 'Nothing planned for tomorrow yet.',
};

/** HERE · every activity from now until the end of tomorrow, as a list in three sections. */
export default function AllActivities() {
  const [city] = useCity();
  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50' });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city],
    60_000,
  );
  const { refreshing, onRefresh } = useRefresh(feed.reload);
  const sections = splitFeed(feed.data?.items ?? []);

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">Everything happening in {city} from now until the end of tomorrow.</Txt>
      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}
      {feed.data &&
        sections.map((s) => (
          <View key={s.id} style={{ gap: 12 }}>
            <SectionHeader title={s.title} right={<Txt variant="muted">{s.items.length}</Txt>} />
            {s.items.length === 0 ? (
              <Empty title={EMPTY[s.id]} />
            ) : (
              <Grid min={340}>
                {s.items.map((a) => (
                  <ActivityCard key={a.id} a={a} />
                ))}
              </Grid>
            )}
          </View>
        ))}
    </Screen>
  );
}
