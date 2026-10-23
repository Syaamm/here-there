import { useLocalSearchParams } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { View } from 'react-native';
import { Avatar, Banner, Between, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Txt } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { ago, dateSpan } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';

type App = {
  id: string;
  state: string;
  intro: string;
  experience: string | null;
  createdAt: string;
  applicant: { id: string; displayName?: string; photoUrl?: string | null; verifiedAdult: boolean; languages: string[]; interests: string[] };
};
const ORDER: Record<string, number> = { pending: 0, waitlisted: 1, approved: 2, declined: 3, withdrawn: 4, expired: 5 };

/** THERE · Organizer reviews applications. Private chat opens only after an approval the server records. */
export default function ReviewTrip() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip', { animate: true });
  const apps = useLoad(() => get<{ items: App[] }>(`/v1/trips/${id}/applications`), [id], 10_000);
  const refresh = () => {
    void trip.reload();
    void apps.reload();
  };
  const mutate = useAction(refresh);
  const t = trip.data;

  if (trip.loading && !t) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (apps.error && !apps.data)
    return (
      <Screen hasHeader>
        <Empty title="Only the organizer can review applications">{apps.error.message}</Empty>
      </Screen>
    );

  const items = [...(apps.data?.items ?? [])].sort((x, y) => (ORDER[x.state] ?? 9) - (ORDER[y.state] ?? 9) || +new Date(x.createdAt) - +new Date(y.createdAt));
  const pending = items.filter((a) => a.state === 'pending').length;
  const full = !!t && t.members >= t.maxCapacity;
  const decide = (a: App, decision: 'approve' | 'decline') => mutate.run(() => post(`/v1/trips/${id}/applications/${a.id}/decision`, { decision }));

  return (
    <Screen hasHeader onRefresh={refresh} refreshing={false}>
      {t && (
        <Card>
          <Txt variant="h3">{t.destination}</Txt>
          <Txt variant="small">{dateSpan(t.dateStart, t.dateEnd)} · {t.members} approved · {t.spotsLeft} spots available</Txt>
          {full && <Banner tone="warn">The group is full. Reverse an approval to free a place.</Banner>}
        </Card>
      )}
      <ErrorBanner message={mutate.error} />
      <Txt variant="h2">Pending applications · {pending}</Txt>
      {apps.data && items.length === 0 && <Empty title="No applications yet">Travelers who want to join will appear here.</Empty>}

      {items.map((a) => (
        <Card key={a.id}>
          <Between>
            <Row>
              <Avatar name={a.applicant.displayName} uri={a.applicant.photoUrl} />
              <View>
                <Txt variant="h3">{a.applicant.displayName ?? 'Traveler'} {a.applicant.verifiedAdult ? '✓' : ''}</Txt>
                <Txt variant="small">
                  {a.applicant.verifiedAdult ? 'Verified adult' : 'Not verified'}
                  {a.experience ? ` · ${a.experience}` : ''}
                  {a.applicant.languages.length ? ` · ${a.applicant.languages.join(', ')}` : ''}
                </Txt>
              </View>
            </Row>
            <Txt variant="small">{ago(a.createdAt)}</Txt>
          </Between>
          {a.applicant.interests.length > 0 && (
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              {a.applicant.interests.slice(0, 5).map((i) => (
                <Chip key={i} label={i} tone="neutral" />
              ))}
            </Row>
          )}
          <Txt>{a.intro}</Txt>

          {['pending', 'waitlisted'].includes(a.state) && (
            <Row>
              <Btn title="Decline" variant="secondary" disabled={mutate.busy} onPress={() => decide(a, 'decline')} style={{ flex: 1 }} />
              <Btn title="Approve" disabled={mutate.busy || full} onPress={() => decide(a, 'approve')} style={{ flex: 1 }} />
            </Row>
          )}
          {a.state === 'approved' && (
            <Between>
              <Chip label="Approved · in the group" tone="ok" />
              <Btn
                title="Reverse"
                variant="danger"
                small
                disabled={mutate.busy}
                onPress={async () => (await confirmAsync(`Reverse approval for ${a.applicant.displayName}?`, 'They lose access to the group chat immediately.', 'Reverse', true)) && void decide(a, 'decline')}
              />
            </Between>
          )}
          {a.state === 'declined' && (
            <Between>
              <Chip label="Declined" tone="bad" />
              <Btn title="Approve instead" variant="secondary" small disabled={mutate.busy || full} onPress={() => decide(a, 'approve')} />
            </Between>
          )}
          {['withdrawn', 'expired'].includes(a.state) && <Chip label={a.state === 'withdrawn' ? 'Withdrawn by the applicant' : 'Expired'} tone="neutral" />}
        </Card>
      ))}
      <Banner>Only accepted members receive private planning and chat access. Never ask applicants for identity documents or money.</Banner>
    </Screen>
  );
}
