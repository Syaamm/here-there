import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { TabHeader, ModeSwitch, Wordmark } from '@/components/TabHeader';
import { Reveal } from '@/components/Reveal';
import { CatPhoto } from '@/components/CatPhoto';
import { Avatar, Between, Btn, Card, Empty, ErrorBanner, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, post, type ConversationRef, type Notif } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { ago, when } from '@/lib/format';
import { primeCache, useAction, useLoad, useRefresh } from '@/lib/hooks';
import { entersFresh } from '@/lib/nav';
import { PagedTail, useCursorList } from '@/lib/paged';
import { useTheme } from '@/lib/theme';
import { useLiveEvents } from '@/lib/live';
import { alertRoute } from '@/lib/alerts';
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
  spot_opened: 'add-circle-outline',
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
  host_absence_reported: 'person-remove-outline',
  host_absence_decided: 'checkmark-done-outline',
  report_update: 'flag-outline',
  report_decision: 'document-text-outline',
};
const SOFT = { shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 } as const;
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** THERE's top of the page: the wordmark with "Be Here.Go There." under it, and the HERE | THERE switch (kept: it is how you change product). */
function ThereHeader() {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Between>
      <View style={{ gap: 3 }}>
        <Wordmark size={24} />
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 15 }}>{t('Be Here.Go There.')}</Text>
      </View>
      <ModeSwitch />
    </Between>
  );
}

/** Section title ("Join Requests"), with an optional count on the right. */
function SectionLabel({ title, count }: { title: string; count?: number }) {
  const { c, mode } = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: mode === 'there' ? 15 : 16, lineHeight: 22, fontWeight: '600' }}>{title}</Text>
      {count ? <Txt variant="label" color={c.muted} style={{ fontSize: 12 }}>{count}</Txt> : null}
    </Row>
  );
}

/**
 * Shared inbox for HERE and THERE, in two parts: Alerts (what needs you, then everything else) and Chats (your group
 * conversations). Operational notices only, no marketing.
 */
export function Inbox() {
  const { t } = useT();
  const go = useGo();
  const { c, mode, switchMode } = useTheme();
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('chats');
  const [q, setQ] = useState(''); // search box on the Chats tab: narrows the chats already loaded
  // each product has its own alerts and chats: HERE shows activity ones, THERE shows trip ones (follows, warnings and the like show in both)
  const notifs = useLoad(() => get<{ items: Notif[]; unreadCount: number; unreadByProduct?: { here: number; there: number } }>(`/v1/notifications?product=${mode}`), [mode], 60_000, 'inbox:notifs', { animate: true, live: true }); // new alerts arrive by the live connection; this is only the slow fallback
  // the alert rows themselves: the server sends them a few at a time, newest first (chat messages are on the Chats tab)
  const alertList = useCursorList<Notif, { unreadCount: number }>('/v1/notifications', { scope: 'alerts', product: mode }, 'inbox:alerts', { pollMs: 60_000, live: true, animate: true, rowHeight: 76 });
  const convs = useCursorList<ConversationRef>('/v1/me/conversations', { product: mode }, 'inbox:convs', { animate: true, rowHeight: 73 });

  useEffect(() => {
    if (notifs.data) setUnread(notifs.data.unreadCount);
  }, [notifs.data]);

  const other = mode === 'here' ? 'there' : 'here';
  const otherNew = notifs.data?.unreadByProduct?.[other] ?? 0;
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
            const title = alerts.find((n) => n.data?.activityId === id)?.body.split(' wants to join ')[1] ?? '';
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
  const chatRows = [...convs.items].filter((cv) => !q.trim() || cv.title.toLowerCase().includes(q.trim().toLowerCase())).sort((x, y) => (y.lastMessage ? +new Date(y.lastMessage.at) : 0) - (x.lastMessage ? +new Date(x.lastMessage.at) : 0));


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
    const to = alertRoute(n);
    if (to) go(to); // the page it opens flips to its own product if needed
  };
  // when the newest join-request alert for this activity arrived (shown as "5m ago" in THERE)
  const joinedAt = (activityId: string) => alerts.find((n) => n.type === 'join_request' && n.data?.activityId === activityId)?.createdAt;
  const decide = (activityId: string, r: PendingReq, decision: 'approve' | 'decline') => act.run(() => post(`/v1/activities/${activityId}/requests/${r.id}/decision`, { decision }));

  // a plain function that returns the card, NOT a component: a component declared here would be a new type on every
  // refresh, so React would rebuild every row and each one would play its entrance animation again
  const notifRows = (rows: Notif[]) => (
    <View>
      {rows.map((n, i) => (
        <Pressable
          key={n.id}
          accessibilityRole="button"
          accessibilityLabel={`${n.title}. ${n.body}. ${ago(n.createdAt)}${n.readAt ? '' : `, ${t('unread')}`}`}
          onPress={() => open(n)}
          style={({ pressed }) => [{ flexDirection: 'row', gap: 12, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, alignItems: 'flex-start' }, pressed && { opacity: 0.7 }]}
        >
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: mode === 'there' ? 34 : 40, height: mode === 'there' ? 34 : 40, borderRadius: 20, backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={ICON[n.type] ?? 'notifications-outline'} size={mode === 'there' ? 17 : 19} color={c.forest} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={2} style={{ color: c.text, fontSize: mode === 'there' ? 15 : 16, lineHeight: 21, fontWeight: '600' }}>{n.title}</Text>
            <Text numberOfLines={3} style={{ color: c.muted, fontSize: mode === 'there' ? 13 : 14, lineHeight: 19 }}>{n.body}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{ago(n.createdAt)}</Text>
            {!n.readAt ? <View accessibilityLabel={t('Unread')} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} /> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );

  // 6 alerts at first, more as you scroll (newest first, so Today comes before Earlier)
  const alertPage = alertList;
  const today = rest.filter((n) => isToday(n.createdAt));
  const earlier = rest.filter((n) => !isToday(n.createdAt));

  return (
    <Screen tabBar plain onRefresh={onRefresh} refreshing={refreshing} header={mode === 'there' ? <ThereHeader /> : <TabHeader plain />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: mode === 'there' ? 24 : 26, lineHeight: 32, fontWeight: '600' }}>{t('Your Inbox')}</Text>
        {tab === 'alerts' && alertsUnread > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Mark all read')} hitSlop={12} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => {
              bumpUnread(-alertsUnread); // the Message badge drops by the alerts cleared; chats keep theirs
              void act.run(() => post(`/v1/notifications/read-all?scope=alerts&product=${mode}`)).then(refreshUnread);
            }}>
            <Txt variant="label" color={c.forest} style={{ fontSize: 12 }}>{t('Mark all read')}</Txt>
          </Pressable>
        ) : null}
      </Row>

      {/* two parts: alerts, and chats on their own */}
      <View accessibilityRole="tablist" style={[{ flexDirection: 'row', borderRadius: 30, backgroundColor: c.surface, padding: 5 }, SOFT]}>
        {(
          [
            ['chats', t('Chats'), unreadChats.size],
            ['alerts', t('Alerts'), alertsUnread],
          ] as const
        ).map(([k, label, n]) => {
          const on = tab === k;
          return (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${label}${n ? `, ${t('{n} new', { n })}` : ''}`} onPress={() => setTab(k)} style={{ flex: 1, minHeight: 44, borderRadius: 25, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.sand : 'transparent' }}>
              <Text style={{ color: c.text, fontSize: mode === 'there' ? 15 : 16, fontWeight: '600' }}>{label}</Text>
              {n > 0 ? (
                <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: c.danger, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 10, lineHeight: 13, fontWeight: '800', textAlign: 'center', includeFontPadding: false }}>{n}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <ErrorBanner message={act.error ?? notifs.error?.message} />

      {/* something new for the other product: one tap goes there (the alert itself stays in that product's inbox) */}
      {otherNew > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('{n} new in {name}', { n: otherNew, name: other.toUpperCase() })}
          onPress={() => switchMode(other)}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.accentSoft, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 }, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="swap-horizontal-outline" size={16} color={c.forest} />
          <Txt variant="small" style={{ flex: 1, color: c.text }}>{t('{n} new in {name}', { n: otherNew, name: other.toUpperCase() })}</Txt>
          <Ionicons name="chevron-forward" size={16} color={c.muted} />
        </Pressable>
      ) : null}

      {push === 'default' ? (
        <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
          <Row style={{ gap: 12, alignItems: 'flex-start' }}>
            <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="notifications-outline" size={18} color={c.forest} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{t('Turn on notifications')}</Txt>
            </View>
          </Row>
          <Btn title={t('Turn on')} onPress={() => void enablePush().then(setPush)} />
        </Card>
      ) : push === 'denied' ? (
        <Row style={{ gap: 8, backgroundColor: c.accentSoft, borderRadius: 14, padding: 11, alignItems: 'flex-start' }}>
          <Ionicons name="notifications-off-outline" size={16} color={c.forest} style={{ marginTop: 1 }} />
          <Txt variant="small" style={{ flex: 1, lineHeight: 17, color: c.text }}>{t('Notifications are blocked. Allow them in settings.')}</Txt>
        </Row>
      ) : null}

      {tab === 'chats' ? (
        <Reveal key={`chats-${visit}`} from={10} style={{ gap: 16 }}>
          {convs.loading && !convs.data && <Spinner />}
          {convs.data && convs.items.length === 0 && <Empty title={t('No group chats yet')} />}
          <View style={{ minHeight: 48, borderRadius: 27, borderWidth: mode === 'there' ? 0 : 1, borderColor: c.line, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
            <Ionicons name="search-outline" size={18} color={c.muted} />
            <TextInput accessibilityLabel={t('Search chats')} value={q} onChangeText={setQ} placeholder={t('Search chats')} placeholderTextColor={c.placeholder} returnKeyType="search" clearButtonMode="while-editing" style={{ flex: 1, fontSize: 16, color: c.text, paddingVertical: 0, minHeight: 24, includeFontPadding: false, textAlignVertical: 'center' }} />
          </View>
          {q.trim() && convs.data && chatRows.length === 0 ? <Empty title={t('No chats match')} /> : null}
          {chatRows.length > 0 ? (
            <View>
              {chatRows.map((cv, i) => (
                <View key={cv.conversationId}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${cv.title}, ${cv.startsAt ? when(cv.startsAt) : ''}${unreadChats.has(cv.conversationId) ? `, ${t('new messages')}` : ''}`}
                    onPress={() => {
                      if (unreadChats.has(cv.conversationId)) bumpUnread(-1); // opening a chat reads its alert
                      go(`/chat/${cv.conversationId}`);
                    }}
                    style={({ pressed }) => [{ flexDirection: 'row', gap: 12, paddingVertical: 16, alignItems: 'center', borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, pressed && { opacity: 0.7 }]}
                  >
                    {cv.category ? <CatPhoto category={cv.category} style={{ width: 40, height: 40, borderRadius: 20 }} /> : <Avatar name={cv.title} size={40} />}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text numberOfLines={1} style={{ color: c.text, fontSize: mode === 'there' ? 15 : 16, lineHeight: 21, fontWeight: '600' }}>{cv.title}</Text>
                      <Text numberOfLines={1} style={[{ color: c.muted, fontSize: mode === 'there' ? 14 : 15, lineHeight: 20 }, unreadChats.has(cv.conversationId) ? { color: c.text, fontWeight: '700' } : null]}>
                        {cv.lastMessage ? `${cv.lastMessage.from ? `${cv.lastMessage.from === 'You' ? t('You') : cv.lastMessage.from}: ` : ''}${cv.lastMessage.body}` : `${t('No messages yet')}${cv.startsAt ? ` · ${when(cv.startsAt)}` : ''}`}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      {cv.lastMessage ? <Text style={{ color: c.muted, fontSize: mode === 'there' ? 11 : 12, lineHeight: 16 }}>{mode === 'there' ? `${ago(cv.lastMessage.at)} ${t('ago')}` : ago(cv.lastMessage.at)}</Text> : null}
                      {cv.endsAt && +new Date(cv.endsAt) < Date.now() ? <Txt variant="small" bold style={{ fontSize: 10 }}>{t('Ended')}</Txt> : null}
                      {unreadChats.has(cv.conversationId) ? <View accessibilityLabel={t('New messages')} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.danger }} /> : null}
                    </View>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          <PagedTail paged={chatPage} />
        </Reveal>
      ) : (
        <Reveal key={`alerts-${visit}`} from={10} style={{ gap: 16 }}>
          {notifs.loading && !notifs.data && <Spinner />}

          {needs > 0 && (
            <>
              <SectionLabel title={t('Join Requests')} count={needs > 1 ? needs : undefined} />
              {(waiting.data ?? []).map((w, wi) => {
                const r = w.pending[0];
                const name = r.applicant.displayName ?? t('Someone');
                return (
                  <Reveal key={w.id} index={wi}>
                    <View style={{ paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: c.line }}>
                      <Row style={{ gap: mode === 'there' ? 14 : 12, alignItems: 'flex-start' }}>
                        <Avatar name={name} uri={r.applicant.photoUrl} size={40} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <Text style={{ color: c.text, fontSize: mode === 'there' ? 16.5 : 17, lineHeight: 22, fontWeight: '600' }}>{name}</Text>
                            {mode === 'there' && joinedAt(w.id) ? <Text style={{ color: c.muted, fontSize: 11, lineHeight: 22 }}>{`${ago(joinedAt(w.id)!)} ${t('ago')}`}</Text> : null}
                          </Row>
                          <Text style={{ color: c.muted, fontSize: mode === 'there' ? 14.5 : 15, lineHeight: 21 }}>
                            {t('wants to join')} <Text style={{ color: c.text, fontWeight: '600' }}>{w.title || t('your activity')}</Text>
                            {w.pending.length > 1 ? ` ${t('(+{n} more waiting)', { n: w.pending.length - 1 })}` : ''}
                          </Text>
                        </View>
                      </Row>
                      <Row style={{ gap: mode === 'there' ? 14 : 12, paddingLeft: mode === 'there' ? 47 : 52 }}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`${t('Accept')}: ${name}`} accessibilityState={{ disabled: act.busy }} disabled={act.busy} hitSlop={4} onPress={() => decide(w.id, r, 'approve')} style={({ pressed }) => [{ minHeight: 44, minWidth: mode === 'there' ? 78 : 80, paddingHorizontal: 22, borderRadius: 22, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', opacity: act.busy ? 0.5 : 1 }, pressed && { opacity: 0.8 }]}>
                          <Text style={{ color: '#fff', fontSize: mode === 'there' ? 13 : 15, fontWeight: '500' }}>{t('Accept')}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel={`${t('Decline')}: ${name}`} accessibilityState={{ disabled: act.busy }} disabled={act.busy} hitSlop={4} onPress={() => decide(w.id, r, 'decline')} style={({ pressed }) => [{ minHeight: 44, minWidth: mode === 'there' ? 76 : 80, paddingHorizontal: 22, borderRadius: 22, borderWidth: mode === 'there' ? 0 : 1, borderColor: c.line, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', opacity: act.busy ? 0.5 : 1 }, pressed && { opacity: 0.8 }]}>
                          <Text style={{ color: c.text, fontSize: mode === 'there' ? 13 : 15, fontWeight: '500' }}>{t('Decline')}</Text>
                        </Pressable>
                      </Row>
                      {w.pending.length > 1 ? <Btn title={t('Review all {n} requests ›', { n: w.pending.length })} variant="ghost" small onPress={() => go(`/host/${w.id}`)} /> : null}
                    </View>
                  </Reveal>
                );
              })}
              {stale ? (
                <Reveal index={(waiting.data?.length ?? 0) + 0}>
                  <View style={{ backgroundColor: c.sand, borderRadius: 24, padding: 16, gap: 10 }}>
                    <Row style={{ gap: 12, alignItems: 'flex-start' }}>
                      <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="shield-outline" size={20} color={c.forest} />
                      </View>
                      <View style={{ flex: 1, gap: 1 }}>
                        <Txt variant="h3" style={{ fontSize: 14, lineHeight: 18 }}>{me?.eligibility === 'rejected' ? t('Verification not approved') : t('Please verify again')}</Txt>
                        <Txt variant="small" style={{ lineHeight: 17, color: c.text }}>
                          {me?.eligibility === 'rejected' ? t('Your last identity check was not approved. You can try again.') : t('Please verify again before your current check expires.')}
                        </Txt>
                      </View>
                    </Row>
                    <Btn title={t('Verify now')} onPress={() => go('/verify')} />
                  </View>
                </Reveal>
              ) : null}
            </>
          )}

          {today.length > 0 && (
            <>
              <SectionLabel title={t('Activity & Spot Updates')} />
              {notifRows(today)}
            </>
          )}
          {earlier.length > 0 && (
            <>
              <SectionLabel title={t('Earlier')} />
              {notifRows(earlier)}
            </>
          )}
          <PagedTail paged={alertPage} />
          {notifs.data && needs === 0 && rest.length === 0 && <Empty title={t("You're all caught up")} />}
        </Reveal>
      )}

    </Screen>
  );
}
