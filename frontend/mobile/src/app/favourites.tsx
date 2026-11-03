import { ActivityCard, TripCard } from '@/components/Cards';
import { Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { get, type Activity, type Trip } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';

/** Every activity and trip you have saved with the heart. Activities come a few at a time as you scroll (Profile shows only the 3 latest). */
export default function Favourites() {
  const { t, tn } = useT();
  const favs = useCursorList<Activity, { total: number }>('/v1/me/favorites', {}, 'me:favs:all');
  const trips = useLoad(() => get<{ items: Trip[]; total: number }>('/v1/me/favorite-trips'), [], undefined, 'me:fav-trips');
  const { refreshing, onRefresh } = useRefresh(async () => {
    await Promise.all([favs.reload(), trips.reload()]);
  });
  const total = favs.data?.total ?? favs.items.length;
  const tripItems = trips.data?.items ?? [];
  const none = favs.data && favs.items.length === 0 && trips.data && tripItems.length === 0;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={favs.error?.message} />
      {favs.loading && !favs.data && <Spinner />}
      {none && <Empty title={t('No favourites yet')}>{t('Tap the heart on an activity or a trip.')}</Empty>}
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
          <Txt variant="muted">{tn(tripItems.length, '{n} saved trip.', '{n} saved trips.')}</Txt>
          <Grid>
            {tripItems.map((x) => (
              <TripCard key={x.id} t={x} />
            ))}
          </Grid>
        </>
      )}
    </Screen>
  );
}
