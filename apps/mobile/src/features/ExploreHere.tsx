import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ActivityRow, NextUpCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { CityPicker } from '@/components/CityPicker';
import { Brand, ModeTabs } from '@/components/TabHeader';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Between, Btn, Card, Chip, Empty, ErrorBanner, Pill, PillRow, Screen, SearchBar, SectionHeader, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { comingUp, type MyActivitiesData } from '@/lib/myActivities';
import { useLayout } from '@/lib/layout';
import { hhmm } from '@/lib/format';
import { useCity } from '@/lib/city';
import { CATS } from '@/lib/constants';
import { feedRange, splitFeed } from '@/lib/feed';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';

const CAT_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = { coffee: 'cafe-outline', drinks: 'wine-outline', food: 'restaurant-outline', sports: 'basketball-outline', culture: 'color-palette-outline' };

/** HERE · Explore: a time-sensitive feed of what is happening nearby. */
export function ExploreHere() {
  const go = useGo();
  const { c } = useTheme();
  const [city, setCity] = useCity();
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  // the filter button: which part of the day to show
  const [when, setWhen] = useState<'any' | 'soon' | 'tonight' | 'tomorrow'>('any');
  const [filterOpen, setFilterOpen] = useState(false);

  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50', ...(cat && { category: cat }) });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, cat],
    20_000,
    'feed:here',
    { keep: true },
  );
  // Next up is about YOU: the soonest upcoming activity you host, are going to, or have asked to join
  // an activity was created, filled or cancelled somewhere: ask again at once (the app holds one nudge per few seconds)
  useLiveEvents((e) => {
    if (e.type === 'feed-changed') void feed.reload();
  });
  const mine = useLoad(() => get<MyActivitiesData>('/v1/me/activities'), [], undefined, 'me:activities');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([feed.reload(), mine.reload()]));

  // The API has no free-text search yet, so search filters the loaded feed on the device.
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    const all = feed.data?.items ?? [];
    return t ? all.filter((a) => `${a.title} ${a.venueName} ${a.tags.join(' ')}`.toLowerCase().includes(t)) : all;
  }, [feed.data, q]);

  const sections = splitFeed(items);
  const soon = sections[0].items;
  // Next up: only what is happening now or starts within 3 hours, soonest first. The clock moves on once a minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const soonAll = comingUp(mine.data, now, 3);
  // the cards show the two soonest; "+N more" appears only when there are more than two, and lists just the others
  const next = soonAll.slice(0, 2);
  const more = soonAll.slice(2);
  const [soonOpen, setSoonOpen] = useState(false);
  const { width, gutter } = useLayout();
  const cardW = Math.min(480, width - gutter * 2 - 28); // a bit of the next card peeks in, so it is clear you can swipe
  const MAX = 4;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing} header={<Between><Brand /><CityPicker city={city} onPick={setCity} pill /></Between>}>

      <VerifyBanner />

      <ModeTabs />

      <Txt variant="h1" style={{ fontSize: 26, lineHeight: 32 }}>What are you up for?</Txt>
      <SearchBar value={q} onChangeText={setQ} placeholder="Search activities or neighborhoods" onFilter={() => setFilterOpen(true)} filterActive={when !== 'any'} />

      <PillRow>
        <Pill label="All" icon="apps-outline" active={cat === ''} onPress={() => setCat('')} />
        {Object.entries(CATS).map(([k, v]) => (
          <Pill key={k} label={v.label} icon={CAT_ICON[k]} active={cat === k} onPress={() => setCat(k)} />
        ))}
      </PillRow>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {feed.data && items.length === 0 && (
        <Empty title={q ? 'No matches' : 'Nothing planned yet'}>
          {q ? 'Try a different search or category.' : 'Be the first. Start an activity in a minute.'}
        </Empty>
      )}

      {next.length > 0 && (
        <Reveal index={0} style={{ gap: 12 }}>
          <SectionHeader title="Next up" />
          {next.length === 1 ? (
            <View style={{ width: '100%', maxWidth: 480 }}>
              <NextUpCard a={next[0].activity} status={{ label: next[0].label, tone: next[0].tone }} />
            </View>
          ) : (
            // several plans in the next 3 hours: swipe through them, soonest first
            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + 12} snapToAlignment="start" decelerationRate="fast" disableIntervalMomentum style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}>
              {next.map((x) => (
                <View key={x.key} style={{ width: cardW }}>
                  <NextUpCard a={x.activity} status={{ label: x.label, tone: x.tone }} />
                </View>
              ))}
            </ScrollView>
          )}
          {more.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Plus ${more.length} more in the next 3 hours. Show them`}
              hitSlop={6}
              onPress={() => setSoonOpen(true)}
              style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
            >
              <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>+{more.length} more in the next 3 hours</Txt>
              <Ionicons name="chevron-forward" size={13} color={c.forest} />
            </Pressable>
          ) : null}
        </Reveal>
      )}

      <ListSection index={1} title="Happening soon" list={when === 'any' || when === 'soon' ? soon : []} max={MAX} onMore={() => go('/activities?section=soon')} />
      <ListSection index={2} title="Tonight" list={when === 'any' || when === 'tonight' ? sections[1].items : []} max={MAX} onMore={() => go('/activities?section=tonight')} />
      <ListSection index={3} title="Tomorrow" list={when === 'any' || when === 'tomorrow' ? sections[2].items : []} max={MAX} onMore={() => go('/activities?section=tomorrow')} />

      <Reveal index={4}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: 20, padding: 16 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>Nothing you fancy?</Txt>
            <Txt variant="muted">Host your own plan in a public place. Takes a minute.</Txt>
          </View>
          <Btn title="Host" small onPress={() => go('/create')} />
        </Card>
      </Reveal>

      <Sheet visible={soonOpen && more.length > 0} title="Also coming up in the next 3 hours" onClose={() => setSoonOpen(false)}>
        <Txt variant="small">The others, soonest first. Tap one to open it.</Txt>
        {more.map((x) => (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={`${x.activity.title}, ${hhmm(x.activity.startsAt)} to ${hhmm(x.activity.endsAt)}, ${x.label}`}
            onPress={() => {
              setSoonOpen(false);
              go(`/activity/${x.activity.id}`);
            }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ width: 84 }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{hhmm(x.activity.startsAt)}</Txt>
              <Txt variant="small" numberOfLines={1} style={{ fontSize: 11 }}>{+new Date(x.activity.startsAt) <= now ? 'now' : `to ${hhmm(x.activity.endsAt)}`}</Txt>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{x.activity.title}</Txt>
              <View style={{ flexDirection: 'row' }}><Chip label={x.label} tone={x.tone} /></View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.muted} />
          </Pressable>
        ))}
      </Sheet>

      <Sheet visible={filterOpen} title="Show" onClose={() => setFilterOpen(false)}>
        <Txt variant="small">Pick the part of the day you want to see.</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['any', 'Everything'],
              ['soon', 'Next 2 hours'],
              ['tonight', 'Tonight'],
              ['tomorrow', 'Tomorrow'],
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

/** A titled list of rows (up to `max`), with "See all" on the right. Nothing is drawn when the list is empty. */
function ListSection({ index, title, list, max, onMore }: { index: number; title: string; list: Activity[]; max: number; onMore: () => void }) {
  const { c } = useTheme();
  if (list.length === 0) return null;
  // a section with more than 20 shows only 3, with a hint for the rest; "See all" opens just this section
  const over = list.length > 20;
  const count = over ? 3 : max;
  const hidden = list.length - count; // how many are not on this page: "See all" opens them
  return (
    <Reveal index={index} style={{ gap: 12 }}>
      <SectionHeader title={title} />
      {list.slice(0, count).map((a) => (
        <ActivityRow key={a.id} a={a} />
      ))}
      {hidden > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Plus ${hidden} more ${title.toLowerCase()}. See all`}
          hitSlop={6}
          onPress={onMore}
          style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
        >
          <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>+{hidden} more activities · See all</Txt>
          <Ionicons name="chevron-forward" size={13} color={c.forest} />
        </Pressable>
      ) : null}
    </Reveal>
  );
}
