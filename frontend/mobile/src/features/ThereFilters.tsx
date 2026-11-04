import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { ThereBudgetSlider, ThereChip, ThereDateBox, ThereFilterSheet, ThereInput, ThereLabel } from '@/components/ThereParts';
import { Btn } from '@/components/ui';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { parseDay } from '@/lib/format';
import { useT } from '@/lib/i18n';

export const BUDGET_MAX = 5000; // the far right of the budget slider: no ceiling

/**
 * The trip filters (design pages 53 to 56), held in one place so the Search tab and THERE Home use the very same sheet.
 * `ext` hands in the destination from outside (Home ties it to its own search field).
 */
export function useThereFilters(ext?: { destination: string; setDestination: (v: string) => void }) {
  const own = useState('');
  const [destination, setDestination] = ext ? [ext.destination, ext.setDestination] : own;
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [flex, setFlex] = useState('plus_minus_3');
  const [origin, setOrigin] = useState('');
  const [budget, setBudget] = useState(BUDGET_MAX); // the most per person; BUDGET_MAX means no ceiling
  const [transport, setTransport] = useState<'any' | 'true' | 'false'>('any');
  const [tags, setTags] = useState<string[]>([]);
  const [size, setSize] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const fromD = from ? parseDay(from) : null;
  const toD = to ? parseDay(to) : null;

  /** The server's query for what is set. */
  const build = (dest = destination): Record<string, string> => {
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
    return Object.fromEntries(p);
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
  };
  // a small dot on the filter button when anything beyond the destination is set
  const active = !!(origin.trim() || from || to || budget < BUDGET_MAX || transport !== 'any' || tags.length || size || !openOnly || flex !== 'plus_minus_3');
  return { destination, setDestination, from, to, fromD, toD, setFrom, setTo, flex, setFlex, origin, setOrigin, budget, setBudget, transport, setTransport, tags, setTags, size, setSize, openOnly, setOpenOnly, build, clearAll, active };
}

export type ThereFilters = ReturnType<typeof useThereFilters>;

/** The full filter sheet. `extra` is drawn first (Home puts its "how far ahead" choice there); `onSearch` runs when Search is tapped. */
export function ThereFiltersSheet({ f, visible, onClose, onSearch, searching, extra }: { f: ThereFilters; visible: boolean; onClose: () => void; onSearch: () => void; searching?: boolean; extra?: ReactNode }) {
  const { t } = useT();
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toggleTag = (g: string) => f.setTags((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));
  const chips = { flexDirection: 'row', flexWrap: 'wrap', gap: 10 } as const;
  return (
    <ThereFilterSheet
      visible={visible}
      onClose={onClose}
      footer={
        <>
          <Btn
            title={t('Search')}
            loading={!!searching}
            onPress={() => {
              onClose();
              onSearch();
            }}
          />
          <Btn title={t('Clear all')} variant="ghost" small onPress={f.clearAll} />
        </>
      }
      overlay={
        <DateRangeSheet
          visible={calendar !== null}
          focus={calendar ?? 'start'}
          start={f.from}
          end={f.to}
          min={today}
          max={lastPlanningDay(6)}
          maxNights={200}
          onClose={() => setCalendar(null)}
          onDone={(s, e) => {
            f.setFrom(s);
            f.setTo(e);
            setCalendar(null);
          }}
        />
      }
    >
      {extra}
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <ThereInput label={t('Departing from')} value={f.origin} onChangeText={f.setOrigin} placeholder={t('Any city')} />
        <ThereInput label={t('Destination')} value={f.destination} onChangeText={f.setDestination} placeholder={t('Japan')} />
      </View>

      <View style={{ gap: 12 }}>
        {/* the same calendar as when creating a trip: tap a box, pick the days */}
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <ThereDateBox label={t('Earliest departure')} date={f.fromD} onPress={() => setCalendar('start')} spoken={t('{label}: {date}. Opens a calendar', { label: t('Earliest departure'), date: f.fromD ? shortDay(f.fromD) : t('any date') })} />
          <ThereDateBox label={t('Latest return')} date={f.toD} onPress={() => setCalendar('end')} spoken={t('{label}: {date}. Opens a calendar', { label: t('Latest return'), date: f.toD ? shortDay(f.toD) : t('any date') })} />
        </View>
        {f.from || f.to ? <Btn title={t('Clear dates')} variant="ghost" small onPress={() => (f.setFrom(''), f.setTo(''))} style={{ alignSelf: 'flex-start' }} /> : null}
      </View>

      <View style={{ gap: 12 }}>
        <ThereLabel>{t('Date flexibility')}</ThereLabel>
        <View style={chips}>
          {FLEX.map(([v, l]) => (
            <ThereChip key={v} label={t(l)} active={f.flex === v} onPress={() => f.setFlex(v)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <ThereLabel>{t('Budget per person')}</ThereLabel>
        <ThereBudgetSlider value={f.budget} onChange={f.setBudget} max={BUDGET_MAX} />
      </View>

      <View style={{ gap: 12 }}>
        <ThereLabel>{t('Budget covers')}</ThereLabel>
        <View style={chips}>
          <ThereChip label={t('Any')} active={f.transport === 'any'} onPress={() => f.setTransport('any')} />
          <ThereChip label={t('Travel included')} active={f.transport === 'true'} onPress={() => f.setTransport('true')} />
          <ThereChip label={t('Destination only')} active={f.transport === 'false'} onPress={() => f.setTransport('false')} />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <ThereLabel>{t('Travel style')}</ThereLabel>
        <View style={chips}>
          {TRIP_TAGS.map((g) => (
            <ThereChip key={g} label={t(g[0].toUpperCase() + g.slice(1))} active={f.tags.includes(g)} onPress={() => toggleTag(g)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <ThereLabel>{t('How big should the group be?')}</ThereLabel>
        <View style={chips}>
          <ThereChip label={t('Any')} active={f.size === ''} onPress={() => f.setSize('')} />
          {GROUP_SIZES.map(([v, l]) => (
            <ThereChip key={v} label={t(l)} active={f.size === v} onPress={() => f.setSize(v)} />
          ))}
        </View>
      </View>

      <View style={chips}>
        <ThereChip label={t('Only groups with open places')} active={f.openOnly} onPress={() => f.setOpenOnly(!f.openOnly)} />
      </View>
    </ThereFilterSheet>
  );
}
