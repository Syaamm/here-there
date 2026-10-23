import { View } from 'react-native';
import { TripCard } from '@/components/Cards';
import { Btn, Chip, Empty, ErrorBanner, Grid, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Trip } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';
import { PagedTail, usePaged } from '@/lib/paged';

type MyTrips = { joined: (Trip & { role: string })[]; applications: { applicationId: string; state: string; trip: Trip }[] };

/** Every trip you organise, are in, or have applied to, a few at a time as you scroll (Profile shows only the 3 latest). */
export default function MyTripsPage() {
  const go = useGo();
  const trips = useLoad(() => get<MyTrips>('/v1/me/trips'), [], undefined, 'me:trips');
  const { refreshing, onRefresh } = useRefresh(trips.reload);
  const items = [...(trips.data?.joined ?? []).map((t) => ({ key: t.id, joined: t })), ...(trips.data?.applications ?? []).map((a) => ({ key: a.applicationId, app: a }))];
  const paged = usePaged(items, 'trips');

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <Txt variant="muted">{items.length} {items.length === 1 ? 'trip' : 'trips'}: the ones you organise, are in, or have applied to.</Txt>
      <ErrorBanner message={trips.error?.message} />
      {trips.loading && !trips.data && <Spinner />}
      {trips.data && items.length === 0 && <Empty title="No trips yet">Propose a trip or apply to one and it shows up here.</Empty>}
      <Grid>
        {paged.shown.map((x) =>
          'joined' in x ? (
            <View key={x.key} style={{ gap: 6 }}>
              <TripCard t={x.joined} />
              <Row>
                <Chip label={x.joined.role === 'organizer' ? 'You organize this' : 'In the group'} tone="ok" />
                {x.joined.role === 'organizer' && <Btn title="Review applications ›" variant="ghost" small onPress={() => go(`/review/${x.joined.id}`)} />}
              </Row>
            </View>
          ) : (
            <View key={x.key} style={{ gap: 6 }}>
              <TripCard t={x.app.trip} />
              <Chip label={x.app.state === 'pending' ? 'Pending organizer review' : x.app.state === 'waitlisted' ? 'Waitlisted' : 'Not approved'} tone={x.app.state === 'declined' ? 'bad' : 'warn'} />
            </View>
          ),
        )}
      </Grid>
      <PagedTail paged={paged} />
    </Screen>
  );
}
