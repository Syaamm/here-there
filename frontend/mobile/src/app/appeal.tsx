import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { AcctCard, AcctScreen, StatusTag } from '@/components/AccountParts';
import { Text } from '@/components/ScaledText';
import { Btn, ErrorBanner, Field, Spinner, Txt } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { post, type MyAppeal } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';
import { localeTag, useT } from '@/lib/i18n';

const ASK: Record<string, { title: string; hint: string }> = {
  verification: { title: 'Ask for a review of your identity check', hint: 'Tell us what went wrong.' },
  removal: { title: 'Ask for a review of the removal', hint: 'Tell us why it was fine.' },
  warning: { title: 'Ask for a review of the warning', hint: 'Tell us your side.' },
  message: { title: 'Ask for a review of the removed message', hint: 'Tell us why it was fine.' },
  report: { title: 'Ask for a review of the report decision', hint: 'Tell us your side.' },
};
const STATE: Record<MyAppeal['state'], { label: string; tone: 'warn' | 'ok' | 'bad' }> = { open: { label: 'Waiting for a decision', tone: 'warn' }, upheld: { label: 'Accepted', tone: 'ok' }, rejected: { label: 'Decision stands', tone: 'bad' } };

/** Asking staff to look at a decision again, and what became of earlier requests. One request per decision. */
export default function Appeal() {
  const { t } = useT();
  const { c } = useTheme();
  const { kind, targetType, targetId } = useLocalSearchParams<{ kind?: string; targetType?: string; targetId?: string }>();
  const mine = useCursorList<MyAppeal>('/v1/me/appeals', {}, 'me:appeals');
  const { refreshing, onRefresh } = useRefresh(() => mine.reload());
  const [text, setText] = useState('');
  const send = useAction(() => {
    setText('');
    void mine.reload();
  });
  const ask = kind ? ASK[kind] : undefined;
  const items = mine.data?.items ?? [];
  const hasOpen = items.some((a) => a.state === 'open');

  return (
    <AcctScreen title={t('Ask for a review')} onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={mine.error?.message} />
      {ask && !hasOpen ? (
        <AcctCard style={{ gap: 10 }}>
          <Txt variant="h3">{t(ask.title)}</Txt>
          <Txt variant="muted">{t(ask.hint)}</Txt>
          <ErrorBanner message={send.error} />
          <Field label={t('Your message')} value={text} onChangeText={setText} multiline maxLength={1000} />
          <Btn
            title={t('Send')}
            loading={send.busy}
            disabled={text.trim().length < 10}
            onPress={() => void send.run(() => post('/v1/me/appeals', kind === 'removal' ? { kind, targetType, targetId, message: text.trim() } : kind === 'verification' ? { kind, message: text.trim() } : { kind, targetId, message: text.trim() }))}
          />
        </AcctCard>
      ) : null}
      {mine.loading && !mine.data && <Spinner />}
      {items.length > 0 ? <Txt variant="h3">{t('Your requests')}</Txt> : null}
      {items.map((a) => (
        <AcctCard key={a.id} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            <Ionicons name={a.what.toLowerCase().includes('warn') ? 'warning-outline' : a.what.toLowerCase().includes('message') ? 'chatbubble-ellipses-outline' : 'document-text-outline'} size={20} color={c.text} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '500', flex: 1 }}>{t(a.what.charAt(0).toUpperCase() + a.what.slice(1))}</Text>
                <StatusTag label={t(STATE[a.state].label)} tone={STATE[a.state].tone} />
              </View>
              <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Sent {date}', { date: new Date(a.createdAt).toLocaleDateString(localeTag()) })}</Text>
              {a.decision ? <Text style={{ color: c.muted, fontSize: 13, lineHeight: 20, marginTop: 6 }}>{a.decision}</Text> : null}
            </View>
          </View>
        </AcctCard>
      ))}
      <PagedTail paged={mine} />
      {!ask && !mine.loading && items.length === 0 ? <Txt variant="muted">{t('You have not asked for any reviews.')}</Txt> : null}
    </AcctScreen>
  );
}
