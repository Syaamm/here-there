import { useLocalSearchParams } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { CatPhoto } from '@/components/CatPhoto';
import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { Avatar, Banner, Between, Btn, Card, Chip, Empty, ErrorBanner, ProgressBar, Row, Screen, Txt, useGo } from '@/components/ui';
import { catColor, CATS } from '@/lib/constants';
import { get, post, type Reliability, type Activity } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { ago, when } from '@/lib/format';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useAction, useLoad } from '@/lib/hooks';

type Req = {
  id: string;
  state: string;
  intro: string | null;
  createdAt: string;
  applicant: { id: string; displayName?: string; photoUrl?: string | null; verifiedAdult: boolean; reliability?: Reliability | null; languages: string[]; interests: string[] };
};

/** HERE · Host reviews applicants. The server creates membership only on approval. */
export default function HostReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const go = useGo();
  const act = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  // a page at a time, the ones waiting for an answer first (the server orders them); `pending` counts them all
  const reqs = useCursorList<Req, { pending: number }>(`/v1/activities/${id}/requests`, {}, 'host:requests', { pollMs: 10_000 });
  const refresh = () => {
    void act.reload();
    void reqs.reload();
  };
  const mutate = useAction(refresh);
  const a = act.data;

  if (act.loading && !a) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (reqs.error && !reqs.data)
    return (
      <Screen hasHeader>
        <Empty title="Only the host can review requests">{reqs.error.message}</Empty>
      </Screen>
    );

  const items = reqs.items;
  const pending = reqs.data?.pending ?? 0;
  const full = !!a && a.going >= a.capacity;
  const decide = (r: Req, decision: 'approve' | 'decline') => mutate.run(() => post(`/v1/activities/${id}/requests/${r.id}/decision`, { decision }));

  return (
    <Screen hasHeader onRefresh={refresh} refreshing={false}>
      <Txt variant="h1" style={{ fontSize: 34, lineHeight: 40 }}>Your activity</Txt>
      {a && (
        <Card style={{ borderRadius: 20, gap: 12 }}>
          <Row style={{ gap: 14 }}>
            <CatPhoto category={a.category} style={{ width: 68, height: 68, borderRadius: 16 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h3" style={{ fontSize: 18 }}>{a.title}</Txt>
              <Txt variant="muted">{when(a.startsAt)} · {a.going} of {a.capacity} approved</Txt>
            </View>
          </Row>
          <ProgressBar value={a.going} max={a.capacity} />
          {a.status !== 'cancelled' && new Date(a.startsAt) <= new Date() ? <Btn title="Who came? ›" variant="secondary" small onPress={() => go(`/no-shows/activity/${id}`)} /> : null}
          {full && <Banner tone="warn">This activity is full. Reverse an approval to free a place.</Banner>}
        </Card>
      )}
      <ErrorBanner message={mutate.error} />
      <Txt variant="h2" style={{ fontSize: 22 }}>Pending requests · {pending}</Txt>
      {reqs.data && items.length === 0 && <Empty title="No requests yet">When people ask to join, you'll see them here.</Empty>}

      {items.map((r) => (
        <Card key={r.id}>
          <Between>
            <Row>
              <Avatar name={r.applicant.displayName} uri={r.applicant.photoUrl} />
              <View>
                <Txt variant="h3">{r.applicant.displayName ?? 'Member'} {r.applicant.verifiedAdult ? '✓' : ''}</Txt>
                <Txt variant="small">{r.applicant.verifiedAdult ? 'Verified adult' : 'Not verified'}{r.applicant.languages.length ? ` · ${r.applicant.languages.join(', ')}` : ''}</Txt>
                {r.applicant.reliability ? <View style={{ marginTop: 4, alignSelf: 'flex-start' }}><ReliabilityChip r={r.applicant.reliability} /></View> : null}
              </View>
            </Row>
            <Txt variant="small">{ago(r.createdAt)}</Txt>
          </Between>
          {r.applicant.interests.length > 0 && (
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              {r.applicant.interests.slice(0, 5).map((i) => (
                <Chip key={i} label={i} tone="neutral" />
              ))}
            </Row>
          )}
          <Txt>{r.intro || 'No introduction.'}</Txt>

          {r.state === 'requested' && (
            <Row>
              <Btn title="Decline" variant="secondary" disabled={mutate.busy} onPress={() => decide(r, 'decline')} style={{ flex: 1 }} />
              <Btn title="Approve" disabled={mutate.busy || full} onPress={() => decide(r, 'approve')} style={{ flex: 1 }} />
            </Row>
          )}
          {r.state === 'approved' && (
            <Between>
              <Chip label="Approved · in the group chat" tone="ok" />
              <Btn
                title="Reverse"
                variant="danger"
                small
                disabled={mutate.busy}
                onPress={async () => (await confirmAsync(`Reverse approval for ${r.applicant.displayName}?`, 'They lose chat access immediately.', 'Reverse', true)) && void decide(r, 'decline')}
              />
            </Between>
          )}
          {r.state === 'declined' && (
            <Between>
              <Chip label="Declined" tone="bad" />
              <Btn title="Approve instead" variant="secondary" small disabled={mutate.busy || full} onPress={() => decide(r, 'approve')} />
            </Between>
          )}
          {r.state === 'waitlisted' && (
            <Between>
              <Chip label="On the waiting list" tone="warn" />
              <Btn title="Approve now" variant="secondary" small disabled={mutate.busy || full} onPress={() => decide(r, 'approve')} />
            </Between>
          )}
          {r.state === 'withdrawn' && <Chip label="Withdrawn by the applicant" tone="neutral" />}
        </Card>
      ))}
      <PagedTail paged={reqs} />
      <Banner>Chat access is granted only after a real server-side approval, and removed the moment you reverse it.</Banner>
    </Screen>
  );
}
