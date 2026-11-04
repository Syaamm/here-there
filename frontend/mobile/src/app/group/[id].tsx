import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ScaledText';
import { BackArrow, ModeSwitch } from '@/components/TabHeader';
import { statusTop } from '@/lib/layout';
import { Pressable, View } from 'react-native';
import { CatPhoto } from '@/components/CatPhoto';
import { Avatar, Banner, Btn, Empty, ErrorBanner, Screen, useGo } from '@/components/ui';
import { get, post, type GroupInfo } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, timeRange } from '@/lib/format';
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
  const { c, mode } = useTheme();
  const go = useGo();
  const insets = useSafeAreaInsets();
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

  const left = Math.max(0, g.capacity - g.members.length);
  const hostRole = trip ? t('Organizer · admin') : t('Host · admin');
  // the three quick actions under the title: back to the chat, the activity itself, and the way out
  const actions: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void; danger?: boolean }[] = [
    { icon: 'chatbubble-ellipses-outline', label: t('Message'), onPress: () => go(`/chat/${id}`) },
    { icon: trip ? 'airplane-outline' : 'calendar-outline', label: trip ? t('View trip') : t('View activity'), onPress: open },
    ...(me?.role === 'host' ? (!closed && !finished ? [{ icon: 'close-circle-outline' as const, label: trip ? t('Cancel trip') : t('Cancel activity'), onPress: cancel, danger: true }] : []) : !closed ? [{ icon: 'exit-outline' as const, label: t('Leave'), onPress: leave, danger: true }] : []),
  ];
  const fact = (icon: React.ComponentProps<typeof Ionicons>['name'], title: string, sub?: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Ionicons name={icon} size={24} color={c.text} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '500' }}>{title}</Text>
        {sub ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 19 }}>{sub}</Text> : null}
      </View>
    </View>
  );

  return (
    <Screen
      tabBar
      onRefresh={onRefresh}
      refreshing={refreshing}
      hero={
        <View>
          <Stack.Screen options={{ headerShown: false }} />
          <LinearGradient colors={['#FFFFFF', mode === 'there' ? c.sand : '#B7DBCF']} style={{ paddingTop: statusTop(insets.top) + 8, paddingBottom: 36, paddingHorizontal: 16, alignItems: 'center', gap: 8 }}>
            <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <BackArrow />
              <ModeSwitch />
            </View>
            {g.category ? <CatPhoto category={g.category} style={{ width: 100, height: 100, borderRadius: 50 }} /> : <Avatar name={g.title} size={100} />}
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 30, fontWeight: '600', textAlign: 'center', marginTop: 6 }} numberOfLines={3}>{g.title}</Text>
            <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>{trip ? t('Trip group') : t('Activity group')} · {tn(g.members.length, '{n} person', '{n} people')}</Text>
          </LinearGradient>
          <View style={{ height: 30, marginTop: -30, borderTopLeftRadius: 40, borderTopRightRadius: 40, backgroundColor: c.bg }} />
        </View>
      }
    >
      <View style={{ flexDirection: 'row', backgroundColor: c.surface, borderRadius: 36, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
        {actions.map((a, k) => (
          <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label} disabled={a.danger && act.busy} onPress={a.onPress} style={({ pressed }) => [{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, borderLeftWidth: k ? 1 : 0, borderLeftColor: c.line }, pressed && { opacity: 0.7 }]}>
            <Ionicons name={a.icon} size={22} color={a.danger ? c.danger : c.text} />
            <Text numberOfLines={2} style={{ color: a.danger ? c.danger : c.muted, fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: 4 }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      {finished && <Banner tone="ok">{t('This activity has ended.')}</Banner>}
      {closed && <Banner tone="warn">{g.status === 'archived' ? t('This group is archived: read only.') : trip ? t('This trip was cancelled.') : t('This activity was cancelled.')}</Banner>}
      <ErrorBanner message={act.error} />

      <View>
        {mode === 'there' && trip ? (
          <>
            {/* THERE: the destination first, with how many days the trip lasts, then the dates */}
            {fact('location-outline', g.place, tn(Math.max(1, Math.round((+new Date(g.endsAt) - +new Date(g.startsAt)) / 86400000) + 1), '{n} day', '{n} days'))}
            {fact('time-outline', dateSpan(g.startsAt, g.endsAt))}
          </>
        ) : (
          <>
            {fact('time-outline', timeRange(g.startsAt, g.endsAt))}
            {fact('location-outline', g.place)}
          </>
        )}
        {fact('person-add-outline', t('{n} of {capacity} places taken', { n: g.members.length, capacity: g.capacity }), left > 0 ? tn(left, '{n} spot left', '{n} spots left') : undefined)}
      </View>

      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '600', marginTop: 8 }}>{tn(g.members.length, '{n} person', '{n} people')}</Text>
      <View style={{ gap: 2 }}>
        <Paged items={g.members} render={(m) => (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            accessibilityLabel={`${m.displayName}${m.isMe ? t(', you') : ''}${m.role === 'host' ? t(', host and group admin') : ''}. ${t('Open profile')}`}
            onPress={() => go(m.isMe ? '/profile' : `/user/${m.id}`)}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, minHeight: 64 }, pressed && { opacity: 0.8 }]}
          >
            <Avatar name={m.displayName} uri={m.photoUrl} size={45} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600', flexShrink: 1 }}>{m.displayName}{m.isMe ? ` ${t('(you)')}` : ''}</Text>
                {m.verifiedAdult ? <Ionicons name="checkmark-circle" size={18} color="#2F7BE0" /> : null}
              </View>
              <Text style={{ color: c.muted, fontSize: 14, lineHeight: 19 }}>{m.verifiedAdult ? t('Verified adult') : t('Not verified')}</Text>
            </View>
            {m.role === 'host' ? (
              <View style={{ backgroundColor: mode === 'there' ? '#EBEFEE' : c.sand, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 }}>
                <Text style={{ color: c.forest, fontSize: 12, lineHeight: 16, fontWeight: '500', includeFontPadding: false }}>{hostRole}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={c.muted} />
          </Pressable>
        )} />
      </View>

      <Btn title={t('Safety & privacy')} variant="ghost" small onPress={() => go('/safety')} />
    </Screen>
  );
}
