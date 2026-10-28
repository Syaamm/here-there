import { View } from 'react-native';
import { TripCard } from '@/components/Cards';
import { Btn, Chip, Empty, ErrorBanner, Grid, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { type MyTripRow } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';

/** Every trip you organise, are in, or have applied to, a few at a time as you scroll (Profile shows only the latest 2). */
export default function MyTripsPage() {
  const { t } = useT();
  const go = useGo();
  const trips = useCursorList<MyTripRow, { counts: { joined: number; applications: number } }>('/v1/me/trips/page', {}, 'me:trips:all');
  const { refreshing, onRefresh } = useRefresh(trips.reload);

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={trips.error?.message} />
      {trips.loading && !trips.data && <Spinner />}
      {trips.data && trips.items.length === 0 && <Empty title={t('No trips yet')}>{t('Propose or join a trip.')}</Empty>}
      <Grid>
        {trips.items.map((x) =>
          x.row === 'joined' ? (
            <View key={x.id} style={{ gap: 6 }}>
              <TripCard t={x} />
              <Row>
                <Chip label={x.role === 'organizer' ? t('You organize this') : t('In the group')} tone="ok" />
                {x.role === 'organizer' && <Btn title={t('Review applications ›')} variant="ghost" small onPress={() => go(`/review/${x.id}`)} />}
              </Row>
            </View>
          ) : (
            <View key={x.applicationId} style={{ gap: 6 }}>
              <TripCard t={x.trip} />
              <Chip label={x.state === 'pending' ? t('Pending organizer review') : x.state === 'waitlisted' ? t('Waitlisted') : t('Not approved')} tone={x.state === 'declined' ? 'bad' : 'warn'} />
            </View>
          ),
        )}
      </Grid>
      <PagedTail paged={trips} />
    </Screen>
  );
}
