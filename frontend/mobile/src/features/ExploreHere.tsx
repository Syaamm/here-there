import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { ActivityBig, ActivityRow, NextUpCard } from '@/components/Cards';

/**
 * The client trial: the HERE lists show only the single row cards (a picture at the left, title, time and place, who is going), one under the
 * other. Set this to true to bring back the big picture cards at the top of the first list ("roll back to the main cards"). Nothing else changes.
 */
const BIG_FEED_CARDS = false; // the client's choice: single row cards only
import { MonthCalendar } from '@/components/CreateParts';
import { shortDay } from '@/components/DateRangeSheet';
import { CategoryChips } from '@/components/CategoryChips';
import { HERE_BAND, HereHeader } from '@/components/HereHeader';
import { Reveal } from '@/components/Reveal';
import { ModeTabs } from '@/components/TabHeader';
import { ThereChip, ThereFilterSheet, ThereLabel } from '@/components/ThereParts';
import { VerifyBanner } from '@/components/VerifyBanner';
import { Btn, Card, Chip, Empty, ErrorBanner, Pill, Screen, SearchBar, SectionHeader, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { get, type Activity } from '@/lib/api';
import { CATS } from '@/lib/constants';
import { useClock } from '@/lib/clock';
import { comingUp, happeningNow, type MyActivitiesData } from '@/lib/myActivities';
import { useLayout } from '@/lib/layout';
import { hhmm } from '@/lib/format';
import { cityQuery, useAreaKm, useCity, useCityPos } from '@/lib/city';
import { matchesSearch } from '@/lib/searchTerms';
import { feedRange, splitFeed } from '@/lib/feed';
import { useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';

import { sc, sp, sph } from '@/lib/scale';
/** HERE · Explore: a time-sensitive feed of what is happening nearby. */
export function ExploreHere() {
  const { t } = useT();
  const go = useGo();
  const { c } = useTheme();
  const [city, setCity] = useCity();
  const cityPos = useCityPos();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null); // the round category chips under the search
  // (the dark band's light clock and battery are handled by Screen)
  // the filter button: which part of the day to show
  const [when, setWhen] = useState<'any' | 'soon' | 'tonight' | 'tomorrow' | 'later' | 'date'>('any');
  // "Later" opens a calendar: picking a day shows only what is on that day (loaded for that day, not from the general feed)
  const [day, setDay] = useState<Date | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const dayStart = day ? new Date(day.getFullYear(), day.getMonth(), day.getDate()) : null;
  const [filterOpen, setFilterOpen] = useState(false);
  const [openOnly, setOpenOnly] = useState(false); // only the activities that still have a place
  // how far from the city's centre: the admin sets the most (the city's coverage, 25 km unless changed in Settings > Places & limits), and
  // the person may ask for less. null = all of the area. Only when the city's centre is known (a distance needs a place to measure from).
  const areaKm = useAreaKm();
  const [distance, setDistance] = useState<number | null>(null);
  const distanceOptions = [...[10, 15, 25].filter((k) => k < areaKm), areaKm];
  const reach: Record<string, string> = cityPos && distance !== null && distance < areaKm ? { radiusKm: String(distance) } : {};

  const feed = useLoad(
    () => {
      const [from, to] = feedRange();
      const p = new URLSearchParams({ ...cityQuery(city, cityPos), ...reach, from: from.toISOString(), to: to.toISOString(), limit: '50', sort: 'relevance' });
      // a chosen category is asked of the server, so the ranking (top picks first) and the paging work inside that category
      if (cat) p.set('category', cat);
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [city, cityPos, cat, distance, areaKm],
    60_000, // changes arrive by the live connection (below); this is only the slow fallback
    'feed:here',
    { keep: true, live: true },
  );
  const onDay = useLoad(
    () => {
      if (when !== 'date' || !dayStart) return Promise.resolve(null);
      const p = new URLSearchParams({ ...cityQuery(city, cityPos), ...reach, from: dayStart.toISOString(), to: new Date(+dayStart + 864e5).toISOString(), limit: '50' });
      return get<{ items: Activity[] }>(`/v1/activities?${p}`);
    },
    [when, dayStart ? +dayStart : 0, city, cityPos, distance, areaKm],
  );
  const dayItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = (onDay.data?.items ?? []).filter((a) => (!cat || a.category === cat) && (!openOnly || a.spotsLeft > 0));
    return needle ? all.filter((a) => matchesSearch(`${a.title} ${a.venueName} ${a.tags.join(' ')} ${a.category} ${CATS[a.category]?.label ?? ''} ${a.city ?? ''}`, needle)) : all;
  }, [onDay.data, q, cat, openOnly]);
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
    const all = (feed.data?.items ?? []).filter((a) => (!cat || a.category === cat) && (!openOnly || a.spotsLeft > 0));
    return needle ? all.filter((a) => matchesSearch(`${a.title} ${a.venueName} ${a.tags.join(' ')} ${a.category} ${CATS[a.category]?.label ?? ''} ${a.city ?? ''}`, needle)) : all;
  }, [feed.data, q, cat, openOnly]);

  // The clock moves on once a minute: an activity leaves "Happening soon" the minute it starts.
  const now = useClock(60_000);
  const sections = splitFeed(items, new Date(now));
  // Next up: only what is happening now or starts within 3 hours, soonest first.
  const soonAll = comingUp(mine.data, now, 3); // not started yet: what is on now is the pill at the top
  const liveNow = happeningNow(mine.data, now);
  const [liveOpen, setLiveOpen] = useState(false);
  // the cards show the two soonest; "+N more" appears only when there are more than two, and lists just the others
  // with a category chosen the page is about that kind of activity: Next up (your own plans of every kind) steps aside
  // searching or a category chosen: the page is only the matching activities, so Next up and the live pill step aside
  const typedWords = q.trim().length > 0; // something is typed in the search: results, not Next up and the time sections
  const searchingNow = typedWords || (when === 'date' && !!day); // a search, or one day picked in the calendar
  const next = cat || searchingNow ? [] : soonAll.slice(0, 2);
  const more = cat || searchingNow ? [] : soonAll.slice(2);
  // what is already in your Next up (you host it or are going) is not listed again under Happening soon
  const inNext = new Set([...next, ...more].map((x) => x.activity.id));
  const soon = sections[0].items.filter((a) => !inNext.has(a.id));
  const [soonOpen, setSoonOpen] = useState(false);
  const { width, gutter } = useLayout();
  const cardW = Math.min(480, width - gutter * 2 - 28); // a bit of the next card peeks in, so it is clear you can swipe
  const MAX = 4;
  // only the first section on the page has big cards: Next up when shown, else the first list that has any
  const byDay = when === 'date' && !!dayStart;
  const lists = byDay ? [[], [], [], []] : [
    when === 'any' || when === 'soon' ? soon : [],
    when === 'any' || when === 'tonight' ? sections[1].items : [],
    when === 'any' || when === 'tomorrow' ? sections[2].items : [],
    when === 'any' || when === 'later' ? sections[3].items : [],
  ];
  const bigAt = next.length > 0 ? -1 : lists.findIndex((l) => l.length > 0);

  return (
    <Screen tabBar wide collapse onRefresh={onRefresh} refreshing={refreshing} header={<HereHeader city={city} onPickCity={setCity} />} headerBg={HERE_BAND} bandTall style={{ paddingTop: sp(14) }}>

      <VerifyBanner />

      <ModeTabs />

      {/* what you are at right now: a small pill (one opens it, several open a list); Next up is only for what is still to come */}
      {liveNow.length > 0 && !searchingNow && !cat ? (
        <LivePill
          label={liveNow.length === 1 ? t("You're at {title} now", { title: liveNow[0].activity.title }) : t('{n} of your activities are happening now', { n: liveNow.length })}
          onPress={() => (liveNow.length === 1 ? go(`/activity/${liveNow[0].activity.id}`) : setLiveOpen(true))}
        />
      ) : null}

      <SearchBar value={q} onChangeText={setQ} placeholder={t('Search activities or neighborhoods')} onFilter={() => setFilterOpen(true)} filterActive={when !== 'any' || cat !== null || openOnly || (!!cityPos && distance !== null && distance < areaKm)} />
      <CategoryChips value={cat} onChange={setCat} />

      <ErrorBanner message={feed.error?.message} />
      {feed.loading && !feed.data && <Spinner />}

      {next.length > 0 && (
        <Reveal index={0} style={{ gap: sp(12) }}>
          <SectionHeader title={t('Next up')} />
          {/* each plan of yours is a card of its own, one under the other, soonest first */}
          <View style={{ gap: sp(12) }}>
            {next.map((x) => (
              <View key={x.key} style={{ width: '100%', maxWidth: sc(480) }}>
                <NextUpCard a={x.activity} status={{ label: t(x.label), tone: x.tone }} />
              </View>
            ))}
          </View>
          {more.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Plus {n} more in the next 3 hours. Show them', { n: more.length })}
              hitSlop={6}
              onPress={() => setSoonOpen(true)}
              style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: sc(34), paddingHorizontal: sph(14), borderRadius: sc(999), backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: sp(4) }, pressed && { opacity: 0.8 }]}
            >
              <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{t('+{n} more in the next 3 hours', { n: more.length })}</Txt>
              <Ionicons name="chevron-forward" size={sc(13)} color={c.forest} />
            </Pressable>
          ) : null}
        </Reveal>
      )}

      {/* the feed has nothing to list: said below Next up (your own plans come first), and "Nothing planned yet" only when you have no plan either */}
      {feed.data && items.length === 0 && (q || cat || next.length === 0) && (
        <Empty title={q || cat ? t('No matches') : t('Nothing planned yet')}>
          {q || cat ? t('Try another search.') : t('Be the first to host.')}
        </Empty>
      )}

      {/* a day picked in the filter's calendar: only that day, with a chip to clear it */}
      {byDay && dayStart ? (
        <View style={{ gap: sp(12) }}>
          {/* the day picked: tapping it opens the filter again (calendar on that day) to pick another day or go back to Everything;
              the small cross clears it straight away */}
          <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', borderRadius: sc(999), backgroundColor: c.accentSoft }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Showing {date}. Change the date', { date: shortDay(dayStart) })}
              onPress={() => {
                setMonth(new Date(dayStart));
                setFilterOpen(true);
              }}
              style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(6), minHeight: sc(34), paddingLeft: sph(14), paddingRight: sph(6) }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="calendar-outline" size={sc(14)} color={c.forest} />
              <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{shortDay(dayStart)}</Txt>
              <Ionicons name="chevron-down" size={sc(13)} color={c.forest} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('Clear the date')}
              hitSlop={8}
              onPress={() => {
                setWhen('any');
                setDay(null);
              }}
              style={({ pressed }) => [{ minHeight: sc(34), paddingLeft: sph(4), paddingRight: sph(12), justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="close" size={sc(15)} color={c.forest} />
            </Pressable>
          </View>
          {onDay.loading && !onDay.data ? <Spinner /> : null}
          {onDay.data && dayItems.length === 0 ? <Empty title={t('Nothing on {date} yet', { date: shortDay(dayStart) })}>{t('Try another day, or host something yourself.')}</Empty> : null}
          <ListSection index={1} big title={t('On {date}', { date: shortDay(dayStart) })} list={dayItems} max={50} onMore={() => undefined} />
        </View>
      ) : null}

      {/* typed words: one section of results, in place of Next up and the time sections (a day picked in the calendar has its own section above) */}
      {typedWords && !(when === 'date' && day) ? (
        <Reveal key={q.trim().toLowerCase()} index={0} style={{ gap: sp(12) }}>
          <SectionHeader title={items.length ? t('Search results ({n})', { n: items.length }) : t('Search results')} />
          {items.length ? items.map((a) => <ActivityRow key={a.id} a={a} />) : <Empty icon="search-outline" title={t('Nothing found')}>{t('Try other words or another spelling. You can search in English or Italian.')}</Empty>}
        </Reveal>
      ) : null}
      {!typedWords ? (
        <>
      <ListSection index={1} big={bigAt === 0} title={t('Happening soon')} list={lists[0]} max={MAX} onMore={() => go(`/activities?section=soon${cat ? `&category=${cat}` : ''}`)} />
      <ListSection index={2} big={bigAt === 1} title={t('Tonight')} list={lists[1]} max={MAX} onMore={() => go(`/activities?section=tonight${cat ? `&category=${cat}` : ''}`)} />
      <ListSection index={3} big={bigAt === 2} title={t('Tomorrow')} list={lists[2]} max={MAX} onMore={() => go(`/activities?section=tomorrow${cat ? `&category=${cat}` : ''}`)} />
      <ListSection index={3} big={bigAt === 3} title={t('Later')} list={lists[3]} max={MAX} onMore={() => go(`/activities?section=later${cat ? `&category=${cat}` : ''}`)} />
        </>
      ) : null}

      <Reveal index={4}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.sand, borderWidth: 0, borderRadius: sc(20), padding: sp(16) }}>
          <View style={{ flex: 1, paddingRight: sph(12) }}>
            <Txt variant="h3" style={{ fontSize: 16, lineHeight: 21 }}>{t('Nothing you fancy?')}</Txt>
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
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(10), paddingVertical: sp(8), borderBottomWidth: 1, borderBottomColor: c.line }, pressed && { opacity: 0.8 }]}
          >
            <View style={{ width: sc(84) }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 16, lineHeight: 21 }}>{hhmm(x.activity.startsAt)}</Txt>
              <Txt variant="small" numberOfLines={1} style={{ fontSize: 12 }}>{+new Date(x.activity.startsAt) <= now ? t('now') : t('to {time}', { time: hhmm(x.activity.endsAt) })}</Txt>
            </View>
            <View style={{ flex: 1, gap: sc(3) }}>
              <Txt variant="h3" numberOfLines={1} style={{ fontSize: 16, lineHeight: 21 }}>{x.activity.title}</Txt>
              <View style={{ flexDirection: 'row' }}><Chip label={t(x.label)} tone={x.tone} /></View>
            </View>
            <Ionicons name="chevron-forward" size={sc(16)} color={c.muted} />
          </Pressable>
        ))}
      </Sheet>

      {/* the filter is the same sheet as THERE's: when, what kind of activity, and only the ones with room */}
      <ThereFilterSheet
        compact
        heightRatio={0.78}
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <Btn title={t('Show results')} onPress={() => setFilterOpen(false)} />
            <Btn
              title={t('Clear all')}
              variant="secondary"
              onPress={() => {
                setWhen('any');
                setDay(null);
                setCat(null);
                setOpenOnly(false);
                setDistance(null);
              }}
            />
          </>
        }
      >
        <View style={{ gap: sp(8) }}>
          <ThereLabel>{t('When')}</ThereLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) }}>
            {(
              [
                ['any', 'Everything'],
                ['soon', 'Next 2 hours'],
                ['tonight', 'Tonight'],
                ['tomorrow', 'Tomorrow'],
                ['later', 'Later'],
              ] as const
            ).map(([k, label]) => (
              <ThereChip key={k} label={t(label)} active={when === k || (k === 'later' && when === 'date')} onPress={() => (setWhen(k), setDay(null))} />
            ))}
          </View>
        </View>
        {/* Later: everything after tomorrow, or pick one day in the calendar to see only that day */}
        {when === 'later' || when === 'date' ? (
          <View style={{ gap: sp(8) }}>
            <Txt variant="small">{t('Pick a day to see only what is on that day.')}</Txt>
            <MonthCalendar
              month={month}
              onMonth={setMonth}
              selected={dayStart ?? new Date(0)}
              min={new Date(new Date().setHours(0, 0, 0, 0))}
              max={new Date(Date.now() + 365 * 864e5)}
              onPick={(d) => {
                setDay(d);
                setWhen('date');
                setFilterOpen(false);
              }}
            />
          </View>
        ) : null}
        {cityPos ? (
          <View style={{ gap: sp(8) }}>
            <ThereLabel>{t('Distance')}</ThereLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) }}>
              {distanceOptions.map((k) => (
                <ThereChip key={k} label={t('Within {n} km', { n: k })} active={(distance ?? areaKm) === k} onPress={() => setDistance(k >= areaKm ? null : k)} />
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ gap: sp(8) }}>
          <ThereLabel>{t('What kind of activity')}</ThereLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) }}>
            <ThereChip label={t('All')} active={cat === null} onPress={() => setCat(null)} />
            {Object.entries(CATS).map(([k, v]) => (
              <ThereChip key={k} label={t(v.label)} active={cat === k} onPress={() => setCat(cat === k ? null : k)} />
            ))}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) }}>
          <ThereChip label={t('Only activities with open places')} active={openOnly} onPress={() => setOpenOnly(!openOnly)} />
        </View>
      </ThereFilterSheet>

      <Sheet visible={liveOpen} title={t('Happening now')} onClose={() => setLiveOpen(false)}>
        <View style={{ gap: sp(10) }}>
          {liveNow.map((x) => (
            <ActivityRow key={x.key} a={x.activity} />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

/** "You're at Brunch in Brera now ›": a pill with a softly pulsing green dot (the pulse runs on the native driver). */
export function LivePill({ label, onPress }: { label: string; onPress: () => void }) {
  const { c } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(pulse, { toValue: 0.35, duration: 800, useNativeDriver: true }), Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true })]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: sp(8), minHeight: sc(36), paddingHorizontal: sph(14), borderRadius: sc(999), backgroundColor: c.accentSoft }, pressed && { transform: [{ scale: 0.97 }] }]}
    >
      <Animated.View style={{ width: sc(8), height: sc(8), borderRadius: sc(4), backgroundColor: c.green, opacity: pulse }} />
      <Txt variant="label" color={c.forest} numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, lineHeight: 16 }}>{label}</Txt>
      <Ionicons name="chevron-forward" size={sc(14)} color={c.forest} />
    </Pressable>
  );
}

/** A titled list of rows (up to `max`), with "See all" on the right. Nothing is drawn when the list is empty. */
function ListSection({ index, big, title, list, max, onMore }: { index: number; /** the first section on the page keeps the big cards; the others are compact rows */ big: boolean; title: string; list: Activity[]; max: number; onMore: () => void }) {
  const { c } = useTheme();
  const { t } = useT();
  if (list.length === 0) return null;
  // a section with more than 20 shows only 3, with a hint for the rest; "See all" opens just this section
  const over = list.length > 20;
  const count = over ? 3 : max;
  const hidden = list.length - count; // how many are not on this page: "See all" opens them
  return (
    <Reveal index={index} style={{ gap: sp(12) }}>
      <SectionHeader title={title} />
      {list.slice(0, count).map((a) =>
        big && BIG_FEED_CARDS ? <ActivityBig key={a.id} a={a} tag={a.status === 'in_progress' ? t('Happening now') : t(CATS[a.category]?.label ?? a.category)} /> : <ActivityRow key={a.id} a={a} />,
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
