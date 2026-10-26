import { useRef, useState } from 'react';
import { View } from 'react-native';
import { ActivityCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Btn, Chip, Empty, ErrorBanner, Grid, Pill, PillRow, Row, Screen, Spinner, useGo } from '@/components/ui';
import { type Activity } from '@/lib/api';
import { useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';
import { myActivityItems } from '@/lib/myActivities';

const TABS = [
  { id: 'mine', label: 'My activities', empty: 'Activities you host or are going to show up here.' },
  { id: 'pending', label: 'Pending', empty: 'No requests waiting for a host right now.' },
  { id: 'rejected', label: 'Rejected', empty: 'No requests have been declined.' },
] as const;

/** Every activity you have hosted, joined or asked to join, sorted into My activities, Pending and Rejected. */
export default function MyActivities() {
  const go = useGo();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('mine');
  // the server sends one tab at a time, a few rows per request, and how many each tab holds
  const acts = useCursorList<Activity & { role?: string } & { requestId?: string; state?: string; activity?: Activity }, { counts: Record<(typeof TABS)[number]['id'], number> }>('/v1/me/activities/page', { tab }, `me:acts:${tab}`);
  const { refreshing, onRefresh } = useRefresh(acts.reload);
  const counts = useRef<Record<string, number>>({});
  if (acts.data?.counts) counts.current = acts.data.counts; // kept while another tab is loading, so the labels do not blink
  const count = (k: string) => counts.current[k] ?? 0;
  const list = tab === 'mine'
    ? myActivityItems({ joined: acts.items as (Activity & { role: string })[], requests: [] })
    : myActivityItems({ joined: [], requests: acts.items as { requestId: string; state: string; activity: Activity }[] });
  const paged = acts;
  const shown = list;

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <PillRow>
        {TABS.map((t) => (
          <Pill key={t.id} label={`${t.label} (${count(t.id)})`} active={tab === t.id} onPress={() => setTab(t.id)} />
        ))}
      </PillRow>
      <ErrorBanner message={acts.error?.message} />
      {acts.loading && !acts.data && <Spinner />}
      {acts.data && list.length === 0 && <Empty title={`Nothing in ${TABS.find((t) => t.id === tab)!.label}`}>{TABS.find((t) => t.id === tab)!.empty}</Empty>}
      <Grid>
        {shown.map((x, i) => (
          <Reveal key={x.key} index={i} style={{ gap: 6 }}>
            <ActivityCard a={x.activity} plain={x.kind === 'rejected'} />
            <Row>
              <Chip label={x.label} tone={x.tone} />
              {x.hostOf && <Btn title="Manage requests ›" variant="ghost" small onPress={() => go(`/host/${x.activity.id}`)} />}
            </Row>
          </Reveal>
        ))}
      </Grid>
      <PagedTail paged={paged} />
    </Screen>
  );
}
