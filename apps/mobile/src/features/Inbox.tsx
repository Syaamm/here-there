import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { TabHeader } from '@/components/TabHeader';
import { Reveal } from '@/components/Reveal';
import { CatPhoto } from '@/components/CatPhoto';
import { Avatar, Banner, Between, Btn, Card, Empty, ErrorBanner, ListRow, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, post, type ConversationRef, type Notif } from '@/lib/api';
import { ago, when } from '@/lib/format';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type Tab = 'all' | 'requests' | 'updates' | 'chats';

const REQUEST_TYPES = ['join_request', 'request_approved', 'request_declined', 'trip_application', 'application_approved', 'application_declined'];
const ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  chat_message: 'chatbubble-outline',
  join_request: 'notifications-outline',
  request_approved: 'checkmark-circle-outline',
  request_declined: 'close-circle-outline',
  trip_application: 'notifications-outline',
  application_approved: 'checkmark-circle-outline',
  application_declined: 'close-circle-outline',
  activity_changed: 'time-outline',
  activity_cancelled: 'ban-outline',
  trip_changed: 'time-outline',
  trip_cancelled: 'ban-outline',
  removed: 'exit-outline',
  verification_result: 'id-card-outline',
};
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Shared inbox for HERE and THERE: decisions, changes and conversations. Operational notices only, no marketing. */
export function Inbox() {
  const go = useGo();
  const { c } = useTheme();
  const [tab, setTab] = useState<Tab>('all');
  const notifs = useLoad(() => get<{ items: Notif[]; unreadCount: number }>('/v1/notifications'), [], 15_000);
  const convs = useLoad(() => get<{ items: ConversationRef[] }>('/v1/me/conversations'), []);
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([notifs.reload(), convs.reload()]));
  const act = useAction(notifs.reload);

  const all = notifs.data?.items ?? [];
  const items = all.filter((n) => (tab === 'requests' ? REQUEST_TYPES.includes(n.type) : tab === 'updates' ? !REQUEST_TYPES.includes(n.type) && n.type !== 'chat_message' : true));
  const unreadChats = new Set(all.filter((n) => n.type === 'chat_message' && !n.readAt).map((n) => n.data?.conversationId));

  const open = async (n: Notif) => {
    if (!n.readAt) await act.run(() => post(`/v1/notifications/${n.id}/read`));
    const d = n.data;
    if (d?.conversationId) go(`/chat/${d.conversationId}`);
    else if (n.type === 'join_request' && d?.activityId) go(`/host/${d.activityId}`);
    else if (n.type === 'trip_application' && d?.tripId) go(`/review/${d.tripId}`);
    else if (d?.activityId) go(`/activity/${d.activityId}`);
    else if (d?.tripId) go(`/trip/${d.tripId}`);
    else if (n.type === 'verification_result') go('/safety');
  };

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing} header={<TabHeader />}>
      <Between>
        <Txt variant="h1">Your inbox</Txt>
        {!!notifs.data?.unreadCount && <Btn title="Mark all read" variant="ghost" small onPress={() => act.run(() => post('/v1/notifications/read-all'))} />}
      </Between>
      <PillRow>
        {(['all', 'requests', 'updates', 'chats'] as Tab[]).map((t) => (
          <Pill key={t} label={t[0].toUpperCase() + t.slice(1)} active={tab === t} onPress={() => setTab(t)} />
        ))}
      </PillRow>
      <ErrorBanner message={act.error ?? notifs.error?.message} />

      {tab === 'chats' ? (
        <>
          {convs.loading && !convs.data && <Spinner />}
          {convs.data && convs.data.items.length === 0 && <Empty title="No group chats yet">Chats open once an organizer approves you.</Empty>}
          {convs.data?.items.map((cv, ci) => (
            <Reveal key={cv.conversationId} index={ci}>
            <Card onPress={() => go(`/chat/${cv.conversationId}`)} accessibilityLabel={`${cv.title}, ${cv.startsAt ? when(cv.startsAt) : ''}${unreadChats.has(cv.conversationId) ? ', new messages' : ''}`} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderRadius: 14 }}>
              {cv.category ? <CatPhoto category={cv.category} style={{ width: 40, height: 40, borderRadius: 20 }} /> : <Avatar name={cv.title} size={40} />}
              <View style={{ flex: 1 }}>
                <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 19 }}>{cv.title}</Txt>
                <Txt variant="small" numberOfLines={1}>{cv.startsAt ? `${when(cv.startsAt)} · ` : ''}{cv.scope === 'trip' ? 'Trip group' : 'Activity group'}</Txt>
              </View>
              {unreadChats.has(cv.conversationId) && <Text style={{ color: '#fff', backgroundColor: c.green, fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' }}>New</Text>}
            </Card>
            </Reveal>
          ))}
        </>
      ) : (
        <>
          {notifs.loading && !notifs.data && <Spinner />}
          {notifs.data && items.length === 0 && <Empty title="You're all caught up">Join requests, approvals and changes to your plans show up here.</Empty>}
          {[['Today', items.filter((n) => isToday(n.createdAt))], ['Earlier', items.filter((n) => !isToday(n.createdAt))]].map(([label, rows]) =>
            (rows as Notif[]).length ? (
              <View key={label as string}>
                <Txt variant="label" color={c.muted} style={{ marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label as string}</Txt>
                {(rows as Notif[]).map((n, i, all) => (
                  <Reveal key={n.id} index={i}>
                  <ListRow
                    icon={ICON[n.type] ?? 'notifications-outline'}
                    title={n.title}
                    subtitle={`${n.body} · ${ago(n.createdAt)}`}
                    onPress={() => open(n)}
                    last={i === all.length - 1}
                    right={
                      <Row style={{ gap: 8 }}>
                        {!n.readAt && <View accessibilityLabel="Unread" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.green }} />}
                        <Ionicons name="chevron-forward" size={16} color={c.muted} />
                      </Row>
                    }
                  />
                  </Reveal>
                ))}
              </View>
            ) : null,
          )}
        </>
      )}
      <Banner>These alerts are in-app for now. Push notifications and quiet hours aren't set up yet. Operational notices are never mixed with marketing.</Banner>
    </Screen>
  );
}
