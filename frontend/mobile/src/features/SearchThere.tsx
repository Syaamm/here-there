import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { TripRow } from '@/components/Cards';
import { Text } from '@/components/ScaledText';
import { ThereBrand, ThereSearchField, TripStyleChips } from '@/components/ThereParts';
import { Empty, ErrorBanner, Screen, Spinner, Txt } from '@/components/ui';
import { type Trip } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { PagedTail, useCursorList } from '@/lib/paged';
import { ThereFiltersSheet, useThereFilters } from './ThereFilters';

import { sc, sp, sph } from '@/lib/scale';
/** THERE · Search: date windows are compared for overlap; near-misses are labelled "approximate". */
export function SearchThere() {
  const { t, tn } = useT();
  const f = useThereFilters();
  const { c } = useTheme();
  const narrow = useWindowDimensions().width < 380; // a small phone: the three choices still fit on one line
  const { destination, setDestination } = f;
  const [filterOpen, setFilterOpen] = useState(false);
  // what is searched for: every open trip (All trips) when the page opens, then whatever is chosen; the server sends a page at a time
  const [query, setQuery] = useState<Record<string, string> | null>(() => f.build(''));
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
      <Screen tabBar plain header={<ThereBrand />} style={{ paddingTop: sp(22) }}>
        <ThereSearchField
          inline
          value={destination}
          onChangeText={setDestination}
          placeholder={t('Where next? For example, Japan')}
          onSubmit={() => search()}
          onClear={() => {
            setDestination('');
            if (query) search('');
          }}
          onFilter={() => setFilterOpen(true)}
          filterActive={f.active}
        />

        {/* how the group gets there: one tap shows only that kind of trip (the filter sheet has the same choice) */}
        {/* three segments that always fit the screen width: each grows with its words, and the words shrink a little on a narrow phone */}
        <View accessibilityRole="radiogroup" accessibilityLabel={t('How the group gets there')} style={{ flexDirection: 'row', gap: sp(6) }}>
          {([['', t('All trips')], ['together', t('Travel together')], ['meet_at_destination', t('Meet at destination')]] as const).map(([v, label]) => {
            const on = f.style === v;
            return (
              <Pressable
                key={v || 'all'}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={label}
                onPress={() => {
                  f.setStyle(v);
                  setQuery(f.build(destination, v));
                }}
                style={({ pressed: p }) => [{ flexGrow: 1, flexShrink: 1, flexBasis: 'auto', minHeight: sc(42), paddingHorizontal: sph(7), borderRadius: sc(21), borderWidth: 1, borderColor: on ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: on ? c.forest : c.surface, alignItems: 'center', justifyContent: 'center' }, p && { opacity: 0.85 }]}
              >
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: on ? '#fff' : c.forest, fontSize: narrow ? 12 : 16, lineHeight: 17, fontWeight: on ? '600' : '500', textAlign: 'center' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* the travel interests, the same chips as THERE Home: one tap shows only those trips */}
        <TripStyleChips
          value={f.tags.length === 1 ? f.tags[0] : null}
          onChange={(k) => {
            const next = k ? [k] : [];
            f.setTags(next);
            setQuery(f.build(destination, f.style, next));
          }}
        />

        <ErrorBanner message={results.error?.message} />
        {!!query && results.loading && !result && <Spinner />}
        {result && (
          <>
            {/* a rounded number, not an exact count: "30+ trips found" (an exact one below 10) */}
            <Txt variant="h2" style={{ fontSize: 16, lineHeight: 21 }}>{result.total >= 10 ? t('{n}+ trips found', { n: Math.floor(result.total / 10) * 10 }) : tn(result.total, '{n} trip found', '{n} trips found')}</Txt>
            {result.items.length === 0 && <Empty title={t('No trips match')}>{t('Try fewer filters.')}</Empty>}
            <View style={{ gap: sp(12) }}>
              {results.items.map((x) => <TripRow key={x.id} t={x} />)}
            </View>
            <PagedTail paged={results} />
          </>
        )}
      </Screen>

      <ThereFiltersSheet f={f} visible={filterOpen} onClose={() => setFilterOpen(false)} onSearch={() => search()} searching={!!query && results.loading && !results.data} />
    </View>
  );
}
