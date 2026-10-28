import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { TripNextUpCard, TripRow } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Brand, ModeTabs } from '@/components/TabHeader';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Btn, Card, Chip, Empty, ErrorBanner, Pill, PillRow, Screen, SearchBar, SectionHeader, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { get, type MyTripsPage, type Trip } from '@/lib/api';
import { dateSpan } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { TRIP_TAGS } from '@/lib/constants';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
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
  const { t } = useT();
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
  // Next up is about YOU: the trips you organise, are going on, or have applied to, soonest first (a handful is enough here)
  const mine = useLoad(() => get<MyTripsPage>('/v1/me/trips/page?upcoming=1&limit=6'), [], undefined, 'me:trips:next');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([feed.reload(), mine.reload()]));

  // The API searches by destination only, so free text here filters the loaded trips on the device.
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = (feed.data?.items ?? []).filter((x) => +new Date(x.dateStart) > Date.now()).sort((a, b) => +new Date(a.dateStart) - +new Date(b.dateStart));
    return needle ? all.filter((x) => `${x.title} ${x.destination} ${x.tags.join(' ')}`.toLowerCase().includes(needle)) : all;
  }, [feed.data, q]);

  const now = Date.now();
  const inDays = (t: Trip) => (+new Date(t.dateStart) - now) / DAY;
  const soon = items.filter((t) => inDays(t) < 30);
  const season = items.filter((t) => inDays(t) >= 30 && inDays(t) < 90);
  const later = items.filter((t) => inDays(t) >= 90);

  // the server sends only trips still ahead, soonest first; a trip already under way counts too
  const mineAll = (mine.data?.items ?? []).map((x) =>
    x.row === 'joined'
      ? { key: x.id, t: x as Trip, label: x.role === 'host' ? t('You organise this') : t('Going'), tone: 'ok' as const }
      : { key: x.trip.id, t: x.trip, label: x.state === 'pending' ? t('Request pending') : t('On the waiting list'), tone: 'warn' as const },
  );
  // a trip that has started is no longer "next": it moves to Taking part (an application to one is simply over)
  const underWay = (x: { t: Trip }) => +new Date(x.t.dateStart) <= now;
  const taking = mineAll.filter((x) => underWay(x) && x.tone === 'ok');
  const ahead = mineAll.filter((x) => !underWay(x));
  // the cards show the two soonest; "+N more" appears only when there are more than two, and lists just the others
  const next = ahead.slice(0, 2);
  const more = ahead.slice(2);
  const [moreOpen, setMoreOpen] = useState(false);
  const { width, gutter } = useLayout();
  const cardW = Math.min(480, width - gutter * 2 - 28); // a bit of the next card peeks in, so it is clear you can swipe
  const MAX = 4;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing} header={<Brand />}>

      <VerifyBanner />

      <ModeTabs />

      <Txt variant="h1" style={{ fontSize: 26, lineHeight: 32 }}>{t('Where to next?')}</Txt>
      <SearchBar value={q} onChangeText={setQ} placeholder={t('Search a destination, trip or country')} onFilter={() => setFilterOpen(true)} filterActive={when !== 'any'} />

      <PillRow>
        <Pill label={t('All')} icon="apps-outline" active={tag === ''} onPress={() => setTag('')} />
        {TRIP_TAGS.map((g) => (
          <Pill key={g} label={t(g[0].toUpperCase() + g.slice(1))} icon={TAG_ICON[g]} active={tag === g} onPress={() => setTag(g)} />
        ))}
      </PillRow>

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {feed.data && items.length === 0 && (
        <Empty title={q || tag ? t('No trips match') : t('No trips yet')}>{q || tag ? t('Try another search.') : t('Be the first to propose one.')}</Empty>
      )}

      {taking.length > 0 && (
        <Reveal index={0} style={{ gap: 12 }}>
          <SectionHeader title={t('Taking part')} />
          {taking.length === 1 ? (
            <View style={{ width: '100%', maxWidth: 480 }}>
              <TripNextUpCard t={taking[0].t} status={{ label: t(taking[0].label), tone: taking[0].tone }} />
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + 12} snapToAlignment="start" decelerationRate="fast" disableIntervalMomentum style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}>
              {taking.map((x) => (
                <View key={x.key} style={{ width: cardW }}>
                  <TripNextUpCard t={x.t} status={{ label: t(x.label), tone: x.tone }} />
                </View>
              ))}
            </ScrollView>
          )}
        </Reveal>
      )}

      {next.length > 0 && (
        <Reveal index={0} style={{ gap: 12 }}>
          <SectionHeader title={t('Next up')} />
          {next.length === 1 ? (
            <View style={{ width: '100%', maxWidth: 480 }}>
              <TripNextUpCard t={next[0].t} status={{ label: t(next[0].label), tone: next[0].tone }} />
            </View>
          ) : (
            // several trips of yours: swipe through them, soonest first
            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={cardW + 12} snapToAlignment="start" decelerationRate="fast" disableIntervalMomentum style={{ marginHorizontal: -gutter }} contentContainerStyle={{ paddingHorizontal: gutter, gap: 12 }}>
              {next.map((x) => (
                <View key={x.key} style={{ width: cardW }}>
                  <TripNextUpCard t={x.t} status={{ label: t(x.label), tone: x.tone }} />
                </View>
              ))}
            </ScrollView>
          )}
          {more.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Plus {n} more of your trips. Show them', { n: more.length })}
              hitSlop={6}
              onPress={() => setMoreOpen(true)}
              style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
            >
              <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('+{n} more of your trips', { n: more.length })}</Txt>
              <Ionicons name="chevron-forward" size={13} color={c.forest} />
            </Pressable>
          ) : null}
        </Reveal>
      )}

      <ListSection index={1} title={t('Leaving soon')} list={when === 'any' || when === 'month' ? soon : []} max={MAX} onMore={() => go('/trips?section=soon')} />
      <ListSection index={2} title={t('In the next few months')} list={when === 'any' || when === 'quarter' ? season : []} max={MAX} onMore={() => go('/trips?section=season')} />
      <ListSection index={3} title={t('Later')} list={when === 'any' || when === 'later' ? later : []} max={MAX} onMore={() => go('/trips?section=later')} />


      <Reveal index={4}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: 20, padding: 16 }}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{t('Have a trip in mind?')}</Txt>
          </View>
          <Btn title={t('Propose')} small onPress={() => go('/create')} />
        </Card>
      </Reveal>

      <Sheet visible={moreOpen && more.length > 0} title={t('Also on your trips')} onClose={() => setMoreOpen(false)}>
        {more.map((x) => (
          <Pressable
            key={x.key}
            accessibilityRole="button"
            accessibilityLabel={`${x.t.destination}, ${dateSpan(x.t.dateStart, x.t.dateEnd)}, ${t(x.label)}`}
            onPress={() => {
              setMoreOpen(false);
              go(`/trip/${x.t.id}`);
            }}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{x.t.destination}</Txt>
              <Txt variant="small" numberOfLines={1} style={{ fontSize: 11 }}>{dateSpan(x.t.dateStart, x.t.dateEnd)}</Txt>
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
              ['month', 'Next 30 days'],
              ['quarter', '1 to 3 months'],
              ['later', 'Later than that'],
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

/** A titled list of trip rows (up to `max`), with "See all" on the right. Nothing is drawn when the list is empty. */
function ListSection({ index, title, list, max, onMore }: { index: number; title: string; list: Trip[]; max: number; onMore: () => void }) {
  const { c } = useTheme();
  const { t } = useT();
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
          accessibilityLabel={t('Plus {n} more in {title}. See all', { n: hidden, title })}
          hitSlop={6}
          onPress={onMore}
          style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}
        >
          <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('+{n} more trips · See all', { n: hidden })}</Txt>
          <Ionicons name="chevron-forward" size={13} color={c.forest} />
        </Pressable>
      ) : null}
    </Reveal>
  );
}
