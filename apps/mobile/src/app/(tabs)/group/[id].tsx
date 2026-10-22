import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { CatPhoto } from '@/components/CatPhoto';
import { Avatar, Banner, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, post, type GroupInfo } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { confirmAsync } from '@/lib/confirm';
import { timeRange } from '@/lib/format';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';

/**
 * Group info, opened from the chat title: what the group is, who is in it (the host is the group admin), and the
 * ways out. Tapping a person opens their profile. The server decides who may see this, from live membership.
 */
export default function GroupInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const go = useGo();
  const router = useRouter();
  const info = useLoad(() => get<GroupInfo>(`/v1/conversations/${id}/info`), [id]);
  const { refreshing, onRefresh } = useRefresh(info.reload);
  const act = useAction();
  const g = info.data;

  if (info.loading && !g)
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  if (info.error || !g)
    return (
      <Screen>
        <Empty title="Group info is for members">Only approved members can see who is in a group.</Empty>
      </Screen>
    );

  const trip = g.scope === 'trip';
  const me = g.members.find((m) => m.isMe);
  const closed = ['cancelled', 'archived'].includes(g.status);
  const finished = g.status === 'completed'; // it took place: history now, so nothing to cancel
  const open = () => go(trip ? `/trip/${g.scopeId}` : `/activity/${g.scopeId}`);

  const leave = async () => {
    if (await confirmAsync(trip ? 'Leave this group and the trip?' : 'Leave this group and the activity?', `Leaving the group also takes you out of the ${trip ? 'trip' : 'activity'}.`, 'Leave', true)) {
      const r = await act.run(() => post(trip ? `/v1/trips/${g.scopeId}/leave` : `/v1/activities/${g.scopeId}/leave`));
      if (r) router.replace('/inbox');
    }
  };
  const cancel = async () => {
    if (await confirmAsync(`Cancel this ${trip ? 'trip' : 'activity'}?`, 'Everyone in the group is told and the chat ends with it.', `Cancel ${trip ? 'trip' : 'activity'}`, true)) {
      const r = await act.run(() => post(trip ? `/v1/trips/${g.scopeId}/cancel` : `/v1/activities/${g.scopeId}/cancel`));
      if (r) void info.reload();
    }
  };

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        {g.category ? <CatPhoto category={g.category} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Avatar name={g.title} size={96} />}
        <Txt variant="h1" style={{ textAlign: 'center' }}>{g.title}</Txt>
        <Txt variant="muted">{trip ? 'Trip group' : 'Activity group'} · {g.members.length} {g.members.length === 1 ? 'person' : 'people'}</Txt>
      </View>

      {finished && <Banner tone="ok">This activity has ended. Thanks for being part of it.</Banner>}
      {closed && <Banner tone="warn">{g.status === 'archived' ? 'This group is archived: read only.' : `This ${trip ? 'trip' : 'activity'} was cancelled, so its chat has ended.`}</Banner>}
      <ErrorBanner message={act.error} />

      <Card style={{ gap: 10 }}>
        <Row style={{ gap: 10, alignItems: 'flex-start' }}>
          <Ionicons name="time-outline" size={18} color={c.muted} />
          <Txt style={{ flex: 1 }}>{timeRange(g.startsAt, g.endsAt)}</Txt>
        </Row>
        <Row style={{ gap: 10, alignItems: 'flex-start' }}>
          <Ionicons name="location-outline" size={18} color={c.muted} />
          <Txt style={{ flex: 1 }}>{g.place}</Txt>
        </Row>
        <Row style={{ gap: 10, alignItems: 'flex-start' }}>
          <Ionicons name="people-outline" size={18} color={c.muted} />
          <Txt style={{ flex: 1 }}>{g.members.length} of {g.capacity} places taken</Txt>
        </Row>
        <Btn title={trip ? 'View trip' : 'View activity'} variant="secondary" small onPress={open} />
      </Card>

      <Txt variant="h2" accessibilityRole="header">{g.members.length} {g.members.length === 1 ? 'person' : 'people'}</Txt>
      <View style={{ gap: 2 }}>
        {g.members.map((m) => (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            accessibilityLabel={`${m.displayName}${m.isMe ? ', you' : ''}${m.role === 'host' ? ', host and group admin' : ''}. Open profile`}
            onPress={() => go(m.isMe ? '/profile' : `/user/${m.id}`)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, minHeight: 56 }, pressed && { opacity: 0.8 }]}
          >
            <Avatar name={m.displayName} uri={m.photoUrl} size={44} />
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3">{m.displayName}{m.isMe ? ' (you)' : ''} {m.verifiedAdult ? <Ionicons name="checkmark" size={14} color={c.green} /> : null}</Txt>
              <Txt variant="small">{m.verifiedAdult ? 'Verified adult' : 'Not verified'}</Txt>
            </View>
            {m.role === 'host' ? <Chip label={trip ? 'Organizer · admin' : 'Host · admin'} tone="ok" /> : null}
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        ))}
      </View>

      {me?.role === 'host' ? (
        <View style={{ gap: 10 }}>
          <Banner>You are the {trip ? 'organizer' : 'host'} and the group admin. A {trip ? 'organizer' : 'host'} cannot leave their own group: cancel the {trip ? 'trip' : 'activity'} to close it.</Banner>
          {!closed && !finished && <Btn title={`Cancel ${trip ? 'trip' : 'activity'}`} variant="danger" loading={act.busy} onPress={cancel} />}
        </View>
      ) : (
        !closed && <>
          <Btn title={trip ? 'Leave group and trip' : 'Leave group and activity'} variant="danger" loading={act.busy} onPress={leave} />
          <Txt variant="small" style={{ textAlign: 'center' }}>The group and the {trip ? 'trip' : 'activity'} go together: leaving one means leaving both.</Txt>
        </>
      )}
      <Btn title="Safety & privacy" variant="ghost" small onPress={() => go('/safety')} />
    </Screen>
  );
}
