import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { TripNextUpCard, TripRow } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Brand, ModeTabs } from '@/components/TabHeader';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Btn, Card, Empty, ErrorBanner, Pill, PillRow, Screen, SearchBar, SectionHeader, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { get, type MyTripsPage, type Trip } from '@/lib/api';
import { TRIP_TAGS } from '@/lib/constants';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';

const TAG_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  culture: 'color-palette-outline',
  food: 'restaurant-outline',
  adventure: 'compass-outline',
  nature: 'leaf-outline',
  city: 'business-outline',
  beach: 'sunny-outline',
  relax: 'cafe-outline',
  hiking: 'trail-sign-outline',
  photography: 'camera-outline',
  art: 'brush-outline',
};

type When = 'any' | 'month' | 'quarter' | 'later';
const DAY = 864e5;

/** THERE · Explore: trip proposals from other travelers. Not a travel agency. Budgets are estimates. */
export function ExploreThere() {
  const go = useGo();
  const { c } = useTheme();
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  // the filter button: how far ahead to look
  const [when, setWhen] = useState<When>('any');
  const [filterOpen, setFilterOpen] = useState(false);

  const feed = useLoad(() => get<{ total: number; items: Trip[] }>(`/v1/trips?${new URLSearchParams({ limit: '50', ...(tag && { tags: tag }) })}`), [tag], 60_000, 'feed:there', { keep: true });
  // a trip was proposed, filled or cancelled somewhere: ask again at once
  useLiveEvents((e) => {
    if (e.type === 'feed-changed') void feed.reload();
  });
  // Next up is about YOU: the soonest trip you organise, are going on, or have applied to
  const mine = useLoad(() => get<MyTripsPage>('/v1/me/trips/page?upcoming=1&limit=1'), [], undefined, 'me:trips:next');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([feed.reload(), mine.reload()]));

  // The API searches by destination only, so free text here filters the loaded trips on the device.
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = [...(feed.data?.items ?? [])].sort((a, b) => +new Date(a.dateStart) - +new Date(b.dateStart));
    return t ? all.filter((x) => `${x.title} ${x.destination} ${x.tags.join(' ')}`.toLowerCase().includes(t)) : all;
  }, [feed.data, q]);

  const now = Date.now();
  const inDays = (t: Trip) => (+new Date(t.dateStart) - now) / DAY;
  const soon = items.filter((t) => inDays(t) < 30);
  const season = items.filter((t) => inDays(t) >= 30 && inDays(t) < 90);
  const later = items.filter((t) => inDays(t) >= 90);

  const mineNext = (() => {
    const x = mine.data?.items[0]; // the server sends only the soonest trip still ahead
    if (!x) return null;
    return x.row === 'joined'
      ? { t: x as Trip, label: x.role === 'host' ? 'You organise this' : 'Going', tone: 'ok' as const }
      : { t: x.trip, label: x.state === 'pending' ? 'Request pending' : 'On the waiting list', tone: 'warn' as const };
  })();
  const MAX = 4;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing} header={<Brand />}>

      <VerifyBanner />

      <ModeTabs />

      <Txt variant="h1" style={{ fontSize: 26, lineHeight: 32 }}>Where to next?</Txt>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search a destination, trip or country" onFilter={() => setFilterOpen(true)} filterActive={when !== 'any'} />

      <PillRow>
        <Pill label="All" icon="apps-outline" active={tag === ''} onPress={() => setTag('')} />
        {TRIP_TAGS.map((t) => (
          <Pill key={t} label={t[0].toUpperCase() + t.slice(1)} icon={TAG_ICON[t]} active={tag === t} onPress={() => setTag(t)} />
        ))}
      </PillRow>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {feed.data && items.length === 0 && (
        <Empty title={q || tag ? 'No trips match' : 'No trips yet'}>{q || tag ? 'Try another search or clear the filter.' : 'Propose the first trip and find people to go with.'}</Empty>
      )}

      {mineNext && (
        <Reveal index={0} style={{ gap: 16 }}>
          <SectionHeader title="Next up" />
          <View style={{ width: '100%', maxWidth: 480 }}>
            <TripNextUpCard t={mineNext.t} status={{ label: mineNext.label, tone: mineNext.tone }} />
          </View>
        </Reveal>
      )}

      <ListSection index={1} title="Leaving soon" list={when === 'any' || when === 'month' ? soon : []} max={MAX} onMore={() => go('/trips?section=soon')} />
      <ListSection index={2} title="In the next few months" list={when === 'any' || when === 'quarter' ? season : []} max={MAX} onMore={() => go('/trips?section=season')} />
      <ListSection index={3} title="Later" list={when === 'any' || when === 'later' ? later : []} max={MAX} onMore={() => go('/trips?section=later')} />

      <Txt variant="small">Budgets are indicative estimates, not bookable prices. Trips are proposals: everyone books suppliers independently.</Txt>

      <Reveal index={4}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: 20, padding: 16 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>Have a trip in mind?</Txt>
            <Txt variant="muted">Propose it and find your group. Takes a minute.</Txt>
          </View>
          <Btn title="Propose" small onPress={() => go('/create')} />
        </Card>
      </Reveal>

      <Sheet visible={filterOpen} title="Show" onClose={() => setFilterOpen(false)}>
        <Txt variant="small">Pick how far ahead you want to look.</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['any', 'Everything'],
              ['month', 'Next 30 days'],
              ['quarter', '1 to 3 months'],
              ['later', 'Later than that'],
            ] as const
          ).map(([k, label]) => (
            <Pill key={k} label={label} active={when === k} onPress={() => setWhen(k)} />
          ))}
        </View>
        <Btn title="Done" onPress={() => setFilterOpen(false)} />
      </Sheet>
    </Screen>
  );
}

/** A titled list of trip rows (up to `max`), with "See all" on the right. Nothing is drawn when the list is empty. */
function ListSection({ index, title, list, max, onMore }: { index: number; title: string; list: Trip[]; max: number; onMore: () => void }) {
  const { c } = useTheme();
  if (list.length === 0) return null;
  // a group with more than 20 shows only 3, with a hint for the rest; "See all" opens just this group
  const over = list.length > 20;
  const count = over ? 3 : max;
  const hidden = list.length - count; // how many are not on this page: "See all" opens them
  return (
    <Reveal index={index} style={{ gap: 12 }}>
      <SectionHeader title={title} />
      {list.slice(0, count).map((t) => (
        <TripRow key={t.id} t={t} />
      ))}
      {hidden > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Plus ${hidden} more ${title.toLowerCase()}. See all`}
          hitSlop={6}
          onPress={onMore}
          style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
        >
          <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>+{hidden} more trips · See all</Txt>
          <Ionicons name="chevron-forward" size={13} color={c.forest} />
        </Pressable>
      ) : null}
    </Reveal>
  );
}
