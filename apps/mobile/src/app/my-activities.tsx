import { useState } from 'react';
import { View } from 'react-native';
import { ActivityCard } from '@/components/Cards';
import { Reveal } from '@/components/Reveal';
import { Btn, Chip, Empty, ErrorBanner, Grid, Pill, PillRow, Row, Screen, Spinner, useGo } from '@/components/ui';
import { get } from '@/lib/api';
import { useLoad, useRefresh } from '@/lib/hooks';
import { myActivityItems, type MyActivitiesData } from '@/lib/myActivities';

const TABS = [
  { id: 'mine', label: 'My activities', empty: 'Activities you host or are going to show up here.' },
  { id: 'pending', label: 'Pending', empty: 'No requests waiting for a host right now.' },
  { id: 'rejected', label: 'Rejected', empty: 'No requests have been declined.' },
] as const;

/** Every activity you have hosted, joined or asked to join, sorted into My activities, Pending and Rejected. */
export default function MyActivities() {
  const go = useGo();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('mine');
  const acts = useLoad(() => get<MyActivitiesData>('/v1/me/activities'), [], undefined, 'me:activities');
  const { refreshing, onRefresh } = useRefresh(acts.reload);
  const all = myActivityItems(acts.data);
  const count = (k: string) => all.filter((x) => x.kind === k).length;
  const shown = all.filter((x) => x.kind === tab);

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <PillRow>
        {TABS.map((t) => (
          <Pill key={t.id} label={`${t.label} (${count(t.id)})`} active={tab === t.id} onPress={() => setTab(t.id)} />
        ))}
      </PillRow>
      <ErrorBanner message={acts.error?.message} />
      {acts.loading && !acts.data && <Spinner />}
      {acts.data && shown.length === 0 && <Empty title={`Nothing in ${TABS.find((t) => t.id === tab)!.label}`}>{TABS.find((t) => t.id === tab)!.empty}</Empty>}
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
    </Screen>
  );
}
