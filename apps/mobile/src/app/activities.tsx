import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { ActivityCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Between, Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
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
  // Opened from the map's "List" button: picking an activity goes back to the map and selects it there.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const router = useRouter();
  const toMap = from === 'map';
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
      <Txt variant="muted">{toMap ? 'Tap an activity to see where it is on the map.' : `Everything happening in ${city} from now until the end of tomorrow.`}</Txt>
      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}
      {feed.data &&
        sections.map((s, si) => (
          <Reveal key={s.id} index={si} style={{ gap: 8 }}>
            <Between>
              <Txt variant="h3" accessibilityRole="header" style={{ fontSize: 15 }}>{s.title}</Txt>
              <Txt variant="small">{s.items.length}</Txt>
            </Between>
            {s.items.length === 0 ? (
              <Empty title={EMPTY[s.id]} />
            ) : (
              <Grid min={340}>
                {s.items.map((a) => (
                  <ActivityCard key={a.id} a={a} onPress={toMap ? () => router.navigate(`/discover?focus=${a.id}&t=${Date.now()}` as never) : undefined} />
                ))}
              </Grid>
            )}
          </Reveal>
        ))}
    </Screen>
  );
}
