import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
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

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

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
      <Screen hero={<Hero plain color="#D3EADD" />}>
        <Spinner />
      </Screen>
    );
  if (error || !a)
    return (
      <Screen hero={<Hero plain color="#D3EADD" />}>
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
    <Screen hero={<Hero plain color={catColor(a.category)} category={a.category} emoji={cat?.emoji} />}>
      <Stack.Screen options={{ title: cat?.label ?? 'Activity', headerRight: isGuest ? undefined : () => <Menu items={menu} /> }} />

      <Between>
        <Chip label={cat?.label ?? a.category} tone="info" />
        <Txt variant="muted">{timeRange(a.startsAt, a.endsAt)}</Txt>
      </Between>
      <Txt variant="h1">{a.title}</Txt>
      <Row style={{ gap: 8 }}>
        <Ionicons name="location-outline" size={17} color={c.muted} />
        <Txt variant="muted" style={{ flex: 1 }}>{a.venueName}, {a.city} · Public meeting venue</Txt>
      </Row>
      <View style={{ height: 1, backgroundColor: c.line }} />

      {a.status === 'cancelled' && <Banner tone="bad">This activity was cancelled.</Banner>}
      {['in_progress', 'completed'].includes(a.status) && <Banner>This activity has already started.</Banner>}
      <ErrorBanner message={act.error} />

      <Pressable accessibilityRole="button" accessibilityLabel={`${a.host.displayName}, host. Open profile`} onPress={() => go(`/user/${a.host.id}`)}>
      <Row style={{ gap: 14 }}>
        <Avatar name={a.host.displayName} uri={a.host.photoUrl} size={48} />
        <View style={{ flex: 1, gap: 1 }}>
          <Txt variant="h3" style={{ fontSize: 17, lineHeight: 22 }}>{a.host.displayName} {a.host.verifiedAdult ? <Ionicons name="checkmark" size={16} color={c.green} /> : null}</Txt>
          <Txt variant="muted">
            {[a.host.verifiedAdult ? 'Verified adult' : 'Host', a.activitiesHosted ? `${a.activitiesHosted} ${a.activitiesHosted === 1 ? 'activity' : 'activities'} hosted` : a.host.verifiedAdult ? 'Host' : ''].filter(Boolean).join(' · ')}
          </Txt>
        </View>
      </Row>
      </Pressable>

      {a.description ? (
        <>
          <Txt variant="h2" accessibilityRole="header">About the activity</Txt>
          <Txt style={{ lineHeight: 22 }}>{a.description}</Txt>
        </>
      ) : null}

      <Between>
        <View style={{ flex: 1 }}>
          <Txt variant="h3" style={{ fontSize: 17, lineHeight: 22 }}>{a.going} / {a.capacity} people going</Txt>
          <Txt variant="muted">{a.spotsLeft === 0 ? 'No places left' : `${WORDS[a.spotsLeft] ?? a.spotsLeft} ${a.spotsLeft === 1 ? 'place' : 'places'} available`}</Txt>
        </View>
        {/* who is going: overlapping initials, four at most, then "+N" */}
        <View accessible accessibilityLabel={`Going: ${(a.participants ?? []).map((p) => p.displayName).join(', ')}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
          {(a.participants ?? []).slice(0, 4).map((p, i) => (
            <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -10, borderRadius: 999, borderWidth: 2, borderColor: '#fff' }}>
              <Avatar name={p.displayName} uri={p.photoUrl} size={34} />
            </View>
          ))}
          {(a.participants?.length ?? 0) > 4 ? (
            <View style={{ marginLeft: -10, minWidth: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: '#fff', backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <Txt variant="small" color="#fff" bold>+{(a.participants?.length ?? 0) - 4}</Txt>
            </View>
          ) : null}
        </View>
      </Between>

      <Row style={{ backgroundColor: c.sand, borderRadius: 14, padding: 12, gap: 10, alignItems: 'flex-start' }}>
        <Ionicons name="shield-checkmark" size={18} color={c.forest} />
        <Txt variant="small" style={{ flex: 1, color: c.text }}>Your exact location is never shared. Group chat opens after host approval.</Txt>
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
