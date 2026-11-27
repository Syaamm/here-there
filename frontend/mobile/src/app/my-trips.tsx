import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useTheme } from '@/lib/theme';
import { TripCompactCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Between, Chip, Empty, ErrorBanner, Grid, RowLink, Screen, Spinner, useGo } from '@/components/ui';
import { type MyTripRow } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useLiveEvents } from '@/lib/live';
import { BTN } from '@/lib/buttons';
import { sc, sp, sph } from '@/lib/scale';

const TABS = [
  { id: 'mine', label: 'My trips', empty: 'Trips you organise or are in, and the ones you have finished, show up here.' },
  { id: 'pending', label: 'Pending', empty: 'No requests waiting for an organizer right now.' },
  { id: 'rejected', label: 'Rejected', empty: 'No requests have been declined.' },
] as const;

/** Every trip you have organised, joined (finished ones too) or asked to join, sorted into My trips, Pending and Rejected: the same as My activities in HERE. */
export default function MyTripsPage() {
  const { t } = useT();
  const go = useGo();
  const { c } = useTheme();
  // Profile's counts can open the tab they are about (?tab=pending)
  const start = useLocalSearchParams<{ tab?: string }>().tab;
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(TABS.some((x) => x.id === start) ? (start as (typeof TABS)[number]['id']) : 'mine');
  // the server sends one tab at a time, a few rows per request, and how many each tab holds
  const trips = useCursorList<MyTripRow, { counts: Record<(typeof TABS)[number]['id'], number> }>('/v1/me/trips/page', { tab }, `me:trips:${tab}`);
  // a trip changed somewhere (its dates, members, an answer to a request): the list and the counts are asked again at once
  useLiveEvents((e) => {
    if (e.type === 'feed-changed' || e.type === 'group-changed') void trips.reload();
  });
  const { refreshing, onRefresh } = useRefresh(trips.reload);
  const counts = useRef<Record<string, number>>({});
  if (trips.data?.counts) counts.current = trips.data.counts; // kept while another tab is loading, so the labels do not blink
  const count = (k: string) => counts.current[k] ?? 0;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: sp(8) }}>
        {TABS.map((x) => {
          const on = tab === x.id;
          const label = `${t(x.label)} (${count(x.id)})`;
          return (
            <Pressable key={x.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} onPress={() => setTab(x.id)} style={({ pressed }) => [{ flex: 1, minHeight: sc(BTN.pill), borderRadius: BTN.radiusPill, borderWidth: 1, paddingHorizontal: sph(6), alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : c.surface, borderColor: on ? c.forest : c.line }, pressed && { opacity: 0.88 }]}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: on ? '#fff' : c.text, fontSize: 14, fontWeight: '500' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <ErrorBanner message={trips.error?.message} />
      {trips.loading && !trips.data && <Spinner />}
      {trips.data && trips.items.length === 0 && <Empty icon="airplane-outline" title={t('Nothing in {tab}', { tab: t(TABS.find((x) => x.id === tab)!.label) })} action={tab === 'mine' ? { label: t('Find a trip'), onPress: () => go('/') } : undefined}>{t(TABS.find((x) => x.id === tab)!.empty)}</Empty>}
      <Grid>
        {trips.items.map((x, i) =>
          x.row === 'joined' ? (
            <Reveal key={x.id} index={i} style={{ gap: sp(6) }}>
              <TripCompactCard t={x} />
              <Between>
                <Chip
                  label={x.status === 'cancelled' ? t('Cancelled') : x.status === 'completed' ? t('Completed') : x.role === 'organizer' ? t('You organize this') : t('In the group')}
                  tone={x.status === 'cancelled' ? 'bad' : x.status === 'completed' ? 'neutral' : 'ok'}
                />
                {x.role === 'organizer' && x.status !== 'cancelled' && x.status !== 'completed' && <RowLink title={t('Review applications ›')} onPress={() => go(`/review/${x.id}`)} />}
              </Between>
            </Reveal>
          ) : (
            <Reveal key={x.applicationId} index={i} style={{ gap: sp(6) }}>
              <TripCompactCard t={x.trip} />
              <Chip label={x.state === 'pending' ? t('Pending organizer review') : x.state === 'waitlisted' ? t('Waitlisted') : t('Not approved')} tone={x.state === 'declined' ? 'bad' : 'warn'} />
            </Reveal>
          ),
        )}
      </Grid>
      <PagedTail paged={trips} />
    </Screen>
  );
}
