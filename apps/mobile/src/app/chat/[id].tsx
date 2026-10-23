import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Linking, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text, TextInput } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { CatPhoto } from '@/components/CatPhoto';
import { SkeletonChat } from '@/components/Skeleton';
import { Avatar, Banner, Btn, DateField, Empty, ErrorBanner, Field, Screen, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { ApiError, get, post, type ConversationRef, type GroupInfo, type Notif, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, dayLabel, hhmm, parseDay } from '@/lib/format';
import { useKeyboardInset, useKeyboardShown } from '@/lib/keyboard';
import { patchCache, useAction, useLoad } from '@/lib/hooks';
import { BackArrow } from '@/components/TabHeader';
import { statusTop } from '@/lib/layout';
import { useLiveEvents } from '@/lib/live';
import { refreshUnread } from '@/lib/unread';
import { useTheme } from '@/lib/theme';

type PollInfo = { id: string; title: string; dateStart: string | null; dateEnd: string | null; state: 'open' | 'adopted' | 'closed'; accept: number; reject: number; myVote: 'accept' | 'reject' | null };
type Msg = { id: string; body: string; kind?: 'text' | 'poll' | 'system'; poll?: PollInfo | null; createdAt: string; sender: { id: string; displayName: string; photoUrl?: string | null } };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** A date poll in the chat: everyone answers accept or reject; the organizer can turn the dates into the trip's final dates. */
function PollCard({ m, amHost, busy, onVote, onClose }: { m: Msg; amHost: boolean; busy: boolean; onVote: (v: 'accept' | 'reject') => void; onClose: (adopt: boolean) => void }) {
  const { c } = useTheme();
  const p = m.poll;
  if (!p) return null;
  const open = p.state === 'open';
  const choice = (v: 'accept' | 'reject', label: string, icon: React.ComponentProps<typeof Ionicons>['name']) => {
    const on = p.myVote === v;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${v === 'accept' ? p.accept : p.reject} so far`}
        accessibilityState={{ selected: on, disabled: !open || busy }}
        disabled={!open || busy}
        onPress={() => onVote(v)}
        style={({ pressed }) => [{ flex: 1, height: 38, borderRadius: 999, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: open ? 1 : 0.6 }, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name={icon} size={16} color={on ? '#fff' : c.text} />
        <Text style={{ color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 13 }}>{label} · {v === 'accept' ? p.accept : p.reject}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ alignSelf: 'center', width: '92%', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 16, padding: 12, gap: 10, marginVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="calendar-outline" size={16} color={c.green} />
        <Text style={{ color: c.green, fontWeight: '800', fontSize: 11, letterSpacing: 0.6 }}>DATE POLL · {open ? 'OPEN' : p.state === 'adopted' ? 'DATES CHOSEN' : 'CLOSED'}</Text>
      </View>
      <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, lineHeight: 20 }}>{p.title}</Text>
      {p.dateStart && p.dateEnd ? (
        <View style={{ alignSelf: 'flex-start', backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: c.forest, fontWeight: '700', fontSize: 12 }}>{dateSpan(p.dateStart, p.dateEnd)}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {choice('accept', 'Accept', 'checkmark')}
        {choice('reject', 'Reject', 'close')}
      </View>
      {amHost && open ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {p.dateStart && p.dateEnd ? <Btn title="Use these dates" small onPress={() => onClose(true)} loading={busy} style={{ flex: 1 }} /> : null}
          <Btn title="Close poll" small variant="secondary" onPress={() => onClose(false)} loading={busy} style={{ flex: 1 }} />
        </View>
      ) : null}
      {amHost && open && p.dateStart ? <Text style={{ color: c.muted, fontSize: 11, lineHeight: 15 }}>Using these dates asks every member to confirm them. Nobody is committed until they do.</Text> : null}
    </View>
  );
}

/** Opens an outside address, after a safety notice. */
async function openLink(url: string) {
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (await confirmAsync('Leave HERE & THERE?', `This opens ${hostOf(full)} in your browser. We don't check outside websites. Never send money, deposits or ID documents to anyone you met through the app, and book travel only with suppliers you trust.`, 'Open link')) void Linking.openURL(full);
}

/** A message's text, with any web address in it pressable (it shows the safety notice before it opens). */
function Linkified({ text, linkColor }: { text: string; linkColor: string }) {
  const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} accessibilityRole="link" accessibilityHint="Opens a safety notice first" onPress={() => void openLink(part)} style={{ color: linkColor, textDecorationLine: 'underline', fontWeight: '700' }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Group chat for activities (HERE) and trips (THERE).
 * Access is decided by the server from live membership on every call, so removal or leaving cuts access at once.
 */
export default function ChatRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // one fresh screen per conversation: opening another chat never shows the previous one for a moment first
  return <Chat key={id} id={id} />;
}

function Chat({ id }: { id: string }) {
  const { me } = useMe();
  const { c } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();

  const convs = useLoad(() => get<{ items: ConversationRef[] }>('/v1/me/conversations'), [], undefined, 'inbox:convs');
  // Only a chat that is the screen in front counts as read. This screen stays loaded behind others, and a reload there
  // (the app opening, a message arriving) must not clear the alert.
  const focused = useIsFocused();
  const inFront = useRef(focused);
  inFront.current = focused;
  const msgs = useLoad(() => get<{ writable: boolean; ended?: boolean; items: Msg[] }>(`/v1/conversations/${id}/messages${inFront.current ? '?read=1' : ''}`), [id], 30_000, 'chat:msgs', { animate: true });
  // a new message for this chat (or a reconnect) loads at once; the 30-second poll above is only the safety net
  useLiveEvents((e) => {
    if (!inFront.current) return; // not on screen: it loads when you open it
    if (e.type === 'ready' || (e.type === 'message' && e.conversationId === id)) void msgs.reload();
  });
  // fetching the messages reads this chat's alert on the server: ask for the new badge number each time something arrives
  const arrived = msgs.data?.items.length ?? -1;
  useEffect(() => {
    if (arrived >= 0) refreshUnread();
  }, [arrived]);
  const [text, setText] = useState('');
  const typing = useKeyboardShown();
  const bottomGap = typing ? 0 : Math.max(insets.bottom, 10); // no dock here: the chat fills the screen, down to the home bar
  const keyboard = useKeyboardInset();
  // leaving by the swipe-back (or the arrow): the keyboard goes down while the screen goes sideways
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('transitionStart' as never, ((e: { data?: { closing?: boolean } }) => e?.data?.closing && Keyboard.dismiss()) as never), [navigation]); // the chat ends at the bottom edge, so the keyboard simply pushes it up by its own height
  const info = useLoad(() => get<GroupInfo>(`/v1/conversations/${id}/info`), [id], 30_000, 'chat:info', { animate: true });
  const [reportMsg, setReportMsg] = useState<{ id: string; category?: string } | null>(null);
  // press and hold a message: report it (or flag spam), see who wrote it, or block them
  const [picked, setPicked] = useState<Msg | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const send = useAction(() => void msgs.reload());
  // THERE: the trip itself, for the final-dates confirmation under the chat's title
  const tripId = convs.data?.items.find((x) => x.conversationId === id && x.scope === 'trip')?.scopeId;
  const trip = useLoad(() => (tripId ? get<Trip>(`/v1/trips/${tripId}`) : Promise.resolve(null)), [tripId], undefined, 'chat:trip', { animate: true });
  // the dates banner is asked again when the number of messages changes (a note that dates were confirmed arrives as one)
  const seenCount = useRef(-1);
  useEffect(() => {
    const n = msgs.data?.items.length ?? 0;
    if (seenCount.current >= 0 && seenCount.current !== n && tripId) void trip.reload();
    seenCount.current = n;
  }, [msgs.data?.items.length]);
  // the organizer's "+": a date poll or a link
  const [adding, setAdding] = useState<null | 'poll'>(null);
  const [pollTitle, setPollTitle] = useState('');
  const [pollFrom, setPollFrom] = useState('');
  const [pollTo, setPollTo] = useState('');
  const plan = useAction(() => {
    void msgs.reload();
    void trip.reload();
  });
  const pFrom = pollFrom ? parseDay(pollFrom) : null;
  const pTo = pollTo ? parseDay(pollTo) : null;
  const pollErr = (pollFrom && !pFrom ? 'Use the format YYYY-MM-DD' : null) ?? (pollTo && !pollFrom ? 'Add the start date too' : null) ?? (pollTo && !pTo ? 'Use the format YYYY-MM-DD' : null) ?? (pFrom && pTo && pTo < pFrom ? 'The end date is before the start date' : null);
  const createPoll = async () => {
    const r = await plan.run(() => post(`/v1/conversations/${id}/polls`, { title: pollTitle.trim(), ...(pFrom && { dateStart: pFrom.toISOString(), dateEnd: (pTo ?? pFrom).toISOString() }) }));
    if (r) {
      stick.current = true;
      setAdding(null);
      setPollTitle('');
      setPollFrom('');
      setPollTo('');
    }
  };
  const vote = (pollId: string, v: 'accept' | 'reject') => void plan.run(() => post(`/v1/polls/${pollId}/vote`, { vote: v }));
  const closePoll = async (pollId: string, adopt: boolean) => {
    if (adopt && !(await confirmAsync('Use these dates?', 'Every member is asked to confirm them. Nobody is committed until they do.', 'Use dates'))) return;
    void plan.run(() => post(`/v1/polls/${pollId}/close`, { adopt }));
  };
  const confirmDates = () => tripId && void plan.run(() => post(`/v1/trips/${tripId}/confirm-dates`));
  const safety = useAction(() => void msgs.reload());
  const list = useRef<ScrollView>(null);
  const stick = useRef(true);
  const loaded = useRef(false);

  const conv = convs.data?.items.find((x) => x.conversationId === id);
  const count = msgs.data?.items.length ?? 0;
  const locked = msgs.error instanceof ApiError && msgs.error.code === 'NOT_A_MEMBER';

  // follow new messages only while the reader is already at the bottom
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  };

  // The server marks this chat's alert read when its messages are fetched in front, so nothing is asked again here. What
  // this screen does instead is keep the inbox right while it is out of sight: this chat's newest message (yours too) and
  // the fact that it has been read, so on coming back the list is already in its final order with nothing left to catch up.
  const newest = msgs.data?.items[msgs.data.items.length - 1];
  useEffect(() => {
    if (!newest) return;
    patchCache<{ items: ConversationRef[] }>('inbox:convs', [], (old) => ({
      ...old,
      items: old.items.map((cv) => (cv.conversationId === id ? { ...cv, lastMessage: { body: newest.body.slice(0, 140), at: newest.createdAt, from: newest.sender.id === me?.id ? 'You' : newest.sender.displayName } } : cv)),
    }));
    if (inFront.current)
      patchCache<{ items: Notif[]; unreadCount: number }>('inbox:notifs', [], (old) => {
        const mine = (n: Notif) => n.type === 'chat_message' && n.data?.conversationId === id && !n.readAt;
        const unread = old.items.filter(mine).length;
        if (!unread) return old;
        return { ...old, unreadCount: Math.max(0, old.unreadCount - unread), items: old.items.map((n) => (mine(n) ? { ...n, readAt: new Date().toISOString() } : n)) };
      });
  }, [newest?.id]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    stick.current = true;
    const r = await send.run(() => post(`/v1/conversations/${id}/messages`, { body }));
    if (r) setText(''); // on failure the text stays so nothing is lost
  };

  const leave = async () => {
    if (!conv) return;
    if (await confirmAsync(conv.scope === 'trip' ? 'Leave this group and the trip?' : 'Leave this group and the activity?', conv.scope === 'trip' ? 'Leaving the group also takes you out of the trip.' : 'Leaving the group also takes you out of the activity.', 'Leave', true)) {
      const r = await send.run(() => post(conv.scope === 'trip' ? `/v1/trips/${conv.scopeId}/leave` : `/v1/activities/${conv.scopeId}/leave`));
      if (r) router.back();
    }
  };

  const block = async (m: Msg) => {
    if (await confirmAsync(`Block ${m.sender.displayName}?`, "Their messages will be hidden from you and they can't contact you, in HERE or THERE.", 'Block', true)) {
      const r = await safety.run(() => post('/v1/blocks', { userId: m.sender.id }));
      if (r) setNote(`You blocked ${m.sender.displayName}. Their messages are hidden, and you can unblock them in Safety & privacy.`);
    }
  };

  // chatting is for verified adults only
  const needsVerify = msgs.error instanceof ApiError && (msgs.error.code === 'VERIFICATION_REQUIRED' || msgs.error.code === 'ADULT_REQUIRED');
  if (needsVerify)
    return (
      <Screen hasHeader>
        <Empty title="Verify to chat">Group chat is for verified adults. You can keep exploring, and chat opens as soon as you're verified.</Empty>
        <Btn title="Get verified" onPress={() => go('/verify')} />
      </Screen>
    );

  // the host cancelled: the chat is terminated with the activity
  if (msgs.data?.ended)
    return (
      <Screen hasHeader>
        <Empty title="This chat has ended">The {conv?.scope === 'trip' ? 'trip' : 'activity'} was cancelled by the {conv?.scope === 'trip' ? 'organizer' : 'host'}, so its group chat was closed.</Empty>
        {conv ? <Btn title={conv.scope === 'trip' ? 'View trip' : 'View activity'} variant="secondary" onPress={() => go(conv.scope === 'trip' ? `/trip/${conv.scopeId}` : `/activity/${conv.scopeId}`)} /> : null}
      </Screen>
    );

  if (locked)
    return (
      <Screen hasHeader>
        <Empty title="Chat is for approved members">Once the organizer approves your request, the group chat opens here.</Empty>
      </Screen>
    );

  const amHost = !!info.data?.members.find((m) => m.isMe && m.role === 'host');
  const menu = [
    { label: 'Group info', onSelect: () => go(`/group/${id}`) },
    ...(conv ? [{ label: conv.scope === 'trip' ? 'View trip' : 'View activity', onSelect: () => go(conv.scope === 'trip' ? `/trip/${conv.scopeId}` : `/activity/${conv.scopeId}`) }] : []),
    { label: 'Safety tools', onSelect: () => go('/safety') },
    // hosts cannot leave their own group: they cancel the activity instead (see Group info)
    ...(amHost ? [] : [{ label: 'Leave group', danger: true, onSelect: leave }]),
  ];
  const closedText =
    info.data?.status === 'archived'
      ? 'This chat is archived. The activity has ended, so you can read it but not write.'
      : info.data?.status === 'completed'
        ? 'This activity has ended, so the chat is read-only now.'
        : 'This conversation is closed. The activity or trip was cancelled.';

  return (
    // on tablets and desktops the conversation is a centred, readable column rather than edge to edge
    <>
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.bg }}>
    <Animated.View style={{ flex: 1, width: '100%', maxWidth: 760, backgroundColor: c.bg, paddingBottom: keyboard }}>
      <Stack.Screen options={{ title: conv?.title ?? 'Group chat' }} />
      {/* the chat's own top row: back, who it is (tap for group info), and the menu */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: statusTop(insets.top) + 8, paddingBottom: 6, paddingHorizontal: 12 }}>
        <BackArrow />
        <Pressable accessibilityRole="button" accessibilityLabel={`${conv?.title ?? 'Group'}. Open group info`} onPress={() => go(`/group/${id}`)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {info.data?.category ? <CatPhoto category={info.data.category} style={{ width: 38, height: 38, borderRadius: 19 }} /> : <Avatar name={conv?.title} size={38} />}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{conv?.title ?? 'Group chat'}</Text>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{info.data ? `${info.data.members.length} ${info.data.members.length === 1 ? 'person' : 'people'} · tap for group info` : conv?.scope === 'trip' ? 'Trip group' : 'Activity group'}</Text>
          </View>
        </Pressable>
        <Menu items={menu} />
      </View>
      {/* pinned and slim: a note about the last action, and (only while someone still has to confirm) the final dates */}
      {note || (trip.data?.datesState === 'proposed' && (trip.data.datesConfirmedCount ?? 0) < trip.data.members) ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 6 }}>
          {note ? <Banner tone="ok">{note}</Banner> : null}
          {trip.data?.datesState === 'proposed' && (trip.data.datesConfirmedCount ?? 0) < trip.data.members ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: c.accentSoft, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 }}>
              <Ionicons name="calendar-outline" size={14} color={c.forest} />
              <Text numberOfLines={2} style={{ flex: 1, color: c.text, fontSize: 12, lineHeight: 16 }}>
                <Text style={{ fontWeight: '800' }}>Final dates {dateSpan(trip.data.dateStart, trip.data.dateEnd)}</Text> · {trip.data.datesConfirmedCount ?? 0} of {trip.data.members} confirmed{trip.data.myDatesConfirmed ? ' ✓' : ''}
              </Text>
              {trip.data.isMember && !trip.data.myDatesConfirmed ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Confirm you can travel on these dates" disabled={plan.busy} onPress={confirmDates} hitSlop={6} style={({ pressed }) => [{ height: 28, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Confirm</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView ref={list} showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 3 }} onScroll={onScroll} scrollEventThrottle={100} onContentSizeChange={() => {
          if (!stick.current) return;
          // the first load jumps to the latest message; later ones glide
          list.current?.scrollToEnd({ animated: loaded.current });
          if (msgs.data) loaded.current = true;
        }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: c.sand, borderRadius: 14, padding: 10, marginBottom: 6 }}>
          <Ionicons name="lock-closed-outline" size={16} color={c.forest} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, color: c.text, fontSize: 12.5, lineHeight: 17 }}>Only approved members can see this chat. Meet at public venues, and report anything that feels wrong.</Text>
        </View>
        {msgs.loading && !msgs.data && <SkeletonChat />}
        {msgs.data?.items.length === 0 && <Txt variant="muted" style={{ textAlign: 'center' }}>No messages yet. Say hi 👋</Txt>}
        {msgs.data?.items.map((m, i, all) => {
          const mine = m.sender.id === me?.id;
          const newDay = i === 0 || dayLabel(all[i - 1].createdAt) !== dayLabel(m.createdAt);
          // in a run of messages from one person the name shows once, on the first
          const showName = !mine && (newDay || all[i - 1].sender.id !== m.sender.id);
          const day = newDay ? (
            <View style={{ alignSelf: 'center', backgroundColor: c.infoBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, marginVertical: 8 }}>
              <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>{dayLabel(m.createdAt)}</Text>
            </View>
          ) : null;
          if (m.kind === 'system')
            return (
              <Fragment key={m.id}>
                {day}
                <View style={{ alignSelf: 'center', maxWidth: '88%', backgroundColor: c.accentSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, marginVertical: 4 }}>
                  <Text style={{ color: c.text, fontSize: 12.5, lineHeight: 17, textAlign: 'center' }}>{m.body}</Text>
                </View>
              </Fragment>
            );
          if (m.kind === 'poll')
            return (
              <Fragment key={m.id}>
                {day}
                <PollCard m={m} amHost={amHost} busy={plan.busy} onVote={(v) => vote(m.poll!.id, v)} onClose={(adopt) => void closePoll(m.poll!.id, adopt)} />
              </Fragment>
            );
          return (
            <Fragment key={m.id}>
              {day}
              <Pressable
                accessibilityLabel={`${mine ? 'You' : m.sender.displayName}: ${m.body}, ${hhmm(m.createdAt)}`}
                accessibilityHint={mine ? undefined : 'Press and hold for report and block options'}
                accessibilityActions={mine ? undefined : [{ name: 'more', label: 'Report or block' }]}
                onAccessibilityAction={() => setPicked(m)}
                onLongPress={mine ? undefined : () => setPicked(m)}
                delayLongPress={350}
                style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '78%', backgroundColor: mine ? c.forest : c.surface, borderWidth: mine ? 0 : 1, borderColor: c.line, borderRadius: 14, borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4, paddingHorizontal: 10, paddingVertical: 5, marginTop: showName || newDay ? 5 : 0 }}
              >
                {showName && (
                  <Pressable accessibilityRole="link" accessibilityLabel={`View ${m.sender.displayName}'s profile`} onPress={() => go(`/user/${m.sender.id}`)} hitSlop={6}>
                    <Text style={{ color: c.green, fontWeight: '800', fontSize: 11.5, marginBottom: 1 }}>{m.sender.displayName}</Text>
                  </Pressable>
                )}
                {/* the time sits small at the end of the last line, like a message in any chat app */}
                <Text style={{ color: mine ? '#fff' : c.text, fontSize: 14, lineHeight: 19 }}>
                  <Linkified text={m.body} linkColor={mine ? '#BFE6D4' : c.green} />
                  <Text style={{ color: mine ? '#B9CFC8' : c.muted, fontSize: 10 }}>{'\u00A0\u00A0'}{hhmm(m.createdAt)}</Text>
                </Text>
              </Pressable>
            </Fragment>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 16 }}>
        <ErrorBanner message={send.error ?? safety.error ?? plan.error ?? (msgs.error && !locked ? msgs.error.message : null)} />
      </View>
      {msgs.data && !msgs.data.writable ? (
        <View style={{ padding: 16, paddingBottom: bottomGap + 16 }}>
          <Banner>{closedText}</Banner>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 }}>
          {amHost && conv?.scope === 'trip' ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Add a date poll" onPress={() => setAdding('poll')} style={({ pressed }) => [{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="add" size={22} color={c.forest} />
            </Pressable>
          ) : null}
          <TextInput
            accessibilityLabel="Write a message"
            value={text}
            onChangeText={setText}
            placeholder="Write a message…"
            placeholderTextColor={c.placeholder}
            maxLength={2000}
            multiline
            numberOfLines={1}
            style={{ flex: 1, minHeight: 40, maxHeight: 110, borderWidth: 1, borderColor: c.line, borderRadius: 20, backgroundColor: c.surface, color: c.text, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !text.trim() || send.busy }}
            disabled={!text.trim() || send.busy}
            onPress={submit}
            style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || send.busy ? 0.45 : 1 }}
          >
            <Ionicons name="paper-plane-outline" size={18} color="#fff" />
          </Pressable>
        </View>
      )}
      {/* quiet footer: where the safety tools live */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: bottomGap + 6 }}>
        <Text style={{ color: c.muted, fontSize: 12 }}>Hold a message to report or block</Text>
        <Pressable accessibilityRole="button" onPress={() => go('/safety')} hitSlop={8}>
          <Text style={{ color: c.green, fontWeight: '800', fontSize: 14 }}>Safety →</Text>
        </Pressable>
      </View>
      <ReportSheet target={reportMsg ? { type: 'message', id: reportMsg.id, category: reportMsg.category } : null} onClose={() => setReportMsg(null)} />
      <Sheet visible={adding === 'poll'} title="Date poll" onClose={() => setAdding(null)}>
        <Field label="Question" placeholder="Can everyone travel on these dates?" value={pollTitle} onChangeText={setPollTitle} maxLength={120} />
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <DateField label="From (optional)" placeholder="YYYY-MM-DD" value={pollFrom} onChangeText={setPollFrom} error={pollErr} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="To (optional)" placeholder="YYYY-MM-DD" value={pollTo} onChangeText={setPollTo} />
          </View>
        </View>
        <Txt variant="small">With dates, you can turn the result into the trip's final dates. Members then confirm them one by one.</Txt>
        <ErrorBanner message={plan.error} />
        <Btn title="Post poll" onPress={createPoll} loading={plan.busy} disabled={pollTitle.trim().length < 3 || !!pollErr} />
      </Sheet>
      <Sheet visible={!!picked} title={picked ? `Message from ${picked.sender.displayName}` : ''} onClose={() => setPicked(null)}>
        <Txt variant="muted" numberOfLines={3}>{picked?.body}</Txt>
        <Btn title="View profile" variant="secondary" onPress={() => { const m = picked!; setPicked(null); go(`/user/${m.sender.id}`); }} />
        <Btn title="Report message" variant="secondary" onPress={() => { const m = picked!; setPicked(null); setReportMsg({ id: m.id }); }} />
        <Btn title="Report as spam" variant="secondary" onPress={() => { const m = picked!; setPicked(null); setReportMsg({ id: m.id, category: 'spam' }); }} />
        <Btn title={`Block ${picked?.sender.displayName ?? ''}`} variant="danger" onPress={() => { const m = picked!; setPicked(null); void block(m); }} />
      </Sheet>
    </Animated.View>
    </View>
    </>
  );
}
