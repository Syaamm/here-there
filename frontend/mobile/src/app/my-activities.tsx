import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { ActivityCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Between, Btn, Chip, Empty, ErrorBanner, Grid, Pill, PillRow, Row, RowLink, Screen, Spinner, useGo } from '@/components/ui';
import { type Activity } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useLiveEvents } from '@/lib/live';
import { myActivityItems } from '@/lib/myActivities';
import { REQUEST_ALERTS } from '@/lib/requestAlerts';

import { sc, sp } from '@/lib/scale';
const TABS = [
  { id: 'mine', label: 'My activities', empty: 'Activities you host or are going to show up here.' },
  { id: 'pending', label: 'Pending', empty: 'No requests waiting for a host right now.' },
  { id: 'rejected', label: 'Rejected', empty: 'No requests have been declined.' },
] as const;

/** Every activity you have hosted, joined or asked to join, sorted into My activities, Pending and Rejected. */
export default function MyActivities() {
  const { t } = useT();
  const go = useGo();
  // Profile's counts open the tab they are about (?tab=pending)
  const start = useLocalSearchParams<{ tab?: string }>().tab;
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>(TABS.some((x) => x.id === start) ? (start as (typeof TABS)[number]['id']) : 'mine');
  // the server sends one tab at a time, a few rows per request, and how many each tab holds
  const acts = useCursorList<Activity & { role?: string } & { requestId?: string; state?: string; activity?: Activity }, { counts: Record<(typeof TABS)[number]['id'], number> }>('/v1/me/activities/page', { tab }, `me:acts:${tab}`);
  const { refreshing, onRefresh } = useRefresh(acts.reload);
  // a request was approved, declined, moved up the waiting list or removed: the list and the three counts are asked again at once
  useLiveEvents((e) => {
    if (e.type === 'notification' && REQUEST_ALERTS.has(e.notification.type)) void acts.reload();
  });
  const counts = useRef<Record<string, number>>({});
  if (acts.data?.counts) counts.current = acts.data.counts; // kept while another tab is loading, so the labels do not blink
  const count = (k: string) => counts.current[k] ?? 0;
  const list = tab === 'mine'
    ? myActivityItems({ joined: acts.items as (Activity & { role: string })[], requests: [] }, false) // the server's order: on now, then the soonest
    : myActivityItems({ joined: [], requests: acts.items as { requestId: string; state: string; activity: Activity }[] });
  const paged = acts;
  const shown = list;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <PillRow>
        {TABS.map((x) => (
          <Pill key={x.id} label={`${t(x.label)} (${count(x.id)})`} active={tab === x.id} onPress={() => setTab(x.id)} />
        ))}
      </PillRow>
      <ErrorBanner message={acts.error?.message} />
      {acts.loading && !acts.data && <Spinner />}
      {acts.data && list.length === 0 && <Empty icon="calendar-outline" title={t('Nothing in {tab}', { tab: t(TABS.find((x) => x.id === tab)!.label) })} action={tab === 'mine' ? { label: t('Find an activity'), onPress: () => go('/') } : undefined}>{t(TABS.find((x) => x.id === tab)!.empty)}</Empty>}
      <Grid>
        {shown.map((x, i) => (
          <Reveal key={x.key} index={i} style={{ gap: sp(6) }}>
            <ActivityCard a={x.activity} plain={x.kind === 'rejected'} />
            <Between>
              <Chip label={t(x.label)} tone={x.tone} />
              {x.hostOf && <RowLink title={t('Manage requests ›')} onPress={() => go(`/host/${x.activity.id}`)} />}
            </Between>
          </Reveal>
        ))}
      </Grid>
      <PagedTail paged={paged} />
    </Screen>
  );
}
