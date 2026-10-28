import { useLocalSearchParams } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { View } from 'react-native';
import { Avatar, Banner, Between, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Txt } from '@/components/ui';
import { get, post, type Trip, type Reliability } from '@/lib/api';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { confirmAsync } from '@/lib/confirm';
import { ago, dateSpan } from '@/lib/format';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useAction, useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

type App = {
  id: string;
  state: string;
  intro: string;
  experience: string | null;
  createdAt: string;
  applicant: { id: string; displayName?: string; photoUrl?: string | null; verifiedAdult: boolean; reliability?: Reliability | null; languages: string[]; interests: string[] };
};

/** THERE · Organizer reviews applications. Private chat opens only after an approval the server records. */
export default function ReviewTrip() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trip = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip', { animate: true });
  // a page at a time, the ones waiting for an answer first (the server orders them); `pending` counts them all
  const apps = useCursorList<App, { pending: number }>(`/v1/trips/${id}/applications`, {}, 'review:applications', { pollMs: 10_000 });
  const refresh = () => {
    void trip.reload();
    void apps.reload();
  };
  const mutate = useAction(refresh);
  const tp = trip.data;

  if (trip.loading && !tp) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (apps.error && !apps.data)
    return (
      <Screen hasHeader>
        <Empty title={t('Only the organizer can review applications')}>{apps.error.message}</Empty>
      </Screen>
    );

  const items = apps.items;
  const pending = apps.data?.pending ?? 0;
  const full = !!tp && tp.members >= tp.maxCapacity;
  const decide = (a: App, decision: 'approve' | 'decline') => mutate.run(() => post(`/v1/trips/${id}/applications/${a.id}/decision`, { decision }));

  return (
    <Screen hasHeader onRefresh={refresh} refreshing={false}>
      {tp && (
        <Card>
          <Txt variant="h3">{tp.destination}</Txt>
          <Txt variant="small">{dateSpan(tp.dateStart, tp.dateEnd)} · {t('{n} approved', { n: tp.members })} · {tn(tp.spotsLeft, '{n} spot available', '{n} spots available')}</Txt>
          {full && <Banner tone="warn">{t('Full. Reverse an approval to free a place.')}</Banner>}
        </Card>
      )}
      <ErrorBanner message={mutate.error} />
      <Txt variant="h2">{t('Pending applications')} · {pending}</Txt>
      {apps.data && items.length === 0 && <Empty title={t('No applications yet')} />}

      {items.map((a) => (
        <Card key={a.id}>
          <Between>
            <Row>
              <Avatar name={a.applicant.displayName} uri={a.applicant.photoUrl} />
              <View>
                <Txt variant="h3">{a.applicant.displayName ?? t('Traveler')} {a.applicant.verifiedAdult ? '✓' : ''}</Txt>
                <Txt variant="small">
                  {a.applicant.verifiedAdult ? t('Verified adult') : t('Not verified')}
                  {a.experience ? ` · ${t(a.experience)}` : ''}
                  {a.applicant.languages.length ? ` · ${a.applicant.languages.join(', ')}` : ''}
                </Txt>
                {a.applicant.reliability ? <View style={{ marginTop: 4, alignSelf: 'flex-start' }}><ReliabilityChip r={a.applicant.reliability} /></View> : null}
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
              <Btn title={t('Decline')} variant="secondary" disabled={mutate.busy} onPress={() => decide(a, 'decline')} style={{ flex: 1 }} />
              <Btn title={t('Approve')} disabled={mutate.busy || full} onPress={() => decide(a, 'approve')} style={{ flex: 1 }} />
            </Row>
          )}
          {a.state === 'approved' && (
            <Between>
              <Chip label={t('Approved · in the group')} tone="ok" />
              <Btn
                title={t('Reverse')}
                variant="danger"
                small
                disabled={mutate.busy}
                onPress={async () => (await confirmAsync(t('Reverse approval for {name}?', { name: a.applicant.displayName ?? t('Traveler') }), t('They lose access to the group chat immediately.'), t('Reverse'), true)) && void decide(a, 'decline')}
              />
            </Between>
          )}
          {a.state === 'declined' && (
            <Between>
              <Chip label={t('Declined')} tone="bad" />
              <Btn title={t('Approve instead')} variant="secondary" small disabled={mutate.busy || full} onPress={() => decide(a, 'approve')} />
            </Between>
          )}
          {['withdrawn', 'expired'].includes(a.state) && <Chip label={a.state === 'withdrawn' ? t('Withdrawn by the applicant') : t('Expired')} tone="neutral" />}
        </Card>
      ))}
      <PagedTail paged={apps} />
      <Banner>{t('Only accepted members receive private planning and chat access. Never ask applicants for identity documents or money.')}</Banner>
    </Screen>
  );
}
