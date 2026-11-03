import { useState } from 'react';
import { View } from 'react-native';
import { TripBig, TripRow } from '@/components/Cards';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { ThereBrand, ThereBudgetSlider, ThereChip, ThereDateBox, ThereFilterSheet, ThereInput, ThereLabel, ThereSearchField } from '@/components/ThereParts';
import { Btn, Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { type Trip } from '@/lib/api';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { parseDay } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';

const BUDGET_MAX = 5000; // the far right of the budget slider: no ceiling

/** THERE · Search: date windows are compared for overlap; near-misses are labelled "approximate". */
export function SearchThere() {
  const { t, tn } = useT();
  const [destination, setDestination] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flex, setFlex] = useState('plus_minus_3');
  const [origin, setOrigin] = useState('');
  const [budget, setBudget] = useState(BUDGET_MAX); // the most per person; BUDGET_MAX means no ceiling
  const [transport, setTransport] = useState<'any' | 'true' | 'false'>('any');
  const [tags, setTags] = useState<string[]>([]);
  const [size, setSize] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  // what was searched for (nothing until Search is tapped); the server sends the matches a few at a time
  const [query, setQuery] = useState<Record<string, string> | null>(null);
  const results = useCursorList<Trip, { total: number }>('/v1/trips', query ?? {}, 'there:search', { skip: !query });
  const result = query && results.data ? results.data : null;

  const fromD = from ? parseDay(from) : null;
  const toD = to ? parseDay(to) : null;
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const search = (dest = destination) => {
    const p = new URLSearchParams({ flexibility: flex, ...(openOnly && { openOnly: 'true' }) });
    if (dest.trim()) p.set('destination', dest.trim());
    if (fromD) {
      p.set('from', fromD.toISOString());
      const end = new Date(toD ?? fromD);
      end.setHours(23, 59, 59, 0);
      p.set('to', end.toISOString());
    }
    if (origin.trim()) p.set('originCity', origin.trim());
    if (budget < BUDGET_MAX) p.set('budgetMax', String(Math.floor(budget)));
    if (transport !== 'any') p.set('includesTransport', transport);
    if (tags.length) p.set('tags', tags.join(','));
    if (size) p.set('groupSize', size);
    setQuery(Object.fromEntries(p));
  };
  const clearAll = () => {
    setDestination('');
    setFrom('');
    setTo('');
    setFlex('plus_minus_3');
    setOrigin('');
    setBudget(BUDGET_MAX);
    setTransport('any');
    setTags([]);
    setSize('');
    setOpenOnly(true);
    setQuery(null);
  };

  const toggleTag = (g: string) => setTags((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));
  // a small dot on the filter button when anything beyond the destination is set
  const filterOn = !!(origin.trim() || from || to || budget < BUDGET_MAX || transport !== 'any' || tags.length || size || !openOnly || flex !== 'plus_minus_3');

  const chips = { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } as const;
  return (
    // the calendar sits just above the dock, outside the scrolling page, so this fills the tab like the create form does
    <View style={{ flex: 1 }}>
      <Screen tabBar header={<ThereBrand />} style={{ paddingTop: 22 }}>
        <ThereSearchField
          inline
          value={destination}
          onChangeText={setDestination}
          placeholder={t('Where next? e.g. Japan....')}
          onSubmit={() => search()}
          onClear={() => {
            setDestination('');
            if (query) search('');
          }}
          onFilter={() => setFilterOpen(true)}
          filterActive={filterOn}
        />

        <ErrorBanner message={results.error?.message} />
        {!!query && results.loading && !result && <Spinner />}
        {!query && <Empty title={t('Find your group')} />}
        {result && (
          <>
            <Txt variant="h2" style={{ fontSize: 16, lineHeight: 21 }}>{tn(result.total, '{n} matching trip', '{n} matching trips')}</Txt>
            {result.items.length === 0 && <Empty title={t('No trips match')}>{t('Try fewer filters.')}</Empty>}
            <View style={{ gap: 12 }}>
              {results.items.map((x, i) => (i === 0 ? <TripBig key={x.id} t={x} /> : <TripRow key={x.id} t={x} />))}
            </View>
            <PagedTail paged={results} />
          </>
        )}
      </Screen>

      <ThereFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        footer={
          <>
            <Btn
              title={t('Search')}
              loading={!!query && results.loading && !results.data}
              onPress={() => {
                setFilterOpen(false);
                search();
              }}
            />
            <Btn title={t('Clear all')} variant="ghost" small onPress={clearAll} />
          </>
        }
        overlay={
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
        }
      >
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <ThereInput label={t('Departing from')} value={origin} onChangeText={setOrigin} placeholder={t('Any city')} />
          <ThereInput label={t('Destination')} value={destination} onChangeText={setDestination} placeholder={t('Japan')} />
        </View>

        <View style={{ gap: 12 }}>
          {/* the same calendar as when creating a trip: tap a box, pick the days */}
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <ThereDateBox label={t('Earliest departure')} date={fromD} onPress={() => setCalendar('start')} spoken={t('{label}: {date}. Opens a calendar', { label: t('Earliest departure'), date: fromD ? shortDay(fromD) : t('any date') })} />
            <ThereDateBox label={t('Latest return')} date={toD} onPress={() => setCalendar('end')} spoken={t('{label}: {date}. Opens a calendar', { label: t('Latest return'), date: toD ? shortDay(toD) : t('any date') })} />
          </View>
          {from || to ? <Btn title={t('Clear dates')} variant="ghost" small onPress={() => (setFrom(''), setTo(''))} style={{ alignSelf: 'flex-start' }} /> : null}
        </View>

        <View style={{ gap: 12 }}>
          <ThereLabel>{t('Date flexibility')}</ThereLabel>
          <View style={chips}>
            {FLEX.map(([v, l]) => (
              <ThereChip key={v} label={t(l)} active={flex === v} onPress={() => setFlex(v)} />
            ))}
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <ThereLabel>{t('Budget per person')}</ThereLabel>
          <ThereBudgetSlider value={budget} onChange={setBudget} max={BUDGET_MAX} />
        </View>

        <View style={{ gap: 12 }}>
          <ThereLabel>{t('Budget covers')}</ThereLabel>
          <View style={chips}>
            <ThereChip label={t('Any')} active={transport === 'any'} onPress={() => setTransport('any')} />
            <ThereChip label={t('Travel included')} active={transport === 'true'} onPress={() => setTransport('true')} />
            <ThereChip label={t('Destination only')} active={transport === 'false'} onPress={() => setTransport('false')} />
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <ThereLabel>{t('Travel style')}</ThereLabel>
          <View style={chips}>
            {TRIP_TAGS.map((g) => (
              <ThereChip key={g} label={t(g[0].toUpperCase() + g.slice(1))} active={tags.includes(g)} onPress={() => toggleTag(g)} />
            ))}
          </View>
        </View>

        <View style={{ gap: 12 }}>
          <ThereLabel>{t('How big should the group be?')}</ThereLabel>
          <View style={chips}>
            <ThereChip label={t('Any')} active={size === ''} onPress={() => setSize('')} />
            {GROUP_SIZES.map(([v, l]) => (
              <ThereChip key={v} label={t(l)} active={size === v} onPress={() => setSize(v)} />
            ))}
          </View>
        </View>

        <View style={chips}>
          <ThereChip label={t('Only groups with open places')} active={openOnly} onPress={() => setOpenOnly(!openOnly)} />
        </View>
      </ThereFilterSheet>
    </View>
  );
}
