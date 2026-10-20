import { ActivityCard } from '@/components/Cards';
import { CityPicker } from '@/components/CityPicker';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Btn, Empty, ErrorBanner, Grid, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { useLoad, useRefresh } from '@/lib/hooks';

/**
 * Browser preview only. The native map (react-native-maps) exists on iOS and Android, not on the web,
 * so the web preview shows the same venues as a list.
 */
export function MapHere() {
  const go = useGo();
  const [city, setCity] = useCity();
  const feed = useLoad(
    () => {
      const now = new Date();
      const p = new URLSearchParams({ city, from: now.toISOString(), to: new Date(+now + 24 * 3600e3).toISOString(), limit: '50' });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city],
    60_000,
  );
  const { refreshing, onRefresh } = useRefresh(feed.reload);
  const items = feed.data?.items ?? [];

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <TabHeader />
      <CityPicker city={city} onPick={setCity} />
      <Banner>The interactive map is in the phone app. This browser preview lists the same public venues.</Banner>
      <ErrorBanner message={feed.error?.message} />
      <Txt variant="h2">In the next 24 hours</Txt>
      {feed.loading && !feed.data && <Spinner />}
      {feed.data && items.length === 0 && (
        <Empty title="Nothing on the map">
          <Btn title="Create an activity" small onPress={() => go('/create')} />
        </Empty>
      )}
      <Grid>
        {items.map((a) => (
          <ActivityCard key={a.id} a={a} />
        ))}
      </Grid>
    </Screen>
  );
}
