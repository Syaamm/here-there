import { ActivityCard } from '@/components/Cards';
import { Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { type Activity } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';

/** Every activity you have saved with the heart, a few at a time as you scroll (Profile shows only the 3 latest). */
export default function Favourites() {
  const favs = useCursorList<Activity, { total: number }>('/v1/me/favorites', {}, 'me:favs:all');
  const { refreshing, onRefresh } = useRefresh(favs.reload);
  const total = favs.data?.total ?? favs.items.length;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">{total} saved {total === 1 ? 'activity' : 'activities'}.</Txt>
      <ErrorBanner message={favs.error?.message} />
      {favs.loading && !favs.data && <Spinner />}
      {favs.data && favs.items.length === 0 && <Empty title="No favourites yet">Tap the heart on an activity to add it to your favourites.</Empty>}
      <Grid>
        {favs.items.map((a) => (
          <ActivityCard key={a.id} a={a} />
        ))}
      </Grid>
      <PagedTail paged={favs} />
    </Screen>
  );
}
