import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Hero } from '@/components/Hero';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Between, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { del, get, post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { catColor, CATS } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { timeRange } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

/** HERE · Activity detail. The join button always reflects server-side state, never a client guess. */
export default function ActivityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, isGuest, logout } = useMe();
  const { c } = useTheme();
  const router = useRouter();
  const go = useGo();
  const { data: a, error, loading, reload } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id]);
  const act = useAction(reload);
  const [report, setReport] = useState<{ type: 'activity' | 'user'; id: string } | null>(null);

  if (loading && !a)
    return (
      <Screen hero={<Hero color="#D3EADD" />}>
        <Spinner />
      </Screen>
    );
  if (error || !a)
    return (
      <Screen hero={<Hero color="#D3EADD" />}>
        <Empty title="Activity not found">It may have been cancelled or is no longer available.</Empty>
      </Screen>
    );

  const cat = CATS[a.category];
  const verified = me?.eligibility === 'verified';
  const req = a.myRequest?.state;
  const closed = ['in_progress', 'completed', 'cancelled', 'archived'].includes(a.status);

  const menu = [
    { label: a.favorited ? 'Remove from saved' : 'Save for later', onSelect: () => void act.run(() => (a.favorited ? del(`/v1/activities/${id}/favorite`) : post(`/v1/activities/${id}/favorite`))) },
    ...(a.isHost
      ? []
      : [
          { label: 'Report this activity', onSelect: () => setReport({ type: 'activity', id: a.id }) },
          { label: `Report ${a.host.displayName}`, onSelect: () => setReport({ type: 'user', id: a.host.id }) },
          {
            label: `Block ${a.host.displayName}`,
            danger: true,
            onSelect: async () => {
              if (await confirmAsync(`Block ${a.host.displayName}?`, "You won't see each other's activities, in HERE or THERE.", 'Block', true)) {
                await act.run(() => post('/v1/blocks', { userId: a.host.id }));
                router.back();
              }
            },
          },
        ]),
  ];

  return (
    <Screen hero={<Hero color={catColor(a.category)} emoji={cat?.emoji} right={isGuest ? undefined : <Menu floating items={menu} />} />}>
      <Stack.Screen options={{ headerShown: false }} />

      <Between>
        <Chip label={cat?.label ?? a.category} tone="info" />
        <Txt variant="muted">{timeRange(a.startsAt, a.endsAt)}</Txt>
      </Between>
      <Txt variant="h1" style={{ fontSize: 34, lineHeight: 40 }}>{a.title}</Txt>
      <Row style={{ gap: 8 }}>
        <Ionicons name="location-outline" size={20} color={c.muted} />
        <Txt variant="muted" style={{ flex: 1 }}>{a.venueName}, {a.city} · Public meeting venue</Txt>
      </Row>
      <View style={{ height: 1, backgroundColor: c.line }} />

      {a.status === 'cancelled' && <Banner tone="bad">This activity was cancelled.</Banner>}
      {['in_progress', 'completed'].includes(a.status) && <Banner>This activity has already started.</Banner>}
      <ErrorBanner message={act.error} />

      <Row style={{ gap: 14 }}>
        <Avatar name={a.host.displayName} size={60} />
        <View style={{ flex: 1 }}>
          <Txt variant="h3" style={{ fontSize: 20 }}>{a.host.displayName} {a.host.verifiedAdult ? <Ionicons name="checkmark" size={18} color={c.green} /> : null}</Txt>
          <Txt variant="muted">{a.host.verifiedAdult ? 'Verified adult · Host' : 'Host'}</Txt>
        </View>
      </Row>

      {a.description ? (
        <>
          <Txt variant="h2" style={{ fontSize: 24 }}>About the activity</Txt>
          <Txt style={{ fontSize: 17, lineHeight: 26 }}>{a.description}</Txt>
        </>
      ) : null}

      <Between>
        <View style={{ flex: 1 }}>
          <Txt variant="h3" style={{ fontSize: 20 }}>{a.going} / {a.capacity} people going</Txt>
          <Txt variant="muted">{a.spotsLeft === 0 ? 'No places left' : `${a.spotsLeft === 2 ? 'Two' : a.spotsLeft} ${a.spotsLeft === 1 ? 'place' : 'places'} available`}</Txt>
        </View>
        <View style={{ flexDirection: 'row' }}>
          {a.participants?.slice(0, 4).map((p, i) => (
            <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -12, borderRadius: 999, borderWidth: 3, borderColor: '#fff' }}>
              <Avatar name={p.displayName} size={40} />
            </View>
          ))}
        </View>
      </Between>

      <Row style={{ backgroundColor: c.sand, borderRadius: 18, padding: 16, gap: 12, alignItems: 'flex-start' }}>
        <Ionicons name="shield-outline" size={22} color={c.forest} />
        <Txt style={{ flex: 1 }}>Your exact location is never shared. Group chat opens after host approval.</Txt>
      </Row>

      {a.isHost ? (
        <View style={{ gap: 10 }}>
          <Btn title="Manage join requests" onPress={() => go(`/host/${id}`)} />
          {a.conversationId && <Btn title="Open group chat" variant="secondary" onPress={() => go(`/chat/${a.conversationId}`)} />}
          {a.status !== 'cancelled' && (
            <Btn
              title="Cancel activity"
              variant="danger"
              loading={act.busy}
              onPress={async () => (await confirmAsync('Cancel this activity?', 'Everyone who joined will be notified.', 'Cancel activity', true)) && void act.run(() => post(`/v1/activities/${id}/cancel`))}
            />
          )}
        </View>
      ) : a.isMember ? (
        <View style={{ gap: 10 }}>
          <Banner tone="ok">You're going. See you there!</Banner>
          {a.conversationId && <Btn title="Open group chat" onPress={() => go(`/chat/${a.conversationId}`)} />}
          <Btn title="Leave activity" variant="secondary" loading={act.busy} onPress={async () => (await confirmAsync('Leave this activity?', undefined, 'Leave')) && void act.run(() => post(`/v1/activities/${id}/leave`))} />
        </View>
      ) : req === 'requested' ? (
        <View style={{ gap: 10 }}>
          <Banner tone="warn">Request sent. Waiting for the host to review it. Chat opens once you're approved.</Banner>
          <Btn title="Withdraw request" variant="secondary" loading={act.busy} onPress={() => act.run(() => del(`/v1/activities/${id}/requests/mine`))} />
        </View>
      ) : req === 'declined' ? (
        <Banner tone="bad">The host didn't approve this request.</Banner>
      ) : closed ? null : a.spotsLeft === 0 ? (
        <Btn title="This activity is full" disabled />
      ) : isGuest ? (
        <Btn title="Create an account to join" onPress={() => logout()} />
      ) : !verified ? (
        <Btn title="Verify your identity to join" onPress={() => go('/verify')} />
      ) : (
        <Btn title="Request to join" onPress={() => go(`/join/${id}`)} />
      )}

      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  );
}
