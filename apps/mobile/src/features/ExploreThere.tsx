import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { TripCard, TripFeatureCard } from '@/components/Cards';
import { TabHeader } from '@/components/TabHeader';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Btn, Card, Empty, ErrorBanner, Grid, Pill, PillRow, Screen, SearchBar, SectionHeader, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Trip } from '@/lib/api';
import { TRIP_TAGS } from '@/lib/constants';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useLayout } from '@/lib/layout';
import { useTheme } from '@/lib/theme';

/** THERE · Explore: trip proposals from other travelers. Not a travel agency. Budgets are estimates. */
export function ExploreThere() {
  const go = useGo();
  const { c } = useTheme();
  const { isTablet, gutter } = useLayout();
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');

  const feed = useLoad(() => get<{ total: number; items: Trip[] }>(`/v1/trips?${new URLSearchParams({ limit: '50', ...(tag && { tags: tag }) })}`), [tag], 60_000);
  const { refreshing, onRefresh } = useRefresh(feed.reload);

  // The API searches by destination only, so free text here filters the loaded trips on the device.
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = feed.data?.items ?? [];
    return t ? all.filter((x) => `${x.title} ${x.destination} ${x.tags.join(' ')}`.toLowerCase().includes(t)) : all;
  }, [feed.data, q]);

  const featured = items.slice(0, 4);
  const more = items.slice(4);

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing} header={<TabHeader subtitle="Go there. Together." />}>

      <VerifyBanner />

      <Txt variant="h1" style={{ fontSize: 24, lineHeight: 30 }}>Where to next?</Txt>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search a destination, trip or country" />
      <PillRow>
        <Pill label="All" active={tag === ''} onPress={() => setTag('')} />
        {TRIP_TAGS.map((t) => (
          <Pill key={t} label={t[0].toUpperCase() + t.slice(1)} active={tag === t} onPress={() => setTag(t)} />
        ))}
      </PillRow>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}
      {feed.data && items.length === 0 && (
        <Empty title={q || tag ? 'No trips match' : 'No trips yet'}>{q || tag ? 'Try another search or clear the filter.' : 'Propose the first trip and find people to go with.'}</Empty>
      )}

      {featured.length > 0 && (
        <>
          <SectionHeader title="Featured trips" />
          {isTablet ? (
            <Grid min={280}>
              {featured.map((t) => (
                <TripFeatureCard key={t.id} t={t} />
              ))}
            </Grid>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }} snapToInterval={148 + 12} snapToAlignment="start" disableIntervalMomentum decelerationRate="fast">
              {featured.map((t) => (
                <TripFeatureCard key={t.id} t={t} width={148} />
              ))}
            </ScrollView>
          )}
        </>
      )}

      {more.length > 0 && (
        <>
          <SectionHeader title="Explore together" />
          <Grid min={340}>
            {more.map((t) => (
              <TripCard key={t.id} t={t} />
            ))}
          </Grid>
        </>
      )}

      <Txt variant="small">Budgets are indicative estimates, not bookable prices. Trips are proposals: everyone books suppliers independently.</Txt>

      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: 20, padding: 16 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Txt variant="h3" style={{ fontSize: 15 }}>Have a trip in mind?</Txt>
          <Txt variant="muted">Propose it and find your group.</Txt>
        </View>
        <Btn title="Propose +" small onPress={() => go('/create')} />
      </Card>
    </Screen>
  );
}
