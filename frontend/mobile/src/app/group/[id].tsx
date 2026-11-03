import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { CatPhoto } from '@/components/CatPhoto';
import { Avatar, Banner, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type GroupInfo } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { confirmAsync } from '@/lib/confirm';
import { timeRange } from '@/lib/format';
import { Paged } from '@/lib/paged';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/**
 * Group info, opened from the chat title: what the group is, who is in it (the host is the group admin), and the
 * ways out. Tapping a person opens their profile. The server decides who may see this, from live membership.
 */
export default function GroupInfoScreen() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const go = useGo();
  const router = useRouter();
  const info = useLoad(() => get<GroupInfo>(`/v1/conversations/${id}/info`), [id], undefined, 'chat:info');
  const { refreshing, onRefresh } = useRefresh(info.reload);
  const act = useAction();
  const g = info.data;

  if (info.loading && !g)
    return (
      <Screen>
        <SkeletonDetail />
      </Screen>
    );
  if (info.error || !g)
    return (
      <Screen>
        <Empty title={t('Group info is for members')} />
      </Screen>
    );

  const trip = g.scope === 'trip';
  const me = g.members.find((m) => m.isMe);
  const closed = ['cancelled', 'archived'].includes(g.status);
  const finished = g.status === 'completed'; // it took place: history now, so nothing to cancel
  const open = () => go(trip ? `/trip/${g.scopeId}` : `/activity/${g.scopeId}`);

  const leave = async () => {
    if (await confirmAsync(trip ? t('Leave this group and the trip?') : t('Leave this group and the activity?'), trip ? t('Leaving the group also takes you out of the trip.') : t('Leaving the group also takes you out of the activity.'), t('Leave'), true)) {
      const r = await act.run(() => post(trip ? `/v1/trips/${g.scopeId}/leave` : `/v1/activities/${g.scopeId}/leave`));
      if (r) router.replace('/inbox');
    }
  };
  const cancel = async () => {
    if (await confirmAsync(trip ? t('Cancel this trip?') : t('Cancel this activity?'), t('Everyone in the group is told and the chat ends with it.'), trip ? t('Cancel trip') : t('Cancel activity'), true)) {
      const r = await act.run(() => post(trip ? `/v1/trips/${g.scopeId}/cancel` : `/v1/activities/${g.scopeId}/cancel`));
      if (r) void info.reload();
    }
  };

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing}>
      <View style={{ alignItems: 'center', gap: 8 }}>
        {g.category ? <CatPhoto category={g.category} style={{ width: 96, height: 96, borderRadius: 48 }} /> : <Avatar name={g.title} size={96} />}
        <Txt variant="h1" style={{ textAlign: 'center' }}>{g.title}</Txt>
        <Txt variant="muted">{trip ? t('Trip group') : t('Activity group')} · {tn(g.members.length, '{n} person', '{n} people')}</Txt>
      </View>

      {finished && <Banner tone="ok">{t('This activity has ended.')}</Banner>}
      {closed && <Banner tone="warn">{g.status === 'archived' ? t('This group is archived: read only.') : trip ? t('This trip was cancelled.') : t('This activity was cancelled.')}</Banner>}
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
          <Txt style={{ flex: 1 }}>{t('{n} of {capacity} places taken', { n: g.members.length, capacity: g.capacity })}</Txt>
        </Row>
        <Btn title={trip ? t('View trip') : t('View activity')} variant="secondary" small onPress={open} />
      </Card>

      <Txt variant="h2" accessibilityRole="header">{tn(g.members.length, '{n} person', '{n} people')}</Txt>
      <View style={{ gap: 2 }}>
        <Paged items={g.members} render={(m) => (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            accessibilityLabel={`${m.displayName}${m.isMe ? t(', you') : ''}${m.role === 'host' ? t(', host and group admin') : ''}. ${t('Open profile')}`}
            onPress={() => go(m.isMe ? '/profile' : `/user/${m.id}`)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, minHeight: 56 }, pressed && { opacity: 0.8 }]}
          >
            <Avatar name={m.displayName} uri={m.photoUrl} size={44} />
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3">{m.displayName}{m.isMe ? ` ${t('(you)')}` : ''} {m.verifiedAdult ? <Ionicons name="checkmark" size={14} color={c.green} /> : null}</Txt>
              <Txt variant="small">{m.verifiedAdult ? t('Verified adult') : t('Not verified')}</Txt>
            </View>
            {m.role === 'host' ? <Chip label={trip ? t('Organizer · admin') : t('Host · admin')} tone="ok" /> : null}
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        )} />
      </View>

      {me?.role === 'host' ? (
        <View style={{ gap: 10 }}>
          {!closed && !finished && <Btn title={trip ? t('Cancel trip') : t('Cancel activity')} variant="danger" loading={act.busy} onPress={cancel} />}
        </View>
      ) : (
        !closed && <>
          <Btn title={trip ? t('Leave group and trip') : t('Leave group and activity')} variant="danger" loading={act.busy} onPress={leave} />
        </>
      )}
      <Btn title={t('Safety & privacy')} variant="ghost" small onPress={() => go('/safety')} />
    </Screen>
  );
}
