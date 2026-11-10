import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Empty, ErrorBanner, Grid, Screen, Spinner, Txt } from '@/components/ui';
import { type Activity } from '@/lib/api';
import { cityQuery, useCity, useCityPos } from '@/lib/city';
import { feedRange } from '@/lib/feed';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';

const EMPTY: Record<string, string> = {
  soon: 'Nothing starts in the next 2 hours.',
  tonight: 'Nothing else planned for tonight.',
  tomorrow: 'Nothing planned for tomorrow yet.',
  later: 'Nothing planned further ahead yet.',
};
const SECTIONS = [
  { id: 'soon', title: 'Next 2 hours' },
  { id: 'tonight', title: 'Tonight' },
  { id: 'tomorrow', title: 'Tomorrow' },
  { id: 'later', title: 'Later' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** The time window of one section, the same edges as Home (lib/feed splitFeed): the next 2 hours, the rest of today, tomorrow, everything after. */
function windowOf(id: SectionId, now: Date): [Date, Date] | null {
  const soonCut = new Date(+now + 2 * 3600e3);
  const tomorrow = new Date(+now + 24 * 3600e3);
  const far = feedRange()[1];
  if (id === 'soon') return [now, soonCut];
  if (id === 'tonight') return +endOfDay(now) > +soonCut ? [new Date(+soonCut + 1), endOfDay(now)] : null; // after 10 pm "the next 2 hours" already reaches past midnight
  if (id === 'tomorrow') return [startOfDay(tomorrow) > soonCut ? startOfDay(tomorrow) : new Date(+soonCut + 1), endOfDay(tomorrow)];
  return [new Date(Math.max(+endOfDay(tomorrow) + 1, +soonCut + 1)), far];
}

/** One section of the list: its own request to the server (a page at a time as you scroll), its own heading. */
function Section({ id, index, enabled, base, round, toMap, onDone }: { id: SectionId; index: number; enabled: boolean; base: Record<string, string>; round: number; toMap: boolean; onDone: (id: SectionId) => void }) {
  const { t } = useT();
  const router = useRouter();
  const now = useRef(new Date()).current;
  const win = windowOf(id, now);
  const params = win ? { ...base, from: win[0].toISOString(), to: win[1].toISOString() } : {};
  const list = useCursorList<Activity>('/v1/activities', params, `all:${id}:${round}:${JSON.stringify(base)}`, { skip: !enabled || !win });
  const loaded = !!list.data || !win;
  const finished = loaded && !list.hasMore;
  useEffect(() => {
    if (enabled && finished) onDone(id);
  }, [enabled, finished, id, onDone]);
  if (!enabled) return null;
  return (
    <Reveal index={index} style={{ gap: 8 }}>
      <Txt variant="h3" accessibilityRole="header" style={{ fontSize: 15 }}>{t(SECTIONS.find((s) => s.id === id)!.title)}</Txt>
      <ErrorBanner message={list.error?.message} />
      {list.loading && !list.data && win ? <Spinner rows={2} /> : null}
      {loaded && list.items.length === 0 ? (
        <Empty title={t(EMPTY[id])} />
      ) : (
        <Grid min={340}>
          {list.items.map((a) => (
            <ActivityCard key={a.id} a={a} onPress={toMap ? () => router.navigate(`/discover?focus=${a.id}&t=${Date.now()}` as never) : undefined} />
          ))}
        </Grid>
      )}
      <PagedTail paged={list} />
    </Reveal>
  );
}

/** HERE · every activity from now on, as a list in four sections: the next 2 hours, tonight, tomorrow and later. Each asks the server for its own page of activities. */
export default function AllActivities() {
  // Opened from the map's "List" button: picking an activity goes back to the map and selects it there.
  const { from, section, category } = useLocalSearchParams<{ from?: string; section?: string; category?: string }>();
  const toMap = from === 'map';
  const [city] = useCity();
  const cityPos = useCityPos();
  const base: Record<string, string> = { ...cityQuery(city, cityPos), sort: 'relevance', ...(category ? { category } : {}) };
  // pull to refresh starts every section again
  const [round, setRound] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    setRound((r) => r + 1);
    setTimeout(() => setRefreshing(false), 700);
  };
  // opened from a Home section's "See all": only that section. Otherwise every section, one after the other: the next one starts
  // when the one above has shown everything it has.
  const shown = SECTIONS.filter((s) => !section || s.id === section);
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => setDone({}), [round, city, category, section]);
  const markDone = (id: SectionId) => setDone((d) => (d[id] ? d : { ...d, [id]: true }));
  const enabled = (i: number) => i === 0 || shown.slice(0, i).every((s) => done[s.id]);
  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      {shown.map((s, i) => (
        <Section key={s.id} id={s.id} index={i} enabled={enabled(i)} base={base} round={round} toMap={toMap} onDone={markDone} />
      ))}
    </Screen>
  );
}
