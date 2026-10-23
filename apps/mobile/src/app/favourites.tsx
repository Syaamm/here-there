import { ActivityCard } from '@/components/Cards';
import { Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';
import { PagedTail, usePaged } from '@/lib/paged';

/** Every activity you have saved with the heart, a few at a time as you scroll (Profile shows only the 3 latest). */
export default function Favourites() {
  const favs = useLoad(() => get<{ items: Activity[] }>('/v1/me/favorites'), [], undefined, 'me:favs');
  const { refreshing, onRefresh } = useRefresh(favs.reload);
  const items = favs.data?.items ?? [];
  const paged = usePaged(items, 'favourites');

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">{items.length} saved {items.length === 1 ? 'activity' : 'activities'}.</Txt>
      <ErrorBanner message={favs.error?.message} />
      {favs.loading && !favs.data && <Spinner />}
      {favs.data && items.length === 0 && <Empty title="No favourites yet">Tap the heart on an activity to add it to your favourites.</Empty>}
      <Grid>
        {paged.shown.map((a) => (
          <ActivityCard key={a.id} a={a} />
        ))}
      </Grid>
      <PagedTail paged={paged} />
    </Screen>
  );
}
