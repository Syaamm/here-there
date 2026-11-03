import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { TripRow } from '@/components/Cards';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { Text } from '@/components/ScaledText';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Between, Btn, CheckRow, Empty, ErrorBanner, Field, Row, Screen, Spinner, Split, Txt } from '@/components/ui';
import { get, type Trip } from '@/lib/api';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { parseDay } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useTheme } from '@/lib/theme';
import { Choice, Section } from './CreateActivity';
import { Tile } from './CreateTrip';
import { View } from 'react-native';


/** THERE · Search: date windows are compared for overlap; near-misses are labelled "approximate". */
export function SearchThere() {
  const { t, tn } = useT();
  const [destination, setDestination] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flex, setFlex] = useState('plus_minus_3');
  const [origin, setOrigin] = useState('');
  const [budget, setBudget] = useState('');
  const [transport, setTransport] = useState<'any' | 'true' | 'false'>('any');
  const [tags, setTags] = useState<string[]>([]);
  const [size, setSize] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  // what was searched for (nothing until Search is tapped); the server sends the matches a few at a time
  const [query, setQuery] = useState<Record<string, string> | null>(null);
  const act = useAction();
  const results = useCursorList<Trip, { total: number }>('/v1/trips', query ?? {}, 'there:search', { skip: !query });
  const result = query && results.data ? results.data : null;
  const { c } = useTheme();

  const fromD = from ? parseDay(from) : null;
  const toD = to ? parseDay(to) : null;
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const search = async () => {
    const p = new URLSearchParams({ flexibility: flex, ...(openOnly && { openOnly: 'true' }) });
    if (destination.trim()) p.set('destination', destination.trim());
    if (fromD) {
      p.set('from', fromD.toISOString());
      const end = new Date(toD ?? fromD);
      end.setHours(23, 59, 59, 0);
      p.set('to', end.toISOString());
    }
    if (origin.trim()) p.set('originCity', origin.trim());
    if (budget.trim() && Number(budget) >= 0) p.set('budgetMax', String(Math.floor(Number(budget))));
    if (transport !== 'any') p.set('includesTransport', transport);
    if (tags.length) p.set('tags', tags.join(','));
    if (size) p.set('groupSize', size);
    setQuery(Object.fromEntries(p));
  };

  const toggleTag = (g: string) => setTags((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));

  const chips = { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } as const;
  return (
    // the calendar sits just above the dock, outside the scrolling page, so this fills the tab like the create form does
    <View style={{ flex: 1 }}>
    <Screen tabBar wide header={<TabHeader />}>
      <View>
        <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{t('Search trips')}</Txt>
      </View>

      {/* wide screens: filters on the left, results on the right. Phones: one column. */}
      <Split
        left={
          <>
            <Section>
              <Field label={t('Destination')} icon="location-outline" placeholder={t('Japan')} value={destination} onChangeText={setDestination} />
              <Field label={t('Departure city')} placeholder={t('Any city')} value={origin} onChangeText={setOrigin} />
            </Section>

            <Section>
              {/* the same calendar as when creating a trip: tap a box, pick the days */}
              <Row style={{ gap: 10, alignItems: 'stretch' }}>
                {(['start', 'end'] as const).map((k) => {
                  const d = k === 'start' ? fromD : toD;
                  const label = k === 'start' ? t('Earliest departure') : t('Latest return');
                  return (
                    <Pressable key={k} accessibilityRole="button" accessibilityLabel={t('{label}: {date}. Opens a calendar', { label, date: d ? shortDay(d) : t('any date') })} onPress={() => setCalendar(k)} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.85 }]}>
                      <Tile label={label} style={{ minHeight: 52, justifyContent: 'center' }}>
                        {d ? (
                          <>
                            <Text style={{ color: c.text, fontSize: 14, fontWeight: '800' }}>{shortDay(d)}</Text>
                            <Text style={{ color: c.muted, fontSize: 11 }}>{d.getFullYear()}</Text>
                          </>
                        ) : (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Ionicons name="calendar-outline" size={16} color={c.muted} />
                            <Text style={{ color: c.muted, fontSize: 13, fontWeight: '700' }}>{t('Any date')}</Text>
                          </View>
                        )}
                      </Tile>
                    </Pressable>
                  );
                })}
              </Row>
              {from || to ? <Btn title={t('Clear dates')} variant="ghost" small onPress={() => (setFrom(''), setTo(''))} style={{ alignSelf: 'flex-start' }} /> : null}
              <Txt variant="label">{t('Date flexibility')}</Txt>
              <View style={chips}>
                {FLEX.map(([v, l]) => (
                  <Choice key={v} label={t(l)} active={flex === v} onPress={() => setFlex(v)} />
                ))}
              </View>
            </Section>

            <Section>
              <Field label={t('Per-person budget ceiling (€)')} placeholder="2000" value={budget} onChangeText={setBudget} keyboardType="number-pad" />
              <Txt variant="label">{t('Budget covers')}</Txt>
              <View style={chips}>
                <Choice label={t('Any')} active={transport === 'any'} onPress={() => setTransport('any')} />
                <Choice label={t('Travel included')} active={transport === 'true'} onPress={() => setTransport('true')} />
                <Choice label={t('Destination only')} active={transport === 'false'} onPress={() => setTransport('false')} />
              </View>
            </Section>

            <Section>
              <Txt variant="label">{t('Travel style')}</Txt>
              <View style={chips}>
                {TRIP_TAGS.map((g) => (
                  <Choice key={g} label={t(g[0].toUpperCase() + g.slice(1))} active={tags.includes(g)} onPress={() => toggleTag(g)} />
                ))}
              </View>
              <Txt variant="label">{t('Group size')}</Txt>
              <View style={chips}>
                <Choice label={t('Any')} active={size === ''} onPress={() => setSize('')} />
                {GROUP_SIZES.map(([v, l]) => (
                  <Choice key={v} label={t(l)} active={size === v} onPress={() => setSize(v)} />
                ))}
              </View>
              <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 10 }}>
                <CheckRow checked={openOnly} onChange={setOpenOnly}>
                  <Txt>{t('Only groups with open places')}</Txt>
                </CheckRow>
              </View>
            </Section>

            <ErrorBanner message={results.error?.message} />
            <Btn title={t('Search')} onPress={search} loading={!!query && results.loading && !results.data} />
          </>
        }
        right={
          <>
            {!!query && results.loading && !result && <Spinner />}
            {!query && <Empty title={t('Find your group')} />}
            {result && (
              <>
                <Between>
                  <Txt variant="h2" style={{ fontSize: 16, lineHeight: 21 }}>{tn(result.total, '{n} matching trip', '{n} matching trips')}</Txt>
                </Between>
                {result.items.length === 0 && <Empty title={t('No trips match')}>{t('Try fewer filters.')}</Empty>}
                <View style={{ gap: 12 }}>
                  {results.items.map((x) => (
                    <TripRow key={x.id} t={x} />
                  ))}
                </View>
                <PagedTail paged={results} />
              </>
            )}
          </>
        }
      />
    </Screen>
      <DateRangeSheet
        visible={calendar !== null}
        focus={calendar ?? 'start'}
        start={from}
        end={to}
        min={today}
        max={lastPlanningDay(6)}
        maxNights={200}
        onClose={() => setCalendar(null)}
        onDone={(s, e) => {
          setFrom(s);
          setTo(e);
          setCalendar(null);
        }}
      />
    </View>
  );
}
