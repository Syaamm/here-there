import { useState } from 'react';
import { View } from 'react-native';
import { TripBig, TripRow } from '@/components/Cards';
import { ThereBrand, ThereSearchField } from '@/components/ThereParts';
import { Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { type Trip } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { ThereFiltersSheet, useThereFilters } from './ThereFilters';

/** THERE · Search: date windows are compared for overlap; near-misses are labelled "approximate". */
export function SearchThere() {
  const { t, tn } = useT();
  const f = useThereFilters();
  const { destination, setDestination } = f;
  const [filterOpen, setFilterOpen] = useState(false);
  // what was searched for (nothing until Search is tapped); the server sends the matches a few at a time
  const [query, setQuery] = useState<Record<string, string> | null>(null);
  const results = useCursorList<Trip, { total: number }>('/v1/trips', query ?? {}, 'there:search', { skip: !query });
  const result = query && results.data ? results.data : null;

  const search = (dest = destination) => setQuery(f.build(dest));
  const clearAll = () => {
    f.clearAll();
    setQuery(null);
  };
  return (
    // the calendar sits just above the dock, outside the scrolling page, so this fills the tab like the create form does
    <View style={{ flex: 1 }}>
      {/* plain: the wordmark on the ivory page, no sand band (only THERE Home and Profile keep their band) */}
      <Screen tabBar plain header={<ThereBrand />} style={{ paddingTop: 22 }}>
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
          filterActive={f.active}
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

      <ThereFiltersSheet f={f} visible={filterOpen} onClose={() => setFilterOpen(false)} onSearch={() => search()} searching={!!query && results.loading && !results.data} />
    </View>
  );
}
