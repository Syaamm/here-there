import { ActivityCard, TripCard } from '@/components/Cards';
import { Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { type Activity, type Trip } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';

/** Every activity and trip you have saved with the heart. Activities come a few at a time as you scroll (Profile shows only the 3 latest). */
export default function Favourites() {
  const { t, tn } = useT();
  const favs = useCursorList<Activity, { total: number }>('/v1/me/favorites', {}, 'me:favs:all');
  const trips = useCursorList<Trip, { total: number }>('/v1/me/favorite-trips', {}, 'me:fav-trips:all');
  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([favs.reload(), trips.reload()]);
  });
  const total = favs.data?.total ?? favs.items.length;
  const tripItems = trips.items;
  const tripTotal = trips.data?.total ?? tripItems.length;
  const none = favs.data && favs.items.length === 0 && trips.data && tripItems.length === 0;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={favs.error?.message ?? trips.error?.message} />
      {favs.loading && !favs.data && <Spinner />}
      {none && <Empty icon="heart-outline" title={t('No favourites yet')}>{t('Tap the heart on an activity or a trip to keep it here.')}</Empty>}
      {favs.items.length > 0 && (
        <>
          <Txt variant="muted">{tn(total, '{n} saved activity.', '{n} saved activities.')}</Txt>
          <Grid>
            {favs.items.map((a) => (
              <ActivityCard key={a.id} a={a} />
            ))}
          </Grid>
          <PagedTail paged={favs} />
        </>
      )}
      {tripItems.length > 0 && (
        <>
          <Txt variant="muted">{tn(tripTotal, '{n} saved trip.', '{n} saved trips.')}</Txt>
          <Grid>
            {tripItems.map((x) => (
              <TripCard key={x.id} t={x} />
            ))}
          </Grid>
          <PagedTail paged={trips} />
        </>
      )}
    </Screen>
  );
}
