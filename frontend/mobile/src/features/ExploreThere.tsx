import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { TripBig, TripNextUpCard, TripRow } from '@/components/Cards';

/** The client's choice, as in HERE: the trip lists show single row cards only. Set to true to bring back the big first card. */
const BIG_TRIP_CARDS = false;
import { Reveal } from '@/components/Reveal';
import { ModeTabs } from '@/components/TabHeader';
import { ThereChip, ThereHomeHeader, ThereLabel, ThereSearchField, TripStyleChips } from '@/components/ThereParts';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Btn, Card, Chip, Empty, ErrorBanner, Screen, SectionHeader, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { get, type MyTripsPage, type Trip } from '@/lib/api';
import { useCity } from '@/lib/city';
import { matchesSearch } from '@/lib/searchTerms';
import { meetsThere } from '@/lib/travelStyle';
import { dateSpan } from '@/lib/format';
import { useLayout } from '@/lib/layout';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';
import { ThereFiltersSheet, useThereFilters } from './ThereFilters';
import { LivePill } from './ExploreHere';

import { sc, sp, sph } from '@/lib/scale';
type When = 'any' | 'month' | 'quarter' | 'later';
const DAY = 864e5;
/** "Leaving soon" is the next two weeks. */
export const SOON_DAYS = 14;

/** THERE · Explore: trip proposals from other travelers. Not a travel agency. Budgets are estimates. */
export function ExploreThere() {
  const { t } = useT();
  const go = useGo();
  const { c } = useTheme();
  const [city, setCity] = useCity();
  const [q, setQ] = useState('');
  const [style, setStyle] = useState<string | null>(null); // the round travel-style chips under the search
  // the filter button: how far ahead to look
  const [when, setWhen] = useState<When>('any');
  const [filterOpen, setFilterOpen] = useState(false);
  // the same full filter sheet as the Search tab; its destination is the search field above. Search applies it to the feed.
  const f = useThereFilters({ destination: q, setDestination: setQ });
  const [applied, setApplied] = useState('');

  // excludeMine: the trips you host, are on or applied to are in Next up / Taking part, never again in the lists below.
  // The server ranks them (friends going most, then people you follow, then your followers, then leaving sooner).
  // a chosen travel interest is asked of the server (as the HERE categories are), so the ranking and the paging work inside it
  const feed = useLoad(() => get<{ total: number; items: Trip[] }>(`/v1/trips?limit=50&excludeMine=true${style ? `&tags=${style}` : ''}${applied}`), [applied, style], 60_000, 'feed:there', { keep: true, live: true });
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
    // kept in the server's ranked order (not re-sorted by date): within each section the best match for you comes first
    const all = (feed.data?.items ?? []).filter((x) => +new Date(x.dateStart) > Date.now() && (!style || x.tags.includes(style)));
    const found = needle ? all.filter((x) => matchesSearch(`${x.title} ${x.destination} ${x.originCity} ${x.tags.join(' ')}`, needle)) : all;
    // "Travel together" trips leave from a city: the ones leaving from the city you are in come first (the server's order is kept inside each
    // group). Trips where everyone meets at the destination do not depend on a city, so they keep their place.
    const home = (city || '').split(',')[0].trim().toLowerCase();
    const fromHere = (x: Trip) => !!home && !meetsThere(x) && x.originCity.split(',')[0].trim().toLowerCase() === home;
    return [...found.filter(fromHere), ...found.filter((x) => !fromHere(x))];
  }, [feed.data, q, style, city]);

  const now = Date.now();
  const inDays = (t: Trip) => (+new Date(t.dateStart) - now) / DAY;
  // Leaving soon = really soon: the next two weeks (the same edges as the "See all" pages, app/trips.tsx)
  const mineIds = new Set((mine.data?.items ?? []).map((x) => (x.row === 'joined' ? x.id : x.trip.id)));
  const soon = items.filter((t) => inDays(t) < SOON_DAYS && !mineIds.has(t.id));
  const season = items.filter((t) => inDays(t) >= SOON_DAYS && inDays(t) < 90 && !mineIds.has(t.id));
  const later = items.filter((t) => inDays(t) >= 90 && !mineIds.has(t.id));

  // the server sends only trips still ahead, soonest first; a trip already under way counts too
  const mineAll = (mine.data?.items ?? []).map((x) =>
    x.row === 'joined'
      ? { key: x.id, t: x as Trip, label: x.role === 'host' ? t('You organise this') : t('Going'), tone: 'ok' as const }
      : { key: x.trip.id, t: x.trip, label: x.state === 'pending' ? t('Request pending') : t('On the waiting list'), tone: 'warn' as const },
  );
  // a trip that has started is no longer "next": it moves to Taking part (an application to one is simply over)
  const underWay = (x: { t: Trip }) => +new Date(x.t.dateStart) <= now;
  const typedWords = q.trim().length > 0; // something is typed in the search: results, not Next up, Taking part and the time sections
  const taking = style || typedWords ? [] : mineAll.filter((x) => underWay(x) && x.tone === 'ok');
  const ahead = mineAll.filter((x) => !underWay(x));
  // the cards show the two soonest; "+N more" appears only when there are more than two, and lists just the others
  // with a travel interest chosen the page is only about those trips: your own (Next up, Taking part) step aside, as in HERE
  const next = style || typedWords ? [] : ahead.slice(0, 2);
  const more = style || typedWords ? [] : ahead.slice(2);
  const [moreOpen, setMoreOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false); // the trips under way, when there are several
  const { width, gutter } = useLayout();
  const cardW = Math.min(480, width - gutter * 2 - 28); // a bit of the next card peeks in, so it is clear you can swipe
  const MAX = 4;
  // only the first section on the page has big cards: Taking part / Next up when shown, else the first trip list that has any
  const lists = [when === 'any' || when === 'month' ? soon : [], when === 'any' || when === 'quarter' ? season : [], when === 'any' || when === 'later' ? later : []];
  const bigAt = next.length > 0 ? -1 : lists.findIndex((l) => l.length > 0);

  return (
    <Screen tabBar wide collapse onRefresh={onRefresh} refreshing={refreshing} header={<ThereHomeHeader city={city} onPickCity={setCity} />} bandTall style={{ paddingTop: sp(14) }}>

      <VerifyBanner />

      <ModeTabs />

      <ThereSearchField value={q} onChangeText={setQ} placeholder={t('Where next? For example, Japan')} onFilter={() => setFilterOpen(true)} filterActive={when !== 'any' || f.active} />
      <TripStyleChips value={style} onChange={setStyle} />

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {/* a trip you are on right now: a small pill with a pulsing dot, as in HERE (one opens it, several open a list) */}
      {taking.length > 0 && !q.trim() ? (
        <LivePill
          label={taking.length === 1 ? t("You're on {title} now", { title: taking[0].t.destination }) : t('{n} of your trips are under way', { n: taking.length })}
          onPress={() => (taking.length === 1 ? go(`/trip/${taking[0].t.id}`) : setLiveOpen(true))}
        />
      ) : null}

      {next.length > 0 && (
        <Reveal index={0} style={{ gap: sp(12) }}>
          <SectionHeader title={t('Next up')} />
          {/* each plan of yours is a card of its own, one under the other, soonest first */}
          <View style={{ gap: sp(12) }}>
            {next.map((x) => (
              <View key={x.key} style={{ width: '100%', maxWidth: sc(480) }}>
                <TripNextUpCard t={x.t} status={{ label: t(x.label), tone: x.tone }} />
              </View>
            ))}
          </View>
          {more.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Plus {n} more of your trips. Show them', { n: more.length })}
              hitSlop={6}
              onPress={() => setMoreOpen(true)}
              style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: sc(34), paddingHorizontal: sph(14), borderRadius: sc(999), backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: sp(4) }, pressed && { opacity: 0.8 }]}
            >
              <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('+{n} more of your trips', { n: more.length })}</Txt>
              <Ionicons name="chevron-forward" size={sc(13)} color={c.forest} />
            </Pressable>
          ) : null}
        </Reveal>
      )}

      {/* the feed has nothing to list: said below your own trips, and "No trips yet" only when you have none either */}
      {feed.data && items.length === 0 && (q || style || (next.length === 0 && taking.length === 0)) && (
        <Empty title={q || style ? t('No trips match') : t('No trips yet')}>{q || style ? t('Try another search.') : t('Be the first to propose one.')}</Empty>
      )}

      {/* typed words: one section of results, in place of Next up and the time sections */}
      {typedWords ? (
        <Reveal key={q.trim().toLowerCase()} index={0} style={{ gap: sp(12) }}>
          <SectionHeader title={items.length ? t('Search results ({n})', { n: items.length }) : t('Search results')} />
          {items.length ? items.map((x) => <TripRow key={x.id} t={x} />) : <Empty icon="search-outline" title={t('Nothing found')}>{t('Try other words or another spelling. You can search in English or Italian.')}</Empty>}
        </Reveal>
      ) : null}
      {!typedWords ? (
        <>
      <ListSection index={1} big={bigAt === 0} title={t('Happening soon')} list={lists[0]} max={MAX} onMore={() => go(`/trips?section=soon${style ? `&style=${style}` : ''}`)} />
      <ListSection index={2} big={bigAt === 1} title={t('Coming up')} list={lists[1]} max={MAX} onMore={() => go(`/trips?section=season${style ? `&style=${style}` : ''}`)} />
      <ListSection index={3} big={bigAt === 2} title={t('Later')} list={lists[2]} max={MAX} onMore={() => go(`/trips?section=later${style ? `&style=${style}` : ''}`)} />
        </>
      ) : null}


      <Reveal index={4}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: sc(20), padding: sp(16) }}>
          <View style={{ flex: 1, paddingRight: sph(12) }}>
            <Txt variant="h3" style={{ fontSize: 16, lineHeight: 21 }}>{t('Have a trip in mind?')}</Txt>
          </View>
          <Btn title={t('Propose')} small onPress={() => go('/create')} />
        </Card>
      </Reveal>

      <Sheet visible={liveOpen && taking.length > 1} title={t('Under way now')} onClose={() => setLiveOpen(false)}>
        <View style={{ gap: sp(10) }}>
          {taking.map((x) => (
            <TripRow key={x.key} t={x.t} />
          ))}
        </View>
      </Sheet>

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
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(10), paddingVertical: sp(8), borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ flex: 1, gap: sc(3) }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 16, lineHeight: 21 }}>{x.t.destination}</Txt>
              <Txt variant="small" numberOfLines={1} style={{ fontSize: 12 }}>{dateSpan(x.t.dateStart, x.t.dateEnd)}</Txt>
              <View style={{ flexDirection: 'row' }}><Chip label={t(x.label)} tone={x.tone} /></View>
            </View>
            <Ionicons name="chevron-forward" size={sc(16)} color={c.muted} />
          </Pressable>
        ))}
      </Sheet>

      <ThereFiltersSheet
        f={f}
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        searching={feed.loading && !feed.data}
        // the destination is already the search field (filtered on the device), so only the other choices go to the server
        onSearch={() => setApplied(f.active ? `&${new URLSearchParams(f.build('')).toString()}` : '')}
        extra={
          <View style={{ gap: sp(12) }}>
            <ThereLabel>{t('Show')}</ThereLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(10) }}>
              {(
                [
                  ['any', 'Everything'],
                  ['month', 'Next 2 weeks'],
                  ['quarter', '2 weeks to 3 months'],
                  ['later', 'Later than that'],
                ] as const
              ).map(([k, label]) => (
                <ThereChip key={k} label={t(label)} active={when === k} onPress={() => setWhen(k)} />
              ))}
            </View>
          </View>
        }
      />
    </Screen>
  );
}

/** A titled list of trip rows (up to `max`), with "See all" on the right. Nothing is drawn when the list is empty. */
function ListSection({ index, big, title, list, max, onMore }: { index: number; /** the first section on the page keeps the big cards; the others are compact rows */ big: boolean; title: string; list: Trip[]; max: number; onMore: () => void }) {
  const { c } = useTheme();
  const { t } = useT();
  if (list.length === 0) return null;
  // a group with more than 20 shows only 3, with a hint for the rest; "See all" opens just this group
  const over = list.length > 20;
  const count = over ? 3 : max;
  const hidden = list.length - count; // how many are not on this page: "See all" opens them
  return (
    <Reveal index={index} style={{ gap: sp(12) }}>
      <SectionHeader title={title} />
      {list.slice(0, count).map((trip) =>
        big && BIG_TRIP_CARDS ? <TripBig key={trip.id} t={trip} tag={trip.tags[0] ? t(trip.tags[0][0].toUpperCase() + trip.tags[0].slice(1)) : undefined} /> : <TripRow key={trip.id} t={trip} />,
      )}
      {hidden > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('See all: {title}', { title })}
          hitSlop={6}
          onPress={onMore}
          style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: sc(34), paddingHorizontal: sph(14), borderRadius: sc(999), backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: sp(4) }, pressed && { opacity: 0.8 }]}
        >
          <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('See all')}</Txt>
          <Ionicons name="chevron-forward" size={sc(13)} color={c.forest} />
        </Pressable>
      ) : null}
    </Reveal>
  );
}
