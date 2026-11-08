import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useIsFocused, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Keyboard, Linking, Platform, Pressable, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Text, TextInput } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { CatPhoto } from '@/components/CatPhoto';
import { SkeletonChat } from '@/components/Skeleton';
import { Appear, setInView } from '@/components/Pop';
import { MonthCalendar } from '@/components/CreateParts';
import { lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { Avatar, Banner, Btn, Empty, ErrorBanner, Field, Screen, Sheet, Txt, useGo } from '@/components/ui';
import { ApiError, get, post, type ConversationRef, type GroupInfo, type Notif, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, dayLabel, hhmm, isoDay, parseDay } from '@/lib/format';
import { useKeyboardOverlap, useKeyboardShown, keyboardTaps } from '@/lib/keyboard';
import { cursorDeps, patchCache, useAction, useLoad } from '@/lib/hooks';
import { BackArrow } from '@/components/TabHeader';
import { statusTop } from '@/lib/layout';
import { clearOpenChat, setOpenChat, useLiveEvents } from '@/lib/live';
import { refreshUnread } from '@/lib/unread';
import { t, useT } from '@/lib/i18n';
import { useEnterMode, useTheme } from '@/lib/theme';

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
  const { t } = useT();
  const { c } = useTheme();
  const p = m.poll;
  if (!p) return null;
  const open = p.state === 'open';
  const choice = (v: 'accept' | 'reject', label: string, icon: React.ComponentProps<typeof Ionicons>['name']) => {
    const on = p.myVote === v;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('{label}. {n} so far', { label, n: v === 'accept' ? p.accept : p.reject })}
        accessibilityState={{ selected: on, disabled: !open || busy }}
        disabled={!open || busy}
        onPress={() => onVote(v)}
        hitSlop={{ top: 3, bottom: 3 }}
        style={({ pressed }) => [{ flex: 1, height: 38, borderRadius: 999, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: open ? 1 : 0.6 }, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name={icon} size={16} color={on ? '#fff' : c.text} />
        <Text numberOfLines={1} style={{ flexShrink: 1, color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 13, includeFontPadding: false }}>{label} · {v === 'accept' ? p.accept : p.reject}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ alignSelf: 'center', width: '92%', backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 16, padding: 12, gap: 10, marginVertical: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="calendar-outline" size={16} color={c.green} />
        <Text style={{ color: c.green, fontWeight: '800', fontSize: 11, letterSpacing: 0.6 }}>{open ? t('DATE POLL · OPEN') : p.state === 'adopted' ? t('DATE POLL · DATES CHOSEN') : t('DATE POLL · CLOSED')}</Text>
      </View>
      <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, lineHeight: 20 }}>{p.title}</Text>
      {p.dateStart && p.dateEnd ? (
        <View style={{ alignSelf: 'flex-start', backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: c.forest, fontWeight: '700', fontSize: 12 }}>{dateSpan(p.dateStart, p.dateEnd)}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {choice('accept', t('Accept'), 'checkmark')}
        {choice('reject', t('Reject'), 'close')}
      </View>
      {amHost && open ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {p.dateStart && p.dateEnd ? <Btn title={t('Use these dates')} small onPress={() => onClose(true)} loading={busy} style={{ flex: 1 }} /> : null}
          <Btn title={t('Close poll')} small variant="secondary" onPress={() => onClose(false)} loading={busy} style={{ flex: 1 }} />
        </View>
      ) : null}
    </View>
  );
}

/** Opens an outside address, after a safety notice. */
async function openLink(url: string) {
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  if (await confirmAsync(t('Leave HERE & THERE?'), t("This opens {site} in your browser. We don't check outside websites. Never send money, deposits or ID documents to anyone you met through the app, and book travel only with suppliers you trust.", { site: hostOf(full) }), t('Open link'))) void Linking.openURL(full);
}

/** A message's text, with any web address in it pressable (it shows the safety notice before it opens). */
function Linkified({ text, linkColor }: { text: string; linkColor: string }) {
  const { t } = useT();
  const parts = text.split(/((?:https?:\/\/|www\.)[^\s]+)/gi);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} accessibilityRole="link" accessibilityHint={t('Opens a safety notice first')} onPress={() => void openLink(part)} style={{ color: linkColor, textDecorationLine: 'underline', fontWeight: '700' }}>
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

/**
 * One message bubble. Typing in the box redraws the whole chat screen on every key, so the bubbles are drawn again only when
 * their own message (or how it is shown) changed.
 */
const Bubble = memo(
  function Bubble({ m, mine, showName, newDay, onPick }: { m: Msg; mine: boolean; showName: boolean; newDay: boolean; onPick: (m: Msg) => void }) {
    const { t } = useT();
    const { c, mode } = useTheme();
    const go = useGo();
    return (
      <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', marginTop: showName || newDay ? 8 : 0, gap: 6 }}>
        {/* who wrote it: face and name above the bubble, once per run of messages (tap for their profile) */}
        {showName && (
          <Pressable accessibilityRole="link" accessibilityLabel={t("View {name}'s profile", { name: m.sender.displayName })} onPress={() => go(`/user/${m.sender.id}`)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
            <Avatar name={m.sender.displayName} uri={m.sender.photoUrl} size={34} />
            <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontWeight: '500', fontSize: 16, lineHeight: 21 }}>{m.sender.displayName}</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityLabel={`${mine ? t('You') : m.sender.displayName}: ${m.body}, ${hhmm(m.createdAt)}`}
          accessibilityHint={mine ? undefined : t('Press and hold for report and block options')}
          accessibilityActions={mine ? undefined : [{ name: 'more', label: t('Report or block') }]}
          onAccessibilityAction={() => onPick(m)}
          onLongPress={mine ? undefined : () => onPick(m)}
          delayLongPress={350}
          style={{ alignSelf: mine ? 'flex-end' : 'flex-start', marginLeft: mine || !showName ? 0 : 0, backgroundColor: mine ? c.forest : c.surface, borderWidth: mine || mode === 'there' ? 0 : 1, borderColor: c.line, borderRadius: 24, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, ...(Platform.OS === 'android' ? null : { shadowColor: '#000', shadowOpacity: mine ? 0 : 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: mine ? 0 : 1 }) }}
        >
          <Text selectable={mine} style={{ color: mine ? '#fff' : c.text, fontSize: 15, lineHeight: 23 }}>
            <Linkified text={m.body} linkColor={mine ? '#BFE6D4' : c.green} />
          </Text>
          {/* a message with a web address carries its own caution, before anyone taps it */}
          {/(?:https?:\/\/|www\.)/i.test(m.body) ? (
            <Text style={{ color: mine ? '#B9CFC8' : c.warnFg, fontSize: 11, lineHeight: 15, marginTop: 4 }}>{t('Opens outside the app. We do not check it. Never send money or ID documents.')}</Text>
          ) : null}
          <Text style={{ alignSelf: 'flex-end', color: mine ? '#B9CFC8' : c.muted, fontSize: 12, lineHeight: 16, marginTop: 2 }}>{hhmm(m.createdAt)}</Text>
        </Pressable>
      </View>
    );
  },
  (a, b) => a.m.id === b.m.id && a.m.body === b.m.body && a.mine === b.mine && a.showName === b.showName && a.newDay === b.newDay,
);

/** The small gap between two messages. */
const RowGap = () => <View style={{ height: 6 }} />;

function Chat({ id }: { id: string }) {
  const { t, tn } = useT();
  const { me } = useMe();
  const { c, mode } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();

  // Only a chat that is the screen in front counts as read. This screen stays loaded behind others, and a reload there
  // (the app opening, a message arriving) must not clear the alert.
  const focused = useIsFocused();
  const inFront = useRef(focused);
  inFront.current = focused;
  const msgs = useLoad(() => get<{ writable: boolean; ended?: boolean; items: Msg[]; nextCursor?: string | null }>(`/v1/conversations/${id}/messages${inFront.current ? '?read=1' : ''}`), [id], 30_000, 'chat:msgs', { animate: true, live: true });
  // a new message for this chat (or a reconnect) loads at once; the 30-second poll above is only the safety net
  // while this chat is the screen in front, the server knows: a message to it then needs no alert and no push for this person
  useEffect(() => {
    if (!focused) return;
    setOpenChat(id);
    return () => clearOpenChat(id);
  }, [focused, id]);
  useLiveEvents((e) => {
    if (!inFront.current) return; // not on screen: it loads when you open it
    if (e.type === 'message' && e.conversationId === id) {
      const m = e.message;
      if ((m.kind ?? 'text') === 'text' && msgs.data) {
        // a plain message already holds everything the screen needs: put it in its place, no fetch at all
        patchCache<NonNullable<typeof msgs.data>>('chat:msgs', [id], (old) =>
          old.items.some((x) => x.id === m.id) ? old : { ...old, items: [...old.items, m as Msg].sort((a, b) => (a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id) ? -1 : 1)) },
        );
      } else void msgs.reload(); // a poll, a notice, or nothing on screen yet
      return;
    }
    if (e.type === 'ready') void msgs.reload();
    if (e.type === 'group-changed' && e.kind === 'trip' && e.id === groupScope.current?.id) void msgs.reload(); // a poll was answered or closed
  });
  // opening the chat reads its alert on the server: ask for the new badge number once. Messages that arrive while it is open
  // make no alert (the server knows the chat is open), so there is nothing more to ask for.
  const opened = (msgs.data?.items.length ?? -1) >= 0;
  useEffect(() => {
    if (opened) refreshUnread();
  }, [opened, id]);
  // ---- earlier messages: the screen opens on the newest ones, and scrolling up near the top loads the page before them,
  // as in any chat app. What has been loaded stays; the screen keeps its place while the older ones are added above.
  const [older, setOlder] = useState<Msg[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined); // undefined: not known yet; null: no more
  const [loadingOlder, setLoadingOlder] = useState(false);
  const busyOlder = useRef(false);
  const newestPage = useRef<Msg[]>([]);
  const before = (a: Msg, b: Msg) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id);
  const inOrder = (rows: Msg[]) => [...new Map(rows.map((m) => [m.id, m])).values()].sort((a, b) => (before(a, b) ? -1 : 1));
  useEffect(() => {
    setOlder([]);
    setOlderCursor(undefined);
    newestPage.current = [];
  }, [id]);
  useEffect(() => {
    const cur = msgs.data?.items;
    if (!msgs.data || !cur) return;
    if (olderCursor === undefined) setOlderCursor(msgs.data.nextCursor ?? null);
    if (!cur.length) {
      newestPage.current = cur;
      return;
    }
    // the newest page is the truth for its own time span (a message staff removed is gone from it); messages that slid out of
    // it as new ones arrived join the earlier ones, so nothing already read disappears
    const start = cur[0];
    const have = new Set(cur.map((m) => m.id));
    const slid = newestPage.current.filter((m) => !have.has(m.id) && before(m, start));
    newestPage.current = cur;
    setOlder((prev) => {
      const kept = prev.filter((m) => before(m, start));
      return kept.length === prev.length && !slid.length ? prev : inOrder([...kept, ...slid]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.data]);
  const loadOlder = async () => {
    if (!olderCursor || busyOlder.current) return;
    busyOlder.current = true;
    setLoadingOlder(true);
    try {
      const r = await get<{ items: Msg[]; nextCursor: string | null }>(`/v1/conversations/${id}/messages?limit=30&cursor=${encodeURIComponent(olderCursor)}`);
      setOlder((prev) => inOrder([...r.items, ...prev]));
      setOlderCursor(r.nextCursor);
    } catch {
      // the next time the top is reached it asks again
    } finally {
      busyOlder.current = false;
      setLoadingOlder(false);
    }
  };
  // The screen paints first (its top row and a placeholder) and the bubbles follow a moment later: drawing a few dozen bubbles at
  // once, in the same breath as opening the screen, is what made it feel slow to open on Android.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setSettled(true), 60); // after the screen's first paint
    return () => clearTimeout(h);
  }, []);
  const shown = settled ? [...older, ...(msgs.data?.items ?? [])] : [];

  const [text, setText] = useState('');
  const typing = useKeyboardShown();
  const bottomGap = typing ? 0 : Math.max(insets.bottom, 10); // no dock here: the chat fills the screen, down to the home bar
  const { inset: keyboard, box: chatBox, onLayout: chatLayout } = useKeyboardOverlap();
  // leaving by the swipe-back (or the arrow): the keyboard goes down while the screen goes sideways
  const navigation = useNavigation();
  useEffect(() => navigation.addListener('transitionStart' as never, ((e: { data?: { closing?: boolean } }) => e?.data?.closing && Keyboard.dismiss()) as never), [navigation]); // the chat ends at the bottom edge, so the keyboard simply pushes it up by its own height
  // members, dates or place of this group changed: the details load at once; the poll is only a rare safety net while the live connection is up
  const info = useLoad(() => get<GroupInfo>(`/v1/conversations/${id}/info`), [id], 30_000, 'chat:info', { animate: true, live: true });
  const groupScope = useRef<{ kind: 'activity' | 'trip'; id: string } | null>(null);
  groupScope.current = info.data && (info.data.scope === 'activity' || info.data.scope === 'trip') ? { kind: info.data.scope, id: info.data.scopeId } : null;
  useLiveEvents((e) => {
    if (e.type === 'ready' || (e.type === 'group-changed' && e.kind === groupScope.current?.kind && e.id === groupScope.current?.id)) void info.reload();
  });
  useEnterMode(info.data ? (info.data.scope === 'activity' ? 'here' : 'there') : undefined); // an activity group is HERE; trip groups and travel matches are THERE
  const [reportMsg, setReportMsg] = useState<{ id: string; category?: string } | null>(null);
  // press and hold a message: report it (or flag spam), see who wrote it, or block them
  const [picked, setPicked] = useState<Msg | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const send = useAction(() => void msgs.reload());
  // a refusal (a risky link, a request for money) goes away by itself after a few seconds
  useEffect(() => {
    if (!send.error) return;
    const timer = setTimeout(() => send.setError(null), 6000);
    return () => clearTimeout(timer);
  }, [send.error]);
  // THERE: the trip itself, for the final-dates confirmation under the chat's title
  const tripId = info.data?.scope === 'trip' ? info.data.scopeId : undefined;
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
  // the dates are picked on a calendar: From first (from tomorrow on), then To (not before From)
  const [pollPick, setPollPick] = useState<null | 'from' | 'to'>(null);
  const tomorrow = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1);
  const [pollMonth, setPollMonth] = useState(tomorrow);
  const openPick = (k: 'from' | 'to') => {
    if (pollPick === k) return setPollPick(null);
    Keyboard.dismiss();
    setPollPick(k);
    setPollMonth((k === 'to' ? pTo ?? pFrom : pFrom) ?? tomorrow);
  };
  const pickDay = (d: Date) => {
    if (pollPick === 'to') {
      setPollTo(isoDay(d));
      setPollPick(null);
    } else {
      setPollFrom(isoDay(d));
      if (pTo && pTo < d) setPollTo(''); // a To before the new From no longer fits
      setPollPick('to'); // next: until when
      setPollMonth(d);
    }
  };
  const pollErr = null as string | null;
  const createPoll = async () => {
    const r = await plan.run(() => post(`/v1/conversations/${id}/polls`, { title: pollTitle.trim(), ...(pFrom && { dateStart: pFrom.toISOString(), dateEnd: (pTo ?? pFrom).toISOString() }) }));
    if (r) {
      stick.current = true;
      setAdding(null);
      setPollTitle('');
      setPollFrom('');
      setPollTo('');
      setPollPick(null);
    }
  };
  const vote = (pollId: string, v: 'accept' | 'reject') => void plan.run(() => post(`/v1/polls/${pollId}/vote`, { vote: v }));
  const closePoll = async (pollId: string, adopt: boolean) => {
    if (adopt && !(await confirmAsync(t('Use these dates?'), t("The trip's dates change right away, for everyone, and every member is told."), t('Use dates')))) return;
    void plan.run(() => post(`/v1/polls/${pollId}/close`, { adopt }));
  };
  const confirmDates = () => tripId && void plan.run(() => post(`/v1/trips/${tripId}/confirm-dates`));
  const safety = useAction(() => void msgs.reload());
  const list = useRef<FlatList<Msg>>(null);
  // the rows on screen, so earlier messages fade in as the reader reaches them
  const onViewable = useRef(({ viewableItems }: { viewableItems: { key: string }[] }) => setInView(viewableItems.map((v) => v.key))).current;
  const viewability = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const stick = useRef(true);
  const loaded = useRef(false);

  const conv = info.data ?? undefined; // the chat's own details (title, whether it is a trip or an activity, and which)
  const count = msgs.data?.items.length ?? 0;
  const locked = msgs.error instanceof ApiError && msgs.error.code === 'NOT_A_MEMBER';

  // follow new messages only while the reader is already at the bottom
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    stick.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
    // a few screens before the top (and not while the screen is still settling on its first load): load the earlier messages,
    // so they are already there by the time the reader scrolls up to them
    if (loaded.current && contentOffset.y < 900) void loadOlder();
  };

  // The server marks this chat's alert read when its messages are fetched in front, so nothing is asked again here. What
  // this screen does instead is keep the inbox right while it is out of sight: this chat's newest message (yours too) and
  // the fact that it has been read, so on coming back the list is already in its final order with nothing left to catch up.
  const newest = msgs.data?.items[msgs.data.items.length - 1];
  useEffect(() => {
    if (!newest) return;
    const product = info.data ? (info.data.scope === 'activity' ? 'here' : 'there') : mode; // the inbox list this chat is on
    patchCache<{ items: ConversationRef[] }>('inbox:convs', cursorDeps('/v1/me/conversations', { product }), (old) => ({
      ...old,
      items: old.items.map((cv) => (cv.conversationId === id ? { ...cv, lastMessage: { body: newest.body.slice(0, 140), at: newest.createdAt, from: newest.sender.id === me?.id ? 'You' : newest.sender.displayName } } : cv)),
    }));
    if (inFront.current)
      patchCache<{ items: Notif[]; unreadCount: number }>('inbox:notifs', [product], (old) => {
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
    if (await confirmAsync(conv.scope === 'trip' ? t('Leave this group and the trip?') : t('Leave this group and the activity?'), conv.scope === 'trip' ? t('Leaving the group also takes you out of the trip.') : t('Leaving the group also takes you out of the activity.'), t('Leave'), true)) {
      const r = await send.run(() => post(conv.scope === 'trip' ? `/v1/trips/${conv.scopeId}/leave` : `/v1/activities/${conv.scopeId}/leave`));
      if (r) router.back();
    }
  };

  const block = async (m: Msg) => {
    if (await confirmAsync(t('Block {name}?', { name: m.sender.displayName }), t("Their messages will be hidden from you and they can't contact you, in HERE or THERE."), t('Block'), true)) {
      const r = await safety.run(() => post('/v1/blocks', { userId: m.sender.id }));
      if (r) setNote(t('You blocked {name}. Their messages are hidden, and you can unblock them in Settings > Reports & blocked.', { name: m.sender.displayName }));
    }
  };

  // chatting is for verified adults only
  const needsVerify = msgs.error instanceof ApiError && (msgs.error.code === 'VERIFICATION_REQUIRED' || msgs.error.code === 'ADULT_REQUIRED');
  if (needsVerify)
    return (
      <Screen hasHeader>
        <Empty title={t('Verify to chat')} />
        <Btn title={t('Get verified')} onPress={() => go('/verify')} />
      </Screen>
    );

  // the host cancelled: the chat is terminated with the activity
  if (msgs.data?.ended && conv?.scope === 'match')
    return (
      <Screen hasHeader>
        <Empty title={t('This chat has ended')} />
        <Btn title={t('Back')} variant="secondary" onPress={() => router.back()} />
      </Screen>
    );
  if (msgs.data?.ended)
    return (
      <Screen hasHeader>
        <Empty title={t('This chat has ended')} />
        {conv ? <Btn title={conv.scope === 'trip' ? t('View trip') : t('View activity')} variant="secondary" onPress={() => go(conv.scope === 'trip' ? `/trip/${conv.scopeId}` : `/activity/${conv.scopeId}`)} /> : null}
      </Screen>
    );

  if (locked)
    return (
      <Screen hasHeader>
        <Empty title={t('Chat is for approved members')} />
      </Screen>
    );

  const amHost = !!info.data?.members.find((m) => m.isMe && m.role === 'host');
  const them = info.data?.members.find((m) => !m.isMe);
  const endMatch = async () => {
    if (await confirmAsync(t('End this chat?'), t('It closes for both of you and cannot be reopened.'), t('End chat'), true)) {
      const r = await send.run(() => post(`/v1/me/travel-match/chats/${id}/end`));
      if (r) router.back();
    }
  };
  const menu = conv?.scope === 'match' ? [
    ...(them ? [{ label: t('View profile'), onSelect: () => go(`/user/${them.id}`) }] : []),
    { label: t('Safety tools'), onSelect: () => go('/safety') },
    { label: t('End chat'), danger: true, onSelect: () => void endMatch() },
  ] : [
    { label: t('Group info'), onSelect: () => go(`/group/${id}`) },
    ...(conv ? [{ label: conv.scope === 'trip' ? t('View trip') : t('View activity'), onSelect: () => go(conv.scope === 'trip' ? `/trip/${conv.scopeId}` : `/activity/${conv.scopeId}`) }] : []),
    { label: t('Safety tools'), onSelect: () => go('/safety') },
    // hosts cannot leave their own group: they cancel the activity instead (see Group info)
    // nothing to leave once it is over (by its status or by the clock) or called off
    ...(amHost || (conv && (['completed', 'cancelled', 'archived'].includes(conv.status) || +new Date(conv.endsAt) < Date.now())) ? [] : [{ label: t('Leave group'), danger: true, onSelect: leave }]),
  ];
  const closedText =
    info.data?.status === 'archived'
      ? t('This chat is archived: read only.')
      : info.data?.status === 'completed'
        ? t('This activity has ended: read only.')
        : t('This conversation is closed.');

  return (
    // on tablets and desktops the conversation is a centred, readable column rather than edge to edge
    <>
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.bg }}>
    <Animated.View ref={chatBox} onLayout={chatLayout} style={{ flex: 1, width: '100%', maxWidth: 760, backgroundColor: c.bg, paddingBottom: keyboard }}>
      <Stack.Screen options={{ title: conv?.title ?? t('Group chat') }} />
      {/* the chat's own top row: back, who it is (tap for group info), and the menu; a line under it */}
      <View style={{ paddingTop: statusTop(insets.top) + 8, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', minHeight: 44 }}>
          <View style={{ width: 44, minHeight: 44, justifyContent: 'center' }}>
            <BackArrow />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('{title}. Open group info', { title: conv?.title ?? t('Group') })} onPress={() => (conv?.scope === 'match' && them ? go(`/user/${them.id}`) : go(`/group/${id}`))} style={{ flex: 1, alignItems: 'center', gap: 6, minHeight: 44, paddingTop: 4 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontWeight: '600', fontSize: 18, lineHeight: 24 }}>{conv?.title ?? t('Group chat')}</Text>
            {info.data && conv?.scope !== 'match' && info.data.members.length > 0 ? (
              <View accessibilityLabel={tn(info.data.members.length, '{n} person', '{n} people')} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {info.data.members.slice(0, 4).map((mb, k) => (
                  <View key={mb.id} style={{ marginLeft: k ? -10 : 0, borderRadius: 16, borderWidth: 2, borderColor: c.bg }}>
                    <Avatar name={mb.displayName} uri={mb.photoUrl} size={28} />
                  </View>
                ))}
                {info.data.members.length > 4 ? (
                  <View style={{ marginLeft: -10, minWidth: 32, height: 32, borderRadius: 16, paddingHorizontal: 6, backgroundColor: c.forest, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: '#fff', fontSize: 12, lineHeight: 16, fontWeight: '600', includeFontPadding: false }}>{info.data.members.length - 4}+</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{conv?.scope === 'match' ? `${t('Travel match')}${conv.place ? ` · ${conv.place}` : ''}` : conv?.scope === 'trip' ? t('Trip group') : t('Activity group')}</Text>
            )}
          </Pressable>
          <View style={{ width: 44, alignItems: 'flex-end' }}>
            <Menu popover items={menu} />
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: c.line, marginTop: 10 }} />
      </View>
      {/* pinned and slim: a note about the last action, and (only while someone still has to confirm) the final dates */}
      {note || (trip.data?.datesState === 'proposed' && trip.data.status !== 'completed' && trip.data.status !== 'cancelled' && (trip.data.datesConfirmedCount ?? 0) < trip.data.members) ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 6, gap: 6 }}>
          {note ? <Banner tone="ok">{note}</Banner> : null}
          {trip.data?.datesState === 'proposed' && trip.data.status !== 'completed' && trip.data.status !== 'cancelled' && (trip.data.datesConfirmedCount ?? 0) < trip.data.members ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: c.accentSoft, paddingLeft: 12, paddingRight: 4, paddingVertical: 4 }}>
              <Ionicons name="calendar-outline" size={14} color={c.forest} />
              <Text numberOfLines={2} style={{ flex: 1, color: c.text, fontSize: 12, lineHeight: 16 }}>
                <Text style={{ fontWeight: '800' }}>{t('Final dates {dates}', { dates: dateSpan(trip.data.dateStart, trip.data.dateEnd) })}</Text> · {t('{done} of {total} confirmed', { done: trip.data.datesConfirmedCount ?? 0, total: trip.data.members })}{trip.data.myDatesConfirmed ? ' ✓' : ''}
              </Text>
              {trip.data.isMember && !trip.data.myDatesConfirmed ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('Confirm you can travel on these dates')} disabled={plan.busy} onPress={confirmDates} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} style={({ pressed }) => [{ height: 28, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85 }]}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, includeFontPadding: false }}>{t('Confirm')}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* a recycling list: only the messages near the screen are drawn, so a chat with thousands of messages stays light. When earlier
          messages are added above, the list keeps the reader on the same message by itself (maintainVisibleContentPosition). */}
      <FlatList
        ref={list}
        data={shown}
        extraData={`${amHost}${plan.busy}${me?.id}`}
        keyExtractor={(m) => m.id}
        showsVerticalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps={keyboardTaps}
        // Android draws fewer bubbles at a time (it is slower at it); the list fills in as you scroll
        initialNumToRender={Platform.OS === 'android' ? 14 : 30}
        windowSize={Platform.OS === 'android' ? 7 : 11}
        maxToRenderPerBatch={Platform.OS === 'android' ? 8 : 12}
        removeClippedSubviews={Platform.OS === 'android'}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={viewability}
        ItemSeparatorComponent={RowGap}
        onContentSizeChange={() => {
          if (!stick.current) return;
          // the first load jumps to the latest message; later ones glide
          list.current?.scrollToEnd({ animated: loaded.current });
          // Android measures the last bubbles a moment later than this call, which left the newest one half hidden under the bottom edge: go to the end once more when they have their final size
          if (!loaded.current) setTimeout(() => stick.current && list.current?.scrollToEnd({ animated: false }), 80);
          if (msgs.data) loaded.current = true;
        }}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: c.sand, borderRadius: 14, padding: 10, marginBottom: 6 }}>
              <Ionicons name="lock-closed-outline" size={16} color={c.forest} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, color: c.text, fontSize: 12.5, lineHeight: 17 }}>{t('Only approved members can see this chat. Meet at public venues, and report anything that feels wrong. Hold a message to report or block.')}</Text>
            </View>
            {/* The top of the history. While there are earlier messages it is a fixed-height area: grey message shapes while they load,
                empty otherwise, so it never changes size and nothing moves when loading starts. At the very first message it becomes a line. */}
            {olderCursor ? (
              <View style={{ height: 164, overflow: 'hidden' }}>{loadingOlder ? <SkeletonChat compact /> : null}</View>
            ) : older.length > 0 && olderCursor === null ? (
              <View style={{ height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: c.muted, fontSize: 11 }}>{t('Start of the conversation')}</Text>
              </View>
            ) : null}
            {((msgs.loading && !msgs.data) || !settled) && <SkeletonChat />}
            {msgs.data?.items.length === 0 && <Txt variant="muted" style={{ textAlign: 'center' }}>{t('No messages yet. Say hi 👋')}</Txt>}
          </View>
        }
        renderItem={({ item: m, index: i }) => {
          const earlierBatch = i < older.length; // loaded above the newest page: it fades in when scrolled to
          const mine = m.sender.id === me?.id;
          const newDay = i === 0 || dayLabel(shown[i - 1].createdAt) !== dayLabel(m.createdAt);
          // in a run of messages from one person the name shows once, on the first
          const showName = !mine && (newDay || shown[i - 1].sender.id !== m.sender.id);
          const day = newDay ? (
            <View style={{ alignSelf: 'center', backgroundColor: c.infoBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, marginVertical: 8 }}>
              <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>{dayLabel(m.createdAt)}</Text>
            </View>
          ) : null;
          if (m.kind === 'system')
            return (
              <Appear id={m.id} animate={loaded.current} gate={earlierBatch} style={{ gap: 3 }}>
                {day}
                <View style={{ alignSelf: 'center', maxWidth: '88%', backgroundColor: c.accentSoft, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, marginVertical: 4 }}>
                  <Text style={{ color: c.text, fontSize: 12.5, lineHeight: 17, textAlign: 'center' }}>{m.body}</Text>
                </View>
              </Appear>
            );
          if (m.kind === 'poll')
            return (
              <Appear id={m.id} animate={loaded.current} gate={earlierBatch} style={{ gap: 3 }}>
                {day}
                <PollCard m={m} amHost={amHost} busy={plan.busy} onVote={(v) => vote(m.poll!.id, v)} onClose={(adopt) => void closePoll(m.poll!.id, adopt)} />
              </Appear>
            );
          return (
            <Appear id={m.id} animate={loaded.current} gate={earlierBatch} style={{ gap: 3 }}>
              {day}
              <Bubble m={m} mine={mine} showName={showName} newDay={newDay} onPick={setPicked} />
            </Appear>
          );
        }}
      />

      <View style={{ paddingHorizontal: 16 }}>
        <ErrorBanner message={send.error ?? safety.error ?? plan.error ?? (msgs.error && !locked ? msgs.error.message : null)} />
      </View>
      {msgs.data && !msgs.data.writable ? (
        <View style={{ padding: 16, paddingBottom: bottomGap + 16 }}>
          <Banner>{closedText}</Banner>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 6, paddingBottom: bottomGap + 8 }}>
          {amHost && conv?.scope === 'trip' ? (
            <Pressable accessibilityRole="button" accessibilityLabel={t('Add a date poll')} hitSlop={4} onPress={() => setAdding('poll')} style={({ pressed }) => [{ width: 44, height: 44, marginBottom: 4, borderRadius: 22, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8 }]}>
              <Ionicons name="add" size={22} color={c.forest} />
            </Pressable>
          ) : null}
          <TextInput
            accessibilityLabel={t('Write a message')}
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (send.error) send.setError(null); // the refusal was about the old text
            }}
            placeholder={t('Say something to the group…')}
            placeholderTextColor={c.placeholder}
            maxLength={2000}
            multiline
            numberOfLines={1}
            style={{ flex: 1, minHeight: 52, maxHeight: 120, borderWidth: mode === 'there' ? 0 : 1, borderColor: c.line, borderRadius: 28, backgroundColor: c.surface, color: c.text, paddingHorizontal: 22, paddingVertical: 14, textAlignVertical: 'center', fontSize: mode === 'there' ? 15 : 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 1 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('Send message')}
            accessibilityState={{ disabled: !text.trim() || send.busy }}
            disabled={!text.trim() || send.busy}
            onPress={submit}
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || send.busy ? 0.45 : 1 }}
          >
            {/* the paper plane's weight sits to the left, so it is nudged to look centred in the circle */}
            <Ionicons name="send" size={20} color="#fff" style={{ marginLeft: 3, marginBottom: 1 }} />
          </Pressable>
        </View>
      )}
      <ReportSheet target={reportMsg ? { type: 'message', id: reportMsg.id, category: reportMsg.category } : null} onClose={() => setReportMsg(null)} />
      <Sheet visible={adding === 'poll'} title={t('Date poll')} onClose={() => { setAdding(null); setPollPick(null); }}>
        <Field label={t('Question')} placeholder={t('Can everyone travel on these dates?')} value={pollTitle} onChangeText={setPollTitle} maxLength={120} />
        {/* the dates are picked on a calendar (both optional): tap From or To */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {([['from', t('From (optional)'), pFrom, false], ['to', t('To (optional)'), pTo, !pFrom]] as const).map(([k, label, d, locked]) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${d ? shortDay(d) : t('not chosen')}`}
              accessibilityState={{ disabled: locked, selected: pollPick === k }}
              disabled={locked}
              onPress={() => openPick(k)}
              style={{ flex: 1, minHeight: 56, borderRadius: 16, borderWidth: 1.5, borderColor: pollPick === k ? c.forest : c.line, backgroundColor: c.surface, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center', opacity: locked ? 0.5 : 1 }}
            >
              <Text style={{ color: c.muted, fontSize: 11 }}>{label}</Text>
              <Text style={{ color: c.text, fontSize: 15, fontWeight: '700' }}>{d ? shortDay(d) : t('Select date')}</Text>
            </Pressable>
          ))}
        </View>
        {pollPick ? (
          <MonthCalendar month={pollMonth} onMonth={setPollMonth} selected={(pollPick === 'to' ? pTo : pFrom) ?? new Date(0)} min={pollPick === 'to' && pFrom ? pFrom : tomorrow} max={lastPlanningDay(12)} onPick={pickDay} />
        ) : null}
        {pFrom ? <Btn title={t('Clear the dates')} variant="ghost" small onPress={() => { setPollFrom(''); setPollTo(''); setPollPick(null); }} /> : null}
        <ErrorBanner message={plan.error} />
        <Btn title={t('Post poll')} onPress={createPoll} loading={plan.busy} disabled={pollTitle.trim().length < 3 || !!pollErr} />
      </Sheet>
      <Sheet visible={!!picked} title={picked ? t('Message from {name}', { name: picked.sender.displayName }) : ''} onClose={() => setPicked(null)}>
        <Txt variant="muted" numberOfLines={3}>{picked?.body}</Txt>
        <Btn title={t('View profile')} variant="secondary" onPress={() => { const m = picked!; setPicked(null); go(`/user/${m.sender.id}`); }} />
        <Btn title={t('Report message')} variant="secondary" onPress={() => { const m = picked!; setPicked(null); setReportMsg({ id: m.id }); }} />
        <Btn title={t('Report as spam')} variant="secondary" onPress={() => { const m = picked!; setPicked(null); setReportMsg({ id: m.id, category: 'spam' }); }} />
        <Btn title={t('Block {name}', { name: picked?.sender.displayName ?? '' })} variant="danger" onPress={() => { const m = picked!; setPicked(null); void block(m); }} />
      </Sheet>
    </Animated.View>
    </View>
    </>
  );
}
