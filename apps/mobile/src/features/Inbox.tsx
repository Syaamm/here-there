import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { TabHeader } from '@/components/TabHeader';
import { Reveal } from '@/components/Reveal';
import { CatPhoto } from '@/components/CatPhoto';
import { Avatar, Btn, Card, Empty, ErrorBanner, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, post, type ConversationRef, type Notif } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { ago, when } from '@/lib/format';
import { primeCache, useAction, useLoad, useRefresh } from '@/lib/hooks';
import { entersFresh } from '@/lib/nav';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useTheme } from '@/lib/theme';
import { useLiveEvents } from '@/lib/live';
import { enablePush, pushState, type PushState } from '@/lib/push';
import { bumpUnread, refreshUnread, setUnread } from '@/lib/unread';

type Tab = 'alerts' | 'chats';
type PendingReq = { id: string; state: string; applicant: { id: string; displayName?: string; photoUrl?: string | null } };

const ICON: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  join_request: 'person-add-outline',
  member_joined: 'person-add-outline',
  follow: 'people-outline',
  request_approved: 'checkmark-circle-outline',
  waitlist_promoted: 'sparkles-outline',
  request_declined: 'close-circle-outline',
  trip_application: 'person-add-outline',
  application_approved: 'checkmark-circle-outline',
  application_declined: 'close-circle-outline',
  activity_changed: 'time-outline',
  activity_cancelled: 'ban-outline',
  host_handover_offer: 'swap-horizontal-outline',
  host_handover_accepted: 'swap-horizontal-outline',
  host_handover_declined: 'swap-horizontal-outline',
  trip_dates_proposed: 'calendar-outline',
  trip_dates_confirmed: 'calendar-outline',
  trip_changed: 'time-outline',
  trip_cancelled: 'ban-outline',
  removed: 'exit-outline',
  verification_result: 'shield-checkmark-outline',
  attendance_marked: 'alert-circle-outline',
  attendance_decided: 'checkmark-done-outline',
  starting_soon: 'alarm-outline',
  warning: 'warning-outline',
  message_removed: 'eye-off-outline',
  travel_match: 'heart-circle-outline',
  activity_confirmed: 'checkmark-done-circle-outline',
  appeal_decided: 'chatbox-ellipses-outline',
};
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Small caps label with an optional count on the right: "NEEDS YOUR ATTENTION   2". */
function SectionLabel({ title, count }: { title: string; count?: number }) {
  const { c } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Txt variant="label" color={c.muted} style={{ fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>{title}</Txt>
      {count ? <Txt variant="label" color={c.muted} style={{ fontSize: 11 }}>{count}</Txt> : null}
    </Row>
  );
}

/**
 * Shared inbox for HERE and THERE, in two parts: Alerts (what needs you, then everything else) and Chats (your group
 * conversations). Operational notices only, no marketing.
 */
export function Inbox() {
  const go = useGo();
  const { c } = useTheme();
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('alerts');
  const notifs = useLoad(() => get<{ items: Notif[]; unreadCount: number }>('/v1/notifications'), [], 60_000, 'inbox:notifs', { animate: true }); // new alerts arrive by the live connection; this is only the slow fallback
  // the alert rows themselves: the server sends them a few at a time, newest first (chat messages are on the Chats tab)
  const alertList = useCursorList<Notif, { unreadCount: number }>('/v1/notifications', { scope: 'alerts' }, 'inbox:alerts', { pollMs: 60_000, animate: true, rowHeight: 76 });
  const convs = useCursorList<ConversationRef>('/v1/me/conversations', {}, 'inbox:convs', { animate: true, rowHeight: 73 });

  useEffect(() => {
    if (notifs.data) setUnread(notifs.data.unreadCount);
  }, [notifs.data]);

  const all = notifs.data?.items ?? [];
  const alerts = all.filter((n) => n.type !== 'chat_message');
  const alertsUnread = alerts.filter((n) => !n.readAt).length; // chat alerts are counted on the Chats tab, not here
  const unreadChats = new Set(all.filter((n) => n.type === 'chat_message' && !n.readAt).map((n) => n.data?.conversationId));

  // Join requests that are still waiting: for each activity you host that has a join-request alert, ask the server who is pending now
  const hostedIds = [...new Set(alerts.filter((n) => n.type === 'join_request' && n.data?.activityId).map((n) => n.data!.activityId!))].slice(0, 6);
  const waiting = useLoad(
    async () => {
      const rows = await Promise.all(
        hostedIds.map(async (id) => {
          try {
            const r = await get<{ items: PendingReq[] }>(`/v1/activities/${id}/requests`);
            const title = alerts.find((n) => n.data?.activityId === id)?.body.split(' wants to join ')[1] ?? 'your activity';
            return { id, title, pending: r.items.filter((x) => x.state === 'requested') };
          } catch {
            return { id, title: '', pending: [] as PendingReq[] };
          }
        }),
      );
      return rows.filter((x) => x.pending.length > 0);
    },
    [hostedIds.join(',')],
    undefined,
    undefined,
    { keep: true }, // no flash of the card disappearing while it is asked again
  );

  // Chats are in the order of their LAST MESSAGE, newest first, whoever wrote it (you included). Reading a chat, or
  // another chat having unread messages, never moves it: it only moves when a newer message appears somewhere. Chats
  // nobody has written in yet follow, in the order the server gives.
  const chatRows = [...convs.items].sort((x, y) => (y.lastMessage ? +new Date(y.lastMessage.at) : 0) - (x.lastMessage ? +new Date(x.lastMessage.at) : 0));


  const refreshAll = () => Promise.all([notifs.reload(), alertList.reload(), convs.reload(), waiting.reload()]);
  const { refreshing, onRefresh } = useRefresh(refreshAll);
  // a new alert or message arrives while this screen is open: the lists update at once
  useLiveEvents((e) => {
    if (e.type === 'notification' || e.type === 'message' || e.type === 'ready' || e.type === 'alerts-changed') void refreshAll();
  });
  const [push, setPush] = useState<PushState>('unsupported');
  useEffect(() => {
    void pushState().then(setPush);
  }, []);
  // coming back to this tab (say, after answering a request on another screen): ask again, so settled alerts are gone
  const focused = useIsFocused();
  const wasFocused = useRef(focused);
  const [visit, setVisit] = useState(0); // counts returns to this tab: the lists ease in again each time you come back, and only then
  useEffect(() => {
    // the lists ease in again only when you ARRIVE (another dock tab); coming back from a chat or a page it is just there
    if (focused && !wasFocused.current && entersFresh('/inbox', false)) setVisit((v) => v + 1);
    wasFocused.current = focused;
  }, [focused]);
  // the chats most likely to be opened next are fetched quietly while the list is in front, so opening one shows its
  // messages at once instead of waiting for them (this never marks anything as read)
  const chatPage = convs;
  const topChats = chatRows.slice(0, 6).map((cv) => cv.conversationId + (cv.lastMessage?.at ?? '')).join(',');
  useEffect(() => {
    if (!focused || !topChats) return;
    let stale = false;
    for (const cv of chatRows.slice(0, 6)) {
      get<{ writable: boolean; items: unknown[] }>(`/v1/conversations/${cv.conversationId}/messages`).then((d) => !stale && primeCache('chat:msgs', [cv.conversationId], d)).catch(() => {});
      get<unknown>(`/v1/conversations/${cv.conversationId}/info`).then((d) => !stale && primeCache('chat:info', [cv.conversationId], d)).catch(() => {});
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, topChats]);

  const act = useAction(() => void refreshAll());

  const stale = me?.eligibility === 'expired' || me?.eligibility === 'reverification_required' || me?.eligibility === 'rejected';
  const needs = (waiting.data?.length ?? 0) + (stale ? 1 : 0);
  const waitingIds = new Set((waiting.data ?? []).map((w) => w.id));
  // what is left for the lists below: not the join requests that already have a card above
  const rest = alertList.items.filter((n) => !(n.type === 'join_request' && n.data?.activityId && waitingIds.has(n.data.activityId)));

  const open = async (n: Notif) => {
    if (!n.readAt) {
      bumpUnread(-1); // the badge on the tab drops straight away
      await act.run(() => post(`/v1/notifications/${n.id}/read`));
      refreshUnread();
    }
    const d = n.data;
    if (n.type.startsWith('attendance_')) go('/reliability');
    else if (n.type === 'warning' && d?.warningId) go(`/appeal?kind=warning&targetId=${d.warningId}`);
    else if (n.type === 'message_removed' && d?.messageId) go(`/appeal?kind=message&targetId=${d.messageId}`);
    else if (n.type === 'appeal_decided') go('/appeal');
    else if (d?.conversationId) go(`/chat/${d.conversationId}`);
    else if (n.type === 'join_request' && d?.activityId) go(`/host/${d.activityId}`);
    else if (n.type === 'trip_application' && d?.tripId) go(`/review/${d.tripId}`);
    else if (d?.activityId) go(`/activity/${d.activityId}`);
    else if (d?.tripId) go(`/trip/${d.tripId}`);
    else if (n.type === 'follow' && (d as { userId?: string } | null)?.userId) go(`/user/${(d as { userId: string }).userId}`);
    else if (n.type === 'verification_result') go('/safety');
  };
  const decide = (activityId: string, r: PendingReq, decision: 'approve' | 'decline') => act.run(() => post(`/v1/activities/${activityId}/requests/${r.id}/decision`, { decision }));

  // a plain function that returns the card, NOT a component: a component declared here would be a new type on every
  // refresh, so React would rebuild every row and each one would play its entrance animation again
  const notifRows = (rows: Notif[]) => (
    <Card style={{ padding: 0, borderRadius: 18, overflow: 'hidden' }}>
      {rows.map((n, i) => (
        <View key={n.id}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${n.title}. ${n.body}. ${ago(n.createdAt)}${n.readAt ? '' : ', unread'}`}
          onPress={() => open(n)}
          style={({ pressed }) => [{ flexDirection: 'row', gap: 12, padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, alignItems: 'flex-start' }, pressed && { backgroundColor: c.accentSoft, transform: [{ scale: 0.99 }] }]}
        >
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={ICON[n.type] ?? 'notifications-outline'} size={18} color={c.forest} />
          </View>
          <View style={{ flex: 1, gap: 1 }}>
            <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{n.title}</Txt>
            <Txt variant="small" numberOfLines={3} style={{ lineHeight: 17 }}>{n.body}</Txt>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Txt variant="small">{ago(n.createdAt)}</Txt>
            {!n.readAt ? <View accessibilityLabel="Unread" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} /> : null}
          </View>
        </Pressable>
        </View>
      ))}
    </Card>
  );

  // 6 alerts at first, more as you scroll (newest first, so Today comes before Earlier)
  const alertPage = alertList;
  const today = rest.filter((n) => isToday(n.createdAt));
  const earlier = rest.filter((n) => !isToday(n.createdAt));

  return (
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing} header={<TabHeader />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="h1" style={{ fontSize: 26, lineHeight: 32 }}>Your inbox</Txt>
        {tab === 'alerts' && alertsUnread > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Mark all read" hitSlop={10} onPress={() => {
              bumpUnread(-alertsUnread); // the Message badge drops by the alerts cleared; chats keep theirs
              void act.run(() => post('/v1/notifications/read-all?scope=alerts')).then(refreshUnread);
            }}>
            <Txt variant="label" color={c.forest} style={{ fontSize: 12 }}>Mark all read</Txt>
          </Pressable>
        ) : null}
      </Row>

      {/* two parts: alerts, and chats on their own */}
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 14, borderWidth: 1, borderColor: c.line, padding: 3 }}>
        {(
          [
            ['alerts', 'Alerts', alertsUnread],
            ['chats', 'Chats', unreadChats.size],
          ] as const
        ).map(([k, label, n]) => {
          const on = tab === k;
          return (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${label}${n ? `, ${n} new` : ''}`} onPress={() => setTab(k)} style={{ flex: 1, minHeight: 40, borderRadius: 11, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : 'transparent' }}>
              <Txt variant="h3" color={on ? c.forest : c.muted} style={{ fontSize: 13 }}>{label}</Txt>
              {n > 0 ? (
                <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{n}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <ErrorBanner message={act.error ?? notifs.error?.message} />

      {push === 'default' ? (
        <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
          <Row style={{ gap: 12, alignItems: 'flex-start' }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="notifications-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>Turn on notifications</Txt>
              <Txt variant="small" style={{ lineHeight: 17 }}>Get a ping for new messages, join requests and when a place opens up, even when the app is closed.</Txt>
            </View>
          </Row>
          <Btn title="Turn on" onPress={() => void enablePush().then(setPush)} />
        </Card>
      ) : push === 'denied' ? (
        <Row style={{ gap: 8, backgroundColor: c.accentSoft, borderRadius: 14, padding: 11, alignItems: 'flex-start' }}>
          <Ionicons name="notifications-off-outline" size={16} color={c.forest} style={{ marginTop: 1 }} />
          <Txt variant="small" style={{ flex: 1, lineHeight: 17, color: c.text }}>Notifications are blocked. You can allow them in your browser or phone settings.</Txt>
        </Row>
      ) : null}

      {tab === 'chats' ? (
        <Reveal key={`chats-${visit}`} from={10} style={{ gap: 16 }}>
          {convs.loading && !convs.data && <Spinner />}
          {convs.data && convs.items.length === 0 && <Empty title="No group chats yet">Chats open once a host approves you.</Empty>}
          {chatRows.length > 0 ? (
            <Card style={{ padding: 0, borderRadius: 18, overflow: 'hidden' }}>
              {chatRows.map((cv, i) => (
                <View key={cv.conversationId}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${cv.title}, ${cv.startsAt ? when(cv.startsAt) : ''}${unreadChats.has(cv.conversationId) ? ', new messages' : ''}`}
                    onPress={() => {
                      if (unreadChats.has(cv.conversationId)) bumpUnread(-1); // opening a chat reads its alert
                      go(`/chat/${cv.conversationId}`);
                    }}
                    style={({ pressed }) => [{ flexDirection: 'row', gap: 12, padding: 12, alignItems: 'center', borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, pressed && { backgroundColor: c.accentSoft }]}
                  >
                    {cv.category ? <CatPhoto category={cv.category} style={{ width: 42, height: 42, borderRadius: 21 }} /> : <Avatar name={cv.title} size={42} />}
                    <View style={{ flex: 1, gap: 1 }}>
                      <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{cv.title}</Txt>
                      <Txt variant="small" numberOfLines={1} style={unreadChats.has(cv.conversationId) ? { color: c.text, fontWeight: '700' } : undefined}>
                        {cv.lastMessage ? `${cv.lastMessage.from ? `${cv.lastMessage.from}: ` : ''}${cv.lastMessage.body}` : `No messages yet${cv.startsAt ? ` · ${when(cv.startsAt)}` : ''}`}
                      </Txt>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      {cv.lastMessage ? <Txt variant="small">{ago(cv.lastMessage.at)}</Txt> : null}
                      {cv.endsAt && +new Date(cv.endsAt) < Date.now() ? <Txt variant="small" bold style={{ fontSize: 10 }}>Ended</Txt> : null}
                      {unreadChats.has(cv.conversationId) ? <View accessibilityLabel="New messages" style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} /> : null}
                    </View>
                  </Pressable>
                </View>
              ))}
            </Card>
          ) : null}
          <PagedTail paged={chatPage} />
        </Reveal>
      ) : (
        <Reveal key={`alerts-${visit}`} from={10} style={{ gap: 16 }}>
          {notifs.loading && !notifs.data && <Spinner />}

          {needs > 0 && (
            <>
              <SectionLabel title="Needs your attention" count={needs} />
              {(waiting.data ?? []).map((w, wi) => {
                const r = w.pending[0];
                const name = r.applicant.displayName ?? 'Someone';
                return (
                  <Reveal key={w.id} index={wi}>
                    <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
                      <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                        <Avatar name={name} uri={r.applicant.photoUrl} size={42} />
                        <View style={{ flex: 1, gap: 1 }}>
                          <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>New join request</Txt>
                          <Txt variant="small" style={{ lineHeight: 17, color: c.text }}>
                            <Text style={{ fontWeight: '800' }}>{name}</Text> wants to join <Text style={{ fontWeight: '800' }}>{w.title}</Text>
                            {w.pending.length > 1 ? ` (+${w.pending.length - 1} more waiting)` : ''}
                          </Txt>
                        </View>
                      </Row>
                      <Row style={{ gap: 10 }}>
                        <Btn title="Decline" variant="secondary" disabled={act.busy} onPress={() => decide(w.id, r, 'decline')} style={{ flex: 1 }} />
                        <Btn title="Approve" disabled={act.busy} onPress={() => decide(w.id, r, 'approve')} style={{ flex: 1 }} />
                      </Row>
                      {w.pending.length > 1 ? <Btn title={`Review all ${w.pending.length} requests ›`} variant="ghost" small onPress={() => go(`/host/${w.id}`)} /> : null}
                    </Card>
                  </Reveal>
                );
              })}
              {stale ? (
                <Reveal index={(waiting.data?.length ?? 0) + 0}>
                  <View style={{ backgroundColor: c.sand, borderRadius: 18, padding: 14, gap: 10 }}>
                    <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                      <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="shield-outline" size={20} color={c.forest} />
                      </View>
                      <View style={{ flex: 1, gap: 1 }}>
                        <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{me?.eligibility === 'rejected' ? 'Verification not approved' : 'Please verify again'}</Txt>
                        <Txt variant="small" style={{ lineHeight: 17, color: c.text }}>
                          {me?.eligibility === 'rejected' ? 'Your last identity check was not approved. You can try again.' : 'For the safety of our community, complete identity verification again before your current one expires.'}
                        </Txt>
                      </View>
                    </Row>
                    <Btn title="Verify now" onPress={() => go('/verify')} />
                  </View>
                </Reveal>
              ) : null}
            </>
          )}

          {today.length > 0 && (
            <>
              <SectionLabel title="Today" />
              {notifRows(today)}
            </>
          )}
          {earlier.length > 0 && (
            <>
              <SectionLabel title="Earlier" />
              {notifRows(earlier)}
            </>
          )}
          <PagedTail paged={alertPage} />
          {notifs.data && needs === 0 && rest.length === 0 && <Empty title="You're all caught up">Join requests, approvals and changes to your plans show up here.</Empty>}
        </Reveal>
      )}

      <Row style={{ gap: 8, backgroundColor: c.accentSoft, borderRadius: 14, padding: 11, alignItems: 'flex-start' }}>
        <Ionicons name="information-circle-outline" size={16} color={c.forest} style={{ marginTop: 1 }} />
        <Txt variant="small" style={{ flex: 1, lineHeight: 17, color: c.text }}>Alerts only ever cover your plans and your chats. They are never mixed with marketing.</Txt>
      </Row>
    </Screen>
  );
}
