import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { ActivityCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Between, Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { feedRange, splitFeed } from '@/lib/feed';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, usePaged } from '@/lib/paged';

const EMPTY: Record<string, string> = {
  soon: 'Nothing starts in the next 2 hours.',
  tonight: 'Nothing else planned for tonight.',
  tomorrow: 'Nothing planned for tomorrow yet.',
};

/** HERE · every activity from now until the end of tomorrow, as a list in three sections. */
export default function AllActivities() {
  const { t } = useT();
  // Opened from the map's "List" button: picking an activity goes back to the map and selects it there.
  const { from, section } = useLocalSearchParams<{ from?: string; section?: string }>();
  const router = useRouter();
  const toMap = from === 'map';
  const [city] = useCity();
  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50', sort: 'relevance' });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city],
    60_000,
  );
  const { refreshing, onRefresh } = useRefresh(feed.reload);
  // opened from a Home section's "See all": only that section; otherwise everything, section after section
  const sections = splitFeed(feed.data?.items ?? []).filter((s) => !section || s.id === section);
  // only the first few are drawn; the rest as you scroll. The sections fill one after the other.
  const paged = usePaged(sections.flatMap((s) => s.items), city + (section ?? ''));
  let left = paged.count;
  const visible = sections.map((s) => {
    const items = s.items.slice(0, left);
    left -= items.length;
    return { ...s, items, total: s.items.length };
  });

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}
      {feed.data &&
        visible.filter((s) => s.items.length > 0 || s.total === 0).map((s, si) => (
          <Reveal key={s.id} index={si} style={{ gap: 8 }}>
            <Between>
              <Txt variant="h3" accessibilityRole="header" style={{ fontSize: 15 }}>{t(s.title)}</Txt>
              <Txt variant="small">{s.total}</Txt>
            </Between>
            {s.total === 0 ? (
              <Empty title={t(EMPTY[s.id])} />
            ) : (
              <Grid min={340}>
                {s.items.map((a) => (
                  <ActivityCard key={a.id} a={a} onPress={toMap ? () => router.navigate(`/discover?focus=${a.id}&t=${Date.now()}` as never) : undefined} />
                ))}
              </Grid>
            )}
          </Reveal>
        ))}
      {feed.data ? <PagedTail paged={paged} /> : null}
    </Screen>
  );
}
