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
import { useT } from '@/lib/i18n';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';

const CAT_ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = { coffee: 'cafe-outline', drinks: 'wine-outline', food: 'restaurant-outline', sports: 'basketball-outline', culture: 'color-palette-outline' };

/** HERE · Explore: a time-sensitive feed of what is happening nearby. */
export function ExploreHere() {
  const { t } = useT();
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
      const p = new URLSearchParams({ city, from: from.toISOString(), to: to.toISOString(), limit: '50', sort: 'relevance', ...(cat && { category: cat }) });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, cat],
    60_000, // changes arrive by the live connection (below); this is only the slow fallback
    'feed:here',
    { keep: true },
  );
  // Next up is about YOU: the soonest upcoming activity you host, are going to, or have asked to join
  // an activity was created, filled or cancelled somewhere: ask again at once (the app holds one nudge per few seconds)
  useLiveEvents((e) => {
    if (e.type === 'feed-changed') void feed.reload();
  });
  // only the plans on now or in the next 4 hours are fetched (the card shows 3; the extra hour covers the time between refreshes)
  const mine = useLoad(() => get<MyActivitiesData>('/v1/me/activities/soon?hours=4'), [], 300_000, 'me:soon');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([feed.reload(), mine.reload()]));

  // The API has no free-text search yet, so search filters the loaded feed on the device.
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = feed.data?.items ?? [];
    return needle ? all.filter((a) => `${a.title} ${a.venueName} ${a.tags.join(' ')}`.toLowerCase().includes(needle)) : all;
  }, [feed.data, q]);

  const sections = splitFeed(items);
  const soon = sections[0].items;
  // Next up: only what is happening now or starts within 3 hours, soonest first. The clock moves on once a minute.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
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

      <Txt variant="h1" style={{ fontSize: 26, lineHeight: 32 }}>{t('What are you up for?')}</Txt>
      <SearchBar value={q} onChangeText={setQ} placeholder={t('Search activities or neighborhoods')} onFilter={() => setFilterOpen(true)} filterActive={when !== 'any'} />

      <PillRow>
        <Pill label={t('All')} icon="apps-outline" active={cat === ''} onPress={() => setCat('')} />
        {Object.entries(CATS).map(([k, v]) => (
          <Pill key={k} label={t(v.label)} icon={CAT_ICON[k]} active={cat === k} onPress={() => setCat(k)} />
        ))}
      </PillRow>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {feed.data && items.length === 0 && (
        <Empty title={q ? t('No matches') : t('Nothing planned yet')}>
          {q ? t('Try another search.') : t('Be the first to host.')}
        </Empty>
      )}

      {next.length > 0 && (
        <Reveal index={0} style={{ gap: 12 }}>
          <SectionHeader title={t('Next up')} />
          {next.length === 1 ? (
            <View style={{ width: '100%', maxWidth: 480 }}>
              <NextUpCard a={next[0].activity} status={{ label: t(next[0].label), tone: next[0].tone }} />
            </View>
          ) : (
            // several plans in the next 3 hours: swipe through them, soonest first
            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + 12} snapToAlignment="start" decelerationRate="fast" disableIntervalMomentum style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}>
              {next.map((x) => (
                <View key={x.key} style={{ width: cardW }}>
                  <NextUpCard a={x.activity} status={{ label: t(x.label), tone: x.tone }} />
                </View>
              ))}
            </ScrollView>
          )}
          {more.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Plus {n} more in the next 3 hours. Show them', { n: more.length })}
              hitSlop={6}
              onPress={() => setSoonOpen(true)}
              style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
            >
              <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('+{n} more in the next 3 hours', { n: more.length })}</Txt>
              <Ionicons name="chevron-forward" size={13} color={c.forest} />
            </Pressable>
          ) : null}
        </Reveal>
      )}

      <ListSection index={1} title={t('Happening soon')} list={when === 'any' || when === 'soon' ? soon : []} max={MAX} onMore={() => go('/activities?section=soon')} />
      <ListSection index={2} title={t('Tonight')} list={when === 'any' || when === 'tonight' ? sections[1].items : []} max={MAX} onMore={() => go('/activities?section=tonight')} />
      <ListSection index={3} title={t('Tomorrow')} list={when === 'any' || when === 'tomorrow' ? sections[2].items : []} max={MAX} onMore={() => go('/activities?section=tomorrow')} />

      <Reveal index={4}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: 20, padding: 16 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{t('Nothing you fancy?')}</Txt>
          </View>
          <Btn title={t('Host')} small onPress={() => go('/create')} />
        </Card>
      </Reveal>

      <Sheet visible={soonOpen && more.length > 0} title={t('Also coming up in the next 3 hours')} onClose={() => setSoonOpen(false)}>
        {more.map((x) => (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={t('{title}, {from} to {to}, {status}', { title: x.activity.title, from: hhmm(x.activity.startsAt), to: hhmm(x.activity.endsAt), status: t(x.label) })}
            onPress={() => {
              setSoonOpen(false);
              go(`/activity/${x.activity.id}`);
            }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ width: 84 }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{hhmm(x.activity.startsAt)}</Txt>
              <Txt variant="small" numberOfLines={1} style={{ fontSize: 11 }}>{+new Date(x.activity.startsAt) <= now ? t('now') : t('to {time}', { time: hhmm(x.activity.endsAt) })}</Txt>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{x.activity.title}</Txt>
              <View style={{ flexDirection: 'row' }}><Chip label={t(x.label)} tone={x.tone} /></View>
            </View>
            <Ionicons name="chevron-forward" size={16} color={c.muted} />
          </Pressable>
        ))}
      </Sheet>

      <Sheet visible={filterOpen} title={t('Show')} onClose={() => setFilterOpen(false)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['any', 'Everything'],
              ['soon', 'Next 2 hours'],
              ['tonight', 'Tonight'],
              ['tomorrow', 'Tomorrow'],
            ] as const
          ).map(([k, label]) => (
            <Pill key={k} label={t(label)} active={when === k} onPress={() => setWhen(k)} />
          ))}
        </View>
        <Btn title={t('Done')} onPress={() => setFilterOpen(false)} />
      </Sheet>

    </Screen>
  );
}

/** A titled list of rows (up to `max`), with "See all" on the right. Nothing is drawn when the list is empty. */
function ListSection({ index, title, list, max, onMore }: { index: number; title: string; list: Activity[]; max: number; onMore: () => void }) {
  const { c } = useTheme();
  const { t } = useT();
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
          accessibilityLabel={t('Plus {n} more in {title}. See all', { n: hidden, title })}
          hitSlop={6}
          onPress={onMore}
          style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
        >
          <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('+{n} more activities · See all', { n: hidden })}</Txt>
          <Ionicons name="chevron-forward" size={13} color={c.forest} />
        </Pressable>
      ) : null}
    </Reveal>
  );
}
