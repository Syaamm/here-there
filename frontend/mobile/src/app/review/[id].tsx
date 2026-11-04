import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { View } from 'react-native';
import { PillButton, VerifiedTick } from '@/components/ActivityParts';
import { Text } from '@/components/ScaledText';
import { TripThumb } from '@/components/Cards';
import { softShadow, WHITE } from '@/components/TripParts';
import { Avatar, Banner, Between, Btn, Chip, Empty, ErrorBanner, Row, Screen, useGo } from '@/components/ui';
import { get, post, type Trip, type Reliability } from '@/lib/api';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { confirmAsync } from '@/lib/confirm';
import { ago, dateSpan } from '@/lib/format';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useAction, useLoad } from '@/lib/hooks';
import { useLiveEvents } from '@/lib/live';
import { useT } from '@/lib/i18n';
import { useEnterMode, useTheme } from '@/lib/theme';

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
  useEnterMode('there');
  const { c } = useTheme();
  const router = useRouter();
  const go = useGo();
  const trip = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip', { animate: true });
  // a page at a time, the ones waiting for an answer first (the server orders them); `pending` counts them all
  const apps = useCursorList<App, { pending: number }>(`/v1/trips/${id}/applications`, {}, 'review:applications', { pollMs: 10_000, live: true });
  const refresh = () => {
    void trip.reload();
    void apps.reload();
  };
  // an application or a change arrives as an alert: look again at once (the 10-second poll is only a rare safety net now)
  useLiveEvents((e) => {
    if (e.type === 'notification' || e.type === 'alerts-changed' || e.type === 'ready') refresh();
  });
  const mutate = useAction(refresh);
  const tp = trip.data;

  if (trip.loading && !tp)
    return (
      <Screen>
        <SkeletonDetail />
      </Screen>
    );
  if (apps.error && !apps.data)
    return (
      <Screen>
        <Empty title={t('Only the organizer can review applications')}>{apps.error.message}</Empty>
      </Screen>
    );

  const items = apps.items;
  const pending = apps.data?.pending ?? 0;
  const full = !!tp && tp.members >= tp.maxCapacity;
  const decide = (a: App, decision: 'approve' | 'decline') => mutate.run(() => post(`/v1/trips/${id}/applications/${a.id}/decision`, { decision }));
  const cardStyle = { backgroundColor: WHITE, borderRadius: 24, borderWidth: 1, borderColor: c.line, padding: 18, gap: 16, ...softShadow } as const;
  const days = tp ? Math.max(1, Math.round((+new Date(tp.dateEnd) - +new Date(tp.dateStart)) / 864e5) + 1) : 0;

  return (
    <Screen onRefresh={refresh} refreshing={false}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '600', paddingLeft: 4, paddingTop: 4 }}>{t('Your trip')}</Text>
      {tp && (
        <View style={cardStyle}>
          <Row style={{ gap: 18, alignItems: 'flex-start' }}>
            <TripThumb t={tp} size={34} style={{ width: 96, height: 96, borderRadius: 20 }} />
            <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
              <View accessible accessibilityLabel={`${tp.originCity} - ${tp.destination}`} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '500', flexShrink: 1 }}>{tp.originCity}</Text>
                <Ionicons name="airplane" size={14} color={c.forest} />
                <Text style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '500', flexShrink: 1 }}>{tp.destination}</Text>
              </View>
              <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{dateSpan(tp.dateStart, tp.dateEnd)} | {t('{d} days / {n} nights', { d: days, n: Math.max(0, days - 1) })}</Text>
              <View accessible accessibilityLabel={t('{going} of {capacity} approved', { going: tp.members, capacity: tp.maxCapacity })} style={{ height: 5, borderRadius: 3, backgroundColor: c.line, overflow: 'hidden' }}>
                <View style={{ width: `${Math.min(100, Math.round((tp.members / Math.max(tp.maxCapacity, 1)) * 100))}%`, height: 5, backgroundColor: c.forest }} />
              </View>
              <Text style={{ color: full ? c.danger : c.green, fontSize: 12, fontWeight: '500' }}>{full ? t('Full') : tn(tp.spotsLeft, '{n} spot available', '{n} spots available')}</Text>
            </View>
          </Row>
          {tp.status !== 'cancelled' && new Date(tp.dateStart) <= new Date() ? <PillButton outline title={t('Who came? Attendee roster')} onPress={() => go(`/no-shows/trip/${id}`)} /> : null}
          {full && <Banner tone="warn">{t('Full. Reverse an approval to free a place.')}</Banner>}
        </View>
      )}
      <ErrorBanner message={mutate.error} />
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '600', paddingLeft: 4, paddingTop: 4 }}>{t('Requests ({n})', { n: pending })}</Text>
      {apps.data && items.length === 0 && <Empty title={t('No applications yet')} />}

      {items.map((a) => (
        <View key={a.id} style={cardStyle}>
          <Between style={{ alignItems: 'flex-start' }}>
            <Row style={{ gap: 14, flex: 1 }}>
              <Avatar name={a.applicant.displayName} uri={a.applicant.photoUrl} size={44} />
              <View style={{ flex: 1, gap: 3 }}>
                <Row style={{ gap: 6 }}>
                  <Text style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600', flexShrink: 1 }}>{a.applicant.displayName ?? t('Traveler')}</Text>
                  {a.applicant.verifiedAdult ? <VerifiedTick size={16} /> : null}
                </Row>
                <Text style={{ color: c.muted, fontSize: 14, lineHeight: 18 }}>
                  {a.applicant.verifiedAdult ? t('Verified adult') : t('Not verified')}
                  {a.experience ? ` · ${t(a.experience)}` : ''}
                  {a.applicant.languages.length ? ` · ${a.applicant.languages.join(', ')}` : ''}
                </Text>
                {a.applicant.reliability ? (
                  <View style={{ marginTop: 2, alignSelf: 'flex-start' }}>
                    <ReliabilityChip r={a.applicant.reliability} />
                  </View>
                ) : null}
              </View>
            </Row>
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{ago(a.createdAt)}</Text>
          </Between>
          {a.applicant.interests.length > 0 && (
            <Row style={{ flexWrap: 'wrap', gap: 8 }}>
              {a.applicant.interests.slice(0, 5).map((i) => (
                <View key={i} style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: c.muted, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 }}>
                  <Text style={{ color: c.forest, fontSize: 12, lineHeight: 16 }}>{i}</Text>
                </View>
              ))}
            </Row>
          )}
          <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{a.intro}</Text>
          <View style={{ height: 1, backgroundColor: c.line }} />

          {['pending', 'waitlisted'].includes(a.state) && (
            <Row style={{ gap: 12 }}>
              <PillButton title={t('Accept')} small disabled={mutate.busy || full} onPress={() => decide(a, 'approve')} style={{ flex: 1.2 }} />
              <PillButton outline title={t('Decline')} small disabled={mutate.busy} onPress={() => decide(a, 'decline')} style={{ flex: 1 }} />
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
        </View>
      ))}
      <PagedTail paged={apps} />
      <Banner>{t('Only accepted members receive private planning and chat access. Never ask applicants for identity documents or money.')}</Banner>
    </Screen>
  );
}
