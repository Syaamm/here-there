import { useState } from 'react';
import { TripRow } from '@/components/Cards';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Between, Btn, CheckRow, DateField, Empty, ErrorBanner, Field, Row, Screen, Spinner, Split, Txt } from '@/components/ui';
import { get, type Trip } from '@/lib/api';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { parseDay } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { PagedTail, usePaged } from '@/lib/paged';
import { useTheme } from '@/lib/theme';
import { Choice, Section } from './CreateActivity';
import { View } from 'react-native';

type Result = { total: number; items: Trip[] };

/** THERE · Search: date windows are compared for overlap; near-misses are labelled "approximate". */
export function SearchThere() {
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
  const [result, setResult] = useState<Result | null>(null);
  const act = useAction();
  const results = usePaged(result?.items ?? [], String(result?.total ?? ''));
  const { c } = useTheme();

  const fromD = from ? parseDay(from) : null;
  const toD = to ? parseDay(to) : null;
  const dateErr = (from && !fromD ? 'Use the format YYYY-MM-DD' : null) ?? (to && !toD ? 'Use the format YYYY-MM-DD' : null) ?? (fromD && toD && toD < fromD ? 'The end date is before the start date' : null);

  const search = async () => {
    const p = new URLSearchParams({ limit: '50', flexibility: flex, ...(openOnly && { openOnly: 'true' }) });
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
    const r = await act.run(() => get<Result>(`/v1/trips?${p}`));
    if (r) setResult(r);
  };

  const toggleTag = (t: string) => setTags((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));

  const chips = { flexDirection: 'row', flexWrap: 'wrap', gap: 6 } as const;
  return (
    <Screen tabBar wide header={<TabHeader />}>
      <View>
        <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>Search trips</Txt>
        <Txt variant="muted">Set your dates, budget and style to find your group.</Txt>
      </View>

      {/* wide screens: filters on the left, results on the right. Phones: one column. */}
      <Split
        left={
          <>
            <Section>
              <Field label="Destination" icon="location-outline" placeholder="Japan" value={destination} onChangeText={setDestination} />
              <Field label="Departure city" placeholder="Any city" value={origin} onChangeText={setOrigin} hint="Used as a preference, never to exclude trips." />
            </Section>

            <Section>
              <Row style={{ gap: 10, alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <DateField label="Earliest departure" placeholder="YYYY-MM-DD" value={from} onChangeText={setFrom} error={dateErr} />
                </View>
                <View style={{ flex: 1 }}>
                  <DateField label="Latest return" placeholder="Optional" value={to} onChangeText={setTo} />
                </View>
              </Row>
              <Txt variant="label">Date flexibility</Txt>
              <View style={chips}>
                {FLEX.map(([v, l]) => (
                  <Choice key={v} label={l} active={flex === v} onPress={() => setFlex(v)} />
                ))}
              </View>
              <Txt variant="small">Dates are compared as overlapping windows. Approximate matches are labelled separately.</Txt>
            </Section>

            <Section>
              <Field label="Per-person budget ceiling (€)" placeholder="2000" value={budget} onChangeText={setBudget} keyboardType="number-pad" />
              <Txt variant="label">Budget covers</Txt>
              <View style={chips}>
                <Choice label="Any" active={transport === 'any'} onPress={() => setTransport('any')} />
                <Choice label="Travel included" active={transport === 'true'} onPress={() => setTransport('true')} />
                <Choice label="Destination only" active={transport === 'false'} onPress={() => setTransport('false')} />
              </View>
            </Section>

            <Section>
              <Txt variant="label">Travel style</Txt>
              <View style={chips}>
                {TRIP_TAGS.map((t) => (
                  <Choice key={t} label={t[0].toUpperCase() + t.slice(1)} active={tags.includes(t)} onPress={() => toggleTag(t)} />
                ))}
              </View>
              <Txt variant="label">Group size</Txt>
              <View style={chips}>
                <Choice label="Any" active={size === ''} onPress={() => setSize('')} />
                {GROUP_SIZES.map(([v, l]) => (
                  <Choice key={v} label={l} active={size === v} onPress={() => setSize(v)} />
                ))}
              </View>
              <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 10 }}>
                <CheckRow checked={openOnly} onChange={setOpenOnly}>
                  <Txt>Only groups with open places</Txt>
                </CheckRow>
              </View>
            </Section>

            <ErrorBanner message={act.error} />
            <Btn title="Search" onPress={search} loading={act.busy} disabled={!!dateErr} />
          </>
        }
        right={
          <>
            {act.busy && !result && <Spinner />}
            {!result && !act.busy && <Empty title="Find your group">Set your dates, budget and style, then tap Search to see matching trips.</Empty>}
            {result && (
              <>
                <Between>
                  <Txt variant="h2" style={{ fontSize: 16, lineHeight: 21 }}>{result.total} matching {result.total === 1 ? 'trip' : 'trips'}</Txt>
                </Between>
                {result.items.length === 0 && <Empty title="No trips match">Try wider dates, a higher budget or fewer filters.</Empty>}
                <View style={{ gap: 12 }}>
                  {results.shown.map((t) => (
                    <TripRow key={t.id} t={t} />
                  ))}
                </View>
                <PagedTail paged={results} />
              </>
            )}
          </>
        }
      />
    </Screen>
  );
}
