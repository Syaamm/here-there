import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Between, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { del, get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { FLEX } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';

/** THERE · Trip detail. A proposal with an estimated budget. Never a booking, never a guaranteed departure. */
export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest, logout } = useMe();
  const router = useRouter();
  const go = useGo();
  const { data: t, error, loading, reload } = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id]);
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'trip' | 'user'; id: string } | null>(null);

  if (loading && !t) return <Screen hero={<Hero plain color="#C8C2E2" emoji="✈️" />}><Spinner /></Screen>;
  if (error || !t)
    return (
      <Screen hero={<Hero plain color="#C8C2E2" emoji="✈️" />}>
        <Empty title="Trip not found">It may have been cancelled or is no longer available.</Empty>
      </Screen>
    );

  const verified = me?.eligibility === 'verified';
  const app = t.myApplication;
  const closed = ['cancelled', 'completed'].includes(t.status);
  const full = t.status === 'full' || t.spotsLeft === 0;

  const menu = t.isHost || isGuest
    ? []
    : [
        { label: 'Report this trip', onSelect: () => setReport({ type: 'trip', id: t.id }) },
        { label: `Report ${t.host.displayName}`, onSelect: () => setReport({ type: 'user', id: t.host.id }) },
        {
          label: `Block ${t.host.displayName}`,
          danger: true,
          onSelect: async () => {
            if (await confirmAsync(`Block ${t.host.displayName}?`, "You won't see each other's trips or activities, in HERE or THERE.", 'Block', true)) {
              await act.run(() => post('/v1/blocks', { userId: t.host.id }));
              router.back();
            }
          },
        },
      ];

  return (
    <Screen hero={<Hero plain color="#C8C2E2" emoji="✈️" />}>
      <Stack.Screen options={{ title: 'Trip', headerRight: menu.length ? () => <Menu items={menu} /> : undefined }} />
      <Between>
        <Chip label="✈ Trip proposal" tone="neutral" />
        {t.status === 'cancelled' ? <Chip label="Cancelled" tone="bad" /> : full ? <Chip label="Group full" tone="warn" /> : <Chip label={`${t.spotsLeft} places open`} tone="ok" />}
      </Between>
      <Txt variant="h1">{t.title}</Txt>
      <Txt variant="muted">
        📅 {dateSpan(t.dateStart, t.dateEnd)} · {FLEX.find(([v]) => v === t.dateFlexibility)?.[1] ?? t.dateFlexibility}
      </Txt>
      <Txt variant="muted">✈ From {t.originCity} or other cities</Txt>

      <Card>
        <Txt variant="label">{t.budget.label}</Txt>
        <Txt variant="h2">{money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} per person</Txt>
        <Txt variant="small">{t.budget.scope}</Txt>
      </Card>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {t.tags.map((x) => (
          <Chip key={x} label={x} tone="neutral" />
        ))}
      </Row>

      {t.description ? (
        <>
          <Txt variant="h3">The plan</Txt>
          <Txt>{t.description}</Txt>
        </>
      ) : null}

      <Card>
        <Between>
          <View>
            <Txt variant="h3">{t.members} of {t.maxCapacity} travelers</Txt>
            <Txt variant="small">The group goes ahead with {t.minCapacity}+ people</Txt>
          </View>
          <Row style={{ gap: 4 }}>
            {t.participants?.slice(0, 4).map((p) => (
              <Avatar key={p.id} name={p.displayName} uri={p.photoUrl} size={30} />
            ))}
          </Row>
        </Between>
        <Row>
          <Avatar name={t.host.displayName} uri={t.host.photoUrl} size={36} />
          <View>
            <Txt variant="h3">{t.host.displayName} {t.host.verifiedAdult ? '✓' : ''}</Txt>
            <Txt variant="small">Organizer{t.host.verifiedAdult ? ' · verified adult' : ''}</Txt>
          </View>
        </Row>
      </Card>

      {t.status === 'cancelled' && <Banner tone="bad">This trip was cancelled.</Banner>}
      <Banner>{t.disclaimer}</Banner>
      <ErrorBanner message={act.error} />

      {t.isHost ? (
        <View style={{ gap: 10 }}>
          <Btn title="Review applications" onPress={() => go(`/review/${id}`)} />
          {t.conversationId && <Btn title="Open group chat" variant="secondary" onPress={() => go(`/chat/${t.conversationId}`)} />}
          {t.status !== 'cancelled' && (
            <Btn title="Cancel trip" variant="danger" loading={act.busy} onPress={async () => (await confirmAsync('Cancel this trip?', 'Everyone in the group will be notified.', 'Cancel trip', true)) && void act.run(() => post(`/v1/trips/${id}/cancel`))} />
          )}
        </View>
      ) : t.isMember ? (
        <View style={{ gap: 10 }}>
          <Banner tone="ok">You're in the group.</Banner>
          {t.conversationId && <Btn title="Open group chat" onPress={() => go(`/chat/${t.conversationId}`)} />}
          <Banner>Date polls and a shared itinerary are coming soon. For now, agree dates and plans in the group chat.</Banner>
          <Btn title="Leave trip" variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync('Leave this trip?', undefined, 'Leave')) && void act.run(() => post(`/v1/trips/${id}/leave`))} />
        </View>
      ) : app && app.state === 'pending' ? (
        <View style={{ gap: 10 }}>
          <Banner tone="warn">{app.message}. You can't see the group chat or private plans until you're approved.</Banner>
          <Btn title="Withdraw application" variant="secondary" loading={act.busy} onPress={() => act.run(() => del(`/v1/trips/${id}/applications/mine`))} />
        </View>
      ) : app && ['declined', 'waitlisted'].includes(app.state) ? (
        <Banner tone={app.state === 'declined' ? 'bad' : 'warn'}>{app.message}</Banner>
      ) : closed ? null : full ? (
        <Btn title="This group is full" disabled />
      ) : isGuest ? (
        <Btn title="Create an account to apply" onPress={() => logout()} />
      ) : !verified ? (
        <Btn title="Verify your identity to apply" onPress={() => go('/verify')} />
      ) : (
        <Btn title={app ? 'Apply again' : 'Request to join'} onPress={() => go(`/apply/${id}`)} />
      )}

      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}
