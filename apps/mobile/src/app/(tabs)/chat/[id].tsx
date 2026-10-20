import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { Text, TextInput } from '@/components/ScaledText';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { CatPhoto } from '@/components/CatPhoto';
import { PageTransition } from '@/components/PageTransition';
import { Avatar, Banner, Btn, Empty, ErrorBanner, Screen, Sheet, Spinner, Txt, useGo } from '@/components/ui';
import { ApiError, get, post, type ConversationRef, type GroupInfo, type Notif } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { dayLabel, hhmm } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type Msg = { id: string; body: string; createdAt: string; sender: { id: string; displayName: string; photoUrl?: string | null } };

/**
 * Group chat for activities (HERE) and trips (THERE).
 * Access is decided by the server from live membership on every call, so removal or leaving cuts access at once.
 */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const { c } = useTheme();
  const router = useRouter();
  const go = useGo();
  const insets = useSafeAreaInsets();

  const convs = useLoad(() => get<{ items: ConversationRef[] }>('/v1/me/conversations'), [id]);
  const msgs = useLoad(() => get<{ writable: boolean; ended?: boolean; items: Msg[] }>(`/v1/conversations/${id}/messages`), [id], 3000);
  const [text, setText] = useState('');
  const info = useLoad(() => get<GroupInfo>(`/v1/conversations/${id}/info`), [id], 30_000);
  const [reportMsg, setReportMsg] = useState<{ id: string; category?: string } | null>(null);
  // press and hold a message: report it (or flag spam), see who wrote it, or block them
  const [picked, setPicked] = useState<Msg | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const send = useAction(() => void msgs.reload());
  const safety = useAction(() => void msgs.reload());
  const list = useRef<ScrollViewInstance>(null);
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

  // opening (or staying in) the chat clears its "new message" alert
  useEffect(() => {
    if (locked || !msgs.data) return;
    get<{ items: Notif[] }>('/v1/notifications?unread=true')
      .then((n) => Promise.all(n.items.filter((x) => x.type === 'chat_message' && x.data?.conversationId === id).map((x) => post(`/v1/notifications/${x.id}/read`))))
      .catch(() => {});
  }, [id, count, locked, !!msgs.data]);

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
      : 'This conversation is closed. The activity or trip was cancelled.';

  return (
    // on tablets and desktops the conversation is a centred, readable column rather than edge to edge
    <PageTransition>
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.bg }}>
    <KeyboardAvoidingView style={{ flex: 1, width: '100%', maxWidth: 760, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <Stack.Screen
        options={{
          title: conv?.title ?? 'Group chat',
          headerTitleAlign: 'left',
          headerTitle: () => (
            <Pressable accessibilityRole="button" accessibilityLabel={`${conv?.title ?? 'Group'}. Open group info`} onPress={() => go(`/group/${id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {info.data?.category ? <CatPhoto category={info.data.category} style={{ width: 38, height: 38, borderRadius: 19 }} /> : <Avatar name={conv?.title} size={38} />}
              <View>
                <Text numberOfLines={1} style={{ color: c.text, fontWeight: '800', fontSize: 16, maxWidth: 200 }}>{conv?.title ?? 'Group chat'}</Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{info.data ? `${info.data.members.length} ${info.data.members.length === 1 ? 'person' : 'people'} · tap for group info` : conv?.scope === 'trip' ? 'Trip group' : 'Activity group'}</Text>
              </View>
            </Pressable>
          ),
          headerRight: () => <Menu items={menu} />,
        }}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: c.sand, borderRadius: 14, padding: 12 }}>
          <Ionicons name="lock-closed-outline" size={18} color={c.forest} />
          <Text style={{ flex: 1, color: c.text, fontSize: 13, lineHeight: 18 }}>Only approved members can see this chat. Meet at public venues, and report anything that feels wrong.</Text>
        </View>
        {note ? <View style={{ marginTop: 8 }}><Banner tone="ok">{note}</Banner></View> : null}
      </View>

      <ScrollView ref={list} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 3 }} onScroll={onScroll} scrollEventThrottle={100} onContentSizeChange={() => {
          if (!stick.current) return;
          // the first load jumps to the latest message; later ones glide
          list.current?.scrollToEnd({ animated: loaded.current });
          if (msgs.data) loaded.current = true;
        }} keyboardShouldPersistTaps="handled">
        {msgs.loading && !msgs.data && <Spinner />}
        {msgs.data?.items.length === 0 && <Txt variant="muted" style={{ textAlign: 'center' }}>No messages yet. Say hi 👋</Txt>}
        {msgs.data?.items.map((m, i, all) => {
          const mine = m.sender.id === me?.id;
          const newDay = i === 0 || dayLabel(all[i - 1].createdAt) !== dayLabel(m.createdAt);
          // in a run of messages from one person the name shows once, on the first
          const showName = !mine && (newDay || all[i - 1].sender.id !== m.sender.id);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <View style={{ alignSelf: 'center', backgroundColor: c.infoBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, marginVertical: 8 }}>
                  <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>{dayLabel(m.createdAt)}</Text>
                </View>
              )}
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
                  {m.body}
                  <Text style={{ color: mine ? '#B9CFC8' : c.muted, fontSize: 10 }}>{'\u00A0\u00A0'}{hhmm(m.createdAt)}</Text>
                </Text>
              </Pressable>
            </Fragment>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 16 }}>
        <ErrorBanner message={send.error ?? safety.error ?? (msgs.error && !locked ? msgs.error.message : null)} />
      </View>
      {msgs.data && !msgs.data.writable ? (
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16 }}>
          <Banner>{closedText}</Banner>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 }}>
          <TextInput
            accessibilityLabel="Write a message"
            value={text}
            onChangeText={setText}
            placeholder="Write a message…"
            placeholderTextColor={c.muted}
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: insets.bottom + 6 }}>
        <Text style={{ color: c.muted, fontSize: 12 }}>Hold a message to report or block</Text>
        <Pressable accessibilityRole="button" onPress={() => go('/safety')} hitSlop={8}>
          <Text style={{ color: c.green, fontWeight: '800', fontSize: 14 }}>Safety →</Text>
        </Pressable>
      </View>
      <ReportSheet target={reportMsg ? { type: 'message', id: reportMsg.id, category: reportMsg.category } : null} onClose={() => setReportMsg(null)} />
      <Sheet visible={!!picked} title={picked ? `Message from ${picked.sender.displayName}` : ''} onClose={() => setPicked(null)}>
        <Txt variant="muted" numberOfLines={3}>{picked?.body}</Txt>
        <Btn title="View profile" variant="secondary" onPress={() => { const m = picked!; setPicked(null); go(`/user/${m.sender.id}`); }} />
        <Btn title="Report message" variant="secondary" onPress={() => { const m = picked!; setPicked(null); setReportMsg({ id: m.id }); }} />
        <Btn title="Report as spam" variant="secondary" onPress={() => { const m = picked!; setPicked(null); setReportMsg({ id: m.id, category: 'spam' }); }} />
        <Btn title={`Block ${picked?.sender.displayName ?? ''}`} variant="danger" onPress={() => { const m = picked!; setPicked(null); void block(m); }} />
      </Sheet>
    </KeyboardAvoidingView>
    </View>
    </PageTransition>
  );
}
