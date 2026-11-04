import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { CatPhoto } from '@/components/CatPhoto';
import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { PillButton, VerifiedTick } from '@/components/ActivityParts';
import { Avatar, Banner, Between, Btn, Chip, Empty, ErrorBanner, Row, Screen, useGo } from '@/components/ui';
import { get, post, type Reliability, type Activity } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { ago, when } from '@/lib/format';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useAction, useLoad } from '@/lib/hooks';
import { useLiveEvents } from '@/lib/live';
import { useT } from '@/lib/i18n';
import { useEnterMode, useTheme } from '@/lib/theme';

type Req = {
  id: string;
  state: string;
  intro: string | null;
  createdAt: string;
  applicant: { id: string; displayName?: string; photoUrl?: string | null; verifiedAdult: boolean; reliability?: Reliability | null; languages: string[]; interests: string[] };
};

/** HERE · Host reviews applicants. The server creates membership only on approval. */
export default function HostReview() {
  const { t, tn } = useT();
  const { c } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const go = useGo();
  useEnterMode('here');
  const act = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  // a page at a time, the ones waiting for an answer first (the server orders them); `pending` counts them all
  const reqs = useCursorList<Req, { pending: number }>(`/v1/activities/${id}/requests`, {}, 'host:requests', { pollMs: 10_000, live: true });
  const refresh = () => {
    void act.reload();
    void reqs.reload();
  };
  // a request or a change arrives as an alert: look again at once (the 10-second poll is only a rare safety net now)
  useLiveEvents((e) => {
    if (e.type === 'notification' || e.type === 'alerts-changed' || e.type === 'ready') refresh();
  });
  const mutate = useAction(refresh);
  const a = act.data;

  if (act.loading && !a)
    return (
      <Screen>
        <SkeletonDetail />
      </Screen>
    );
  if (reqs.error && !reqs.data)
    return (
      <Screen>
        <Empty title={t('Only the host can review requests')}>{reqs.error.message}</Empty>
      </Screen>
    );

  const items = reqs.items;
  const pending = reqs.data?.pending ?? 0;
  const full = !!a && a.going >= a.capacity;
  const decide = (r: Req, decision: 'approve' | 'decline') => mutate.run(() => post(`/v1/activities/${id}/requests/${r.id}/decision`, { decision }));
  const cardStyle = { backgroundColor: c.surface, borderRadius: 24, borderWidth: 1, borderColor: c.line, padding: 18, gap: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 } as const;

  return (
    <Screen onRefresh={refresh} refreshing={false}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '600', paddingLeft: 4, paddingTop: 4 }}>{t('Your activity')}</Text>
      {a && (
        <View style={cardStyle}>
          <Row style={{ gap: 18, alignItems: 'flex-start' }}>
            <CatPhoto category={a.category} style={{ width: 96, height: 96, borderRadius: 20 }} />
            <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
              <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{a.title}</Text>
              <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{a.venueName} | {when(a.startsAt)}</Text>
              <View accessible accessibilityLabel={t('{going} of {capacity} approved', { going: a.going, capacity: a.capacity })} style={{ height: 5, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.round((a.going / Math.max(a.capacity, 1)) * 100))}%`, height: 5, backgroundColor: c.forest }} />
              </View>
              <Text style={{ color: full ? c.danger : c.green, fontSize: 12, fontWeight: '500' }}>{full ? t('Full') : tn(Math.max(0, a.capacity - a.going), '{n} spot left', '{n} spots left')}</Text>
            </View>
          </Row>
          {a.status !== 'cancelled' && new Date(a.startsAt) <= new Date() ? <PillButton outline title={t('Who came? Attendee roster')} onPress={() => go(`/no-shows/activity/${id}`)} /> : null}
          {full && <Banner tone="warn">{t('Full. Reverse an approval to free a place.')}</Banner>}
        </View>
      )}
      <ErrorBanner message={mutate.error} />
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '600', paddingLeft: 4, paddingTop: 4 }}>{t('Requests ({n})', { n: pending })}</Text>
      {reqs.data && items.length === 0 && <Empty title={t('No requests yet')} />}

      {items.map((r) => (
        <View key={r.id} style={cardStyle}>
          <Between style={{ alignItems: 'flex-start' }}>
            <Row style={{ gap: 14, flex: 1 }}>
              <Avatar name={r.applicant.displayName} uri={r.applicant.photoUrl} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ gap: 6 }}>
                  <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600', flexShrink: 1 }}>{r.applicant.displayName ?? t('Member')}</Text>
                  {r.applicant.verifiedAdult ? <VerifiedTick size={16} /> : null}
                </Row>
                <Text style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>
                  {r.applicant.verifiedAdult ? t('Verified adult') : t('Not verified')}
                  {r.applicant.languages.length ? ` · ${r.applicant.languages.join(', ')}` : ''}
                </Text>
                {r.applicant.reliability ? (
                  <View style={{ marginTop: 2, alignSelf: 'flex-start' }}>
                    <ReliabilityChip r={r.applicant.reliability} />
                  </View>
                ) : null}
              </View>
            </Row>
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{ago(r.createdAt)}</Text>
          </Between>
          {r.applicant.interests.length > 0 && (
            <Row style={{ flexWrap: 'wrap', gap: 8 }}>
              {r.applicant.interests.slice(0, 5).map((i) => (
                <View key={i} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: c.muted, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ color: c.forest, fontSize: 12, lineHeight: 16 }}>{i}</Text>
                </View>
              ))}
            </Row>
          )}
          <Text style={{ color: r.intro ? c.text : c.muted, fontSize: 14, lineHeight: 20 }}>{r.intro || t('No introduction.')}</Text>
          <View style={{ height: 1, backgroundColor: c.line }} />

          {r.state === 'requested' && (
            <Row style={{ gap: 12 }}>
              <PillButton title={t('Accept')} small disabled={mutate.busy || full} onPress={() => decide(r, 'approve')} style={{ flex: 1.2 }} />
              <PillButton outline title={t('Decline')} small disabled={mutate.busy} onPress={() => decide(r, 'decline')} style={{ flex: 1 }} />
            </Row>
          )}
          {r.state === 'approved' && (
            <Between>
              <Chip label={t('Approved · in the group chat')} tone="ok" />
              <Btn
                title={t('Reverse')}
                variant="danger"
                small
                disabled={mutate.busy}
                onPress={async () => (await confirmAsync(t('Reverse approval for {name}?', { name: r.applicant.displayName ?? t('Member') }), t('They lose chat access immediately.'), t('Reverse'), true)) && void decide(r, 'decline')}
              />
            </Between>
          )}
          {r.state === 'declined' && (
            <Between>
              <Chip label={t('Declined')} tone="bad" />
              <Btn title={t('Approve instead')} variant="secondary" small disabled={mutate.busy || full} onPress={() => decide(r, 'approve')} />
            </Between>
          )}
          {r.state === 'waitlisted' && (
            <Between>
              <Chip label={t('On the waiting list')} tone="warn" />
              <Btn title={t('Approve now')} variant="secondary" small disabled={mutate.busy || full} onPress={() => decide(r, 'approve')} />
            </Between>
          )}
          {r.state === 'withdrawn' && <Chip label={t('Withdrawn by the applicant')} tone="neutral" />}
        </View>
      ))}
      <PagedTail paged={reqs} />
    </Screen>
  );
}
