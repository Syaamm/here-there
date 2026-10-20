import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Empty, ErrorBanner, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { ApiError, get, post, type ConversationRef, type Notif } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { dayLabel, hhmm } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type Msg = { id: string; body: string; createdAt: string; sender: { id: string; displayName: string } };

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
  const msgs = useLoad(() => get<{ writable: boolean; items: Msg[] }>(`/v1/conversations/${id}/messages`), [id], 3000);
  const [text, setText] = useState('');
  const [reportMsg, setReportMsg] = useState<string | null>(null);
  const send = useAction(() => void msgs.reload());
  const safety = useAction(() => void msgs.reload());
  const list = useRef<ScrollViewInstance>(null);
  const stick = useRef(true);

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
    if (await confirmAsync('Leave this group?', 'You will lose access to the chat.', 'Leave', true)) {
      const r = await send.run(() => post(conv.scope === 'trip' ? `/v1/trips/${conv.scopeId}/leave` : `/v1/activities/${conv.scopeId}/leave`));
      if (r) router.back();
    }
  };

  const block = async (m: Msg) => {
    if (await confirmAsync(`Block ${m.sender.displayName}?`, "Their messages will be hidden from you and they can't contact you, in HERE or THERE.", 'Block', true)) void safety.run(() => post('/v1/blocks', { userId: m.sender.id }));
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

  if (locked)
    return (
      <Screen hasHeader>
        <Empty title="Chat is for approved members">Once the organizer approves your request, the group chat opens here.</Empty>
      </Screen>
    );

  const menu = [
    ...(conv ? [{ label: conv.scope === 'trip' ? 'View trip' : 'View activity', onSelect: () => go(conv.scope === 'trip' ? `/trip/${conv.scopeId}` : `/activity/${conv.scopeId}`) }] : []),
    { label: 'Safety tools', onSelect: () => go('/safety') },
    { label: 'Leave group', danger: true, onSelect: leave },
  ];

  return (
    // on tablets and desktops the conversation is a centred, readable column rather than edge to edge
    <View style={{ flex: 1, alignItems: 'center', backgroundColor: c.bg }}>
    <KeyboardAvoidingView style={{ flex: 1, width: '100%', maxWidth: 760, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 96 : 0}>
      <Stack.Screen
        options={{
          title: conv?.title ?? 'Group chat',
          headerTitleAlign: 'left',
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Avatar name={conv?.title} size={40} />
              <View>
                <Text numberOfLines={1} style={{ color: c.text, fontWeight: '800', fontSize: 18, maxWidth: 200 }}>{conv?.title ?? 'Group chat'}</Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>{conv?.scope === 'trip' ? 'Trip group' : 'Activity group'}</Text>
              </View>
            </View>
          ),
          headerRight: () => <Menu items={menu} />,
        }}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: c.sand, borderRadius: 16, padding: 14 }}>
          <Ionicons name="lock-closed-outline" size={20} color={c.forest} />
          <Text style={{ flex: 1, color: c.text, fontSize: 14, lineHeight: 20 }}>Only approved members can see this chat. Meet at public venues, and report anything that feels wrong.</Text>
        </View>
      </View>

      <ScrollView ref={list} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }} onScroll={onScroll} scrollEventThrottle={100} onContentSizeChange={() => stick.current && list.current?.scrollToEnd({ animated: false })} keyboardShouldPersistTaps="handled">
        {msgs.loading && !msgs.data && <Spinner />}
        {msgs.data?.items.length === 0 && <Txt variant="muted" style={{ textAlign: 'center' }}>No messages yet. Say hi 👋</Txt>}
        {msgs.data?.items.map((m, i, all) => {
          const mine = m.sender.id === me?.id;
          const newDay = i === 0 || dayLabel(all[i - 1].createdAt) !== dayLabel(m.createdAt);
          return (
            <Fragment key={m.id}>
              {newDay && (
                <View style={{ alignSelf: 'center', backgroundColor: c.infoBg, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 2, marginVertical: 6 }}>
                  <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>{dayLabel(m.createdAt)}</Text>
                </View>
              )}
              <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', backgroundColor: mine ? c.forest : c.surface, borderWidth: mine ? 0 : 1, borderColor: c.line, borderRadius: 16, borderBottomRightRadius: mine ? 4 : 16, borderBottomLeftRadius: mine ? 16 : 4, paddingHorizontal: 12, paddingVertical: 8, gap: 2 }}>
                {!mine && <Text style={{ color: c.green, fontWeight: '800', fontSize: 14 }}>{m.sender.displayName}</Text>}
                <Text style={{ color: mine ? '#fff' : c.text, fontSize: 16 }}>{m.body}</Text>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Text style={{ color: mine ? '#B9CFC8' : c.muted, fontSize: 11 }}>{hhmm(m.createdAt)}</Text>
                  {!mine && (
                    <>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Report message from ${m.sender.displayName}`} onPress={() => setReportMsg(m.id)} hitSlop={8}>
                        <Text style={{ color: c.green, fontSize: 12, fontWeight: '700' }}>Report</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Block ${m.sender.displayName}`} onPress={() => block(m)} hitSlop={8}>
                        <Text style={{ color: c.green, fontSize: 12, fontWeight: '700' }}>Block</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            </Fragment>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 16 }}>
        <ErrorBanner message={send.error ?? safety.error ?? (msgs.error && !locked ? msgs.error.message : null)} />
      </View>
      {msgs.data && !msgs.data.writable ? (
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16 }}>
          <Banner>This conversation is closed. The activity or trip was cancelled.</Banner>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}>
          <TextInput
            accessibilityLabel="Write a message"
            value={text}
            onChangeText={setText}
            placeholder="Write a message…"
            placeholderTextColor={c.muted}
            maxLength={2000}
            multiline
            style={{ flex: 1, minHeight: 52, maxHeight: 120, borderWidth: 1.5, borderColor: c.line, borderRadius: 26, backgroundColor: c.surface, color: c.text, paddingHorizontal: 20, paddingVertical: 12, fontSize: 16 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            accessibilityState={{ disabled: !text.trim() || send.busy }}
            disabled={!text.trim() || send.busy}
            onPress={submit}
            style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', opacity: !text.trim() || send.busy ? 0.45 : 1 }}
          >
            <Ionicons name="paper-plane-outline" size={22} color="#fff" />
          </Pressable>
        </View>
      )}
      {/* quiet footer: where the safety tools live */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: insets.bottom + 6 }}>
        <Text style={{ color: c.muted, fontSize: 13 }}>Report or leave group in ⋯ menu</Text>
        <Pressable accessibilityRole="button" onPress={() => go('/safety')} hitSlop={8}>
          <Text style={{ color: c.green, fontWeight: '800', fontSize: 14 }}>Safety →</Text>
        </Pressable>
      </View>
      <ReportSheet target={reportMsg ? { type: 'message', id: reportMsg } : null} onClose={() => setReportMsg(null)} />
    </KeyboardAvoidingView>
    </View>
  );
}
