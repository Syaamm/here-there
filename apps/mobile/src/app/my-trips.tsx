import { View } from 'react-native';
import { TripCard } from '@/components/Cards';
import { Btn, Chip, Empty, ErrorBanner, Grid, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { type MyTripRow } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';

/** Every trip you organise, are in, or have applied to, a few at a time as you scroll (Profile shows only the latest 2). */
export default function MyTripsPage() {
  const go = useGo();
  const trips = useCursorList<MyTripRow, { counts: { joined: number; applications: number } }>('/v1/me/trips/page', {}, 'me:trips:all');
  const { refreshing, onRefresh } = useRefresh(trips.reload);
  const total = trips.data ? trips.data.counts.joined + trips.data.counts.applications : trips.items.length;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">{total} {total === 1 ? 'trip' : 'trips'}: the ones you organise, are in, or have applied to.</Txt>
      <ErrorBanner message={trips.error?.message} />
      {trips.loading && !trips.data && <Spinner />}
      {trips.data && trips.items.length === 0 && <Empty title="No trips yet">Propose a trip or apply to one and it shows up here.</Empty>}
      <Grid>
        {trips.items.map((x) =>
          x.row === 'joined' ? (
            <View key={x.id} style={{ gap: 6 }}>
              <TripCard t={x} />
              <Row>
                <Chip label={x.role === 'organizer' ? 'You organize this' : 'In the group'} tone="ok" />
                {x.role === 'organizer' && <Btn title="Review applications ›" variant="ghost" small onPress={() => go(`/review/${x.id}`)} />}
              </Row>
            </View>
          ) : (
            <View key={x.applicationId} style={{ gap: 6 }}>
              <TripCard t={x.trip} />
              <Chip label={x.state === 'pending' ? 'Pending organizer review' : x.state === 'waitlisted' ? 'Waitlisted' : 'Not approved'} tone={x.state === 'declined' ? 'bad' : 'warn'} />
            </View>
          ),
        )}
      </Grid>
      <PagedTail paged={trips} />
    </Screen>
  );
}
