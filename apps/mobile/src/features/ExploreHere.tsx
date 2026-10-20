import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { FeatureCard, NextUpCard, ShowMoreCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { CityPicker } from '@/components/CityPicker';
import { TabHeader } from '@/components/TabHeader';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Btn, Card, Empty, ErrorBanner, Grid, Pill, PillRow, Screen, SearchBar, SectionHeader, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { useCity } from '@/lib/city';
import { CATS } from '@/lib/constants';
import { feedRange, splitFeed } from '@/lib/feed';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useLayout } from '@/lib/layout';
import { useScale } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

/** HERE · Explore: a time-sensitive feed of what is happening nearby. */
export function ExploreHere() {
  const go = useGo();
  const { c } = useTheme();
  const { isTablet, gutter } = useLayout();
  const k = useScale();
  const [city, setCity] = useCity();
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');

  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50', ...(cat && { category: cat }) });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, cat],
    60_000,
  );
  const { refreshing, onRefresh } = useRefresh(feed.reload);

  // The API has no free-text search yet, so search filters the loaded feed on the device.
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = feed.data?.items ?? [];
    return t ? all.filter((a) => `${a.title} ${a.venueName} ${a.tags.join(' ')}`.toLowerCase().includes(t)) : all;
  }, [feed.data, q]);

  // "Happening soon" = the next 2 hours. Everything after that sits in one sideways row, four cards and then Show more.
  const sections = splitFeed(items);
  const soon = sections[0].items;
  const later = [...sections[1].items, ...sections[2].items];
  // Quiet next two hours: lead with the one that starts next, then Tonight and Tomorrow as their own rows, so the page is never bare.
  const next = soon.length === 0 ? later[0] : undefined;
  const tonight = sections[1].items.filter((a) => a !== next);
  const tomorrow = sections[2].items.filter((a) => a !== next);
  const CARD = Math.round(148 * k);
  const MAX_LATER = 4;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing} header={<TabHeader><CityPicker city={city} onPick={setCity} /></TabHeader>}>

      <VerifyBanner />

      <Txt variant="h1" style={{ fontSize: 24, lineHeight: 30 }}>What are you up for?</Txt>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search activities or neighborhoods" />

      <PillRow>
        <Pill label="All" active={cat === ''} onPress={() => setCat('')} />
        {Object.entries(CATS).map(([k, v]) => (
          <Pill key={k} label={v.label} active={cat === k} onPress={() => setCat(k)} />
        ))}
      </PillRow>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {feed.data && items.length === 0 && (
        <Empty title={q ? 'No matches' : 'Nothing planned yet'}>
          {q ? 'Try a different search or category.' : 'Be the first. Start an activity in a minute.'}
        </Empty>
      )}

      {soon.length > 0 && (
        <Reveal index={0} style={{ gap: 16 }}>
          <SectionHeader title="Happening soon" />
          {/* swipe sideways on phones, a grid of the same cards on tablets */}
          {isTablet ? (
            <Grid min={280}>
              {soon.map((a) => (
                <FeatureCard key={a.id} a={a} />
              ))}
            </Grid>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }} snapToInterval={CARD + 12} snapToAlignment="start" disableIntervalMomentum decelerationRate="fast">
              {soon.map((a) => (
                <FeatureCard key={a.id} a={a} width={CARD} />
              ))}
            </ScrollView>
          )}
        </Reveal>
      )}

      {next && (
        <Reveal index={0} style={{ gap: 16 }}>
          <SectionHeader title="Next up" />
          <Txt variant="muted" style={{ marginTop: -8 }}>Nothing starts in the next 2 hours. This is what is coming.</Txt>
          <NextUpCard a={next} />
        </Reveal>
      )}

      {next ? (
        <>
          {tonight.length > 0 && <SidewaysRow index={1} title="Tonight" list={tonight} card={CARD} gutter={gutter} max={MAX_LATER} onMore={() => go('/activities')} />}
          {tomorrow.length > 0 && <SidewaysRow index={2} title="Tomorrow" list={tomorrow} card={CARD} gutter={gutter} max={MAX_LATER} onMore={() => go('/activities')} />}
        </>
      ) : (
        later.length > 0 && <SidewaysRow index={1} title="More around you" list={later} card={CARD} gutter={gutter} max={MAX_LATER} onMore={() => go('/activities')} />
      )}

      <Reveal index={3}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: 20, padding: 16 }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Txt variant="h3" style={{ fontSize: 15 }}>Nothing planned?</Txt>
          <Txt variant="muted">Start an activity in minutes.</Txt>
        </View>
        <Btn title="Create +" small onPress={() => go('/create')} />
      </Card>
      </Reveal>

    </Screen>
  );
}

/** A titled sideways row: up to `max` cards, then the "SHOW MORE" card that opens the full list. */
function SidewaysRow({ index, title, list, card, gutter, max, onMore }: { index: number; title: string; list: Activity[]; card: number; gutter: number; max: number; onMore: () => void }) {
  return (
    <Reveal index={index} style={{ gap: 16 }}>
      <SectionHeader title={title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }} snapToInterval={card + 12} snapToAlignment="start" disableIntervalMomentum decelerationRate="fast">
        {list.slice(0, max).map((a) => (
          <FeatureCard key={a.id} a={a} width={card} />
        ))}
        <ShowMoreCard onPress={onMore} />
      </ScrollView>
    </Reveal>
  );
}
