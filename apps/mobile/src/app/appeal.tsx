import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Btn, Card, Chip, ErrorBanner, Field, Row, Screen, Spinner, Txt } from '@/components/ui';
import { post, type MyAppeal } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';

const ASK: Record<string, { title: string; hint: string }> = {
  verification: { title: 'Ask for a review of your identity check', hint: 'Tell us what you think went wrong. A person on our team will look again.' },
  removal: { title: 'Ask for a review of the removal', hint: 'Tell us why this should not have been taken down. A moderator will look again.' },
  warning: { title: 'Ask for a review of the warning', hint: 'Tell us what happened from your side. A different moderator will look again.' },
  message: { title: 'Ask for a review of the removed message', hint: 'Tell us why the message was fine. A different moderator will look again.' },
  report: { title: 'Ask for a second look at your report', hint: 'Tell us what we may have missed. A different moderator will look at it again.' },
};
const STATE: Record<MyAppeal['state'], { label: string; tone: 'warn' | 'ok' | 'bad' }> = { open: { label: 'Waiting for a decision', tone: 'warn' }, upheld: { label: 'Accepted', tone: 'ok' }, rejected: { label: 'Decision stands', tone: 'bad' } };

/** Asking staff to look at a decision again, and what became of earlier requests. One request per decision. */
export default function Appeal() {
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
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={mine.error?.message} />
      {ask && !hasOpen ? (
        <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
          <Txt variant="h3">{ask.title}</Txt>
          <Txt variant="muted">{ask.hint}</Txt>
          <ErrorBanner message={send.error} />
          <Field label="Your message" value={text} onChangeText={setText} multiline maxLength={1000} />
          <Btn
            title="Send"
            loading={send.busy}
            disabled={text.trim().length < 10}
            onPress={() => void send.run(() => post('/v1/me/appeals', kind === 'removal' ? { kind, targetType, targetId, message: text.trim() } : kind === 'verification' ? { kind, message: text.trim() } : { kind, targetId, message: text.trim() }))}
          />
        </Card>
      ) : null}
      {mine.loading && !mine.data && <Spinner />}
      {items.length > 0 ? <Txt variant="h3">Your requests</Txt> : null}
      {items.map((a) => (
        <Card key={a.id} style={{ padding: 14, borderRadius: 18, gap: 6 }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20, flex: 1 }}>{a.what.charAt(0).toUpperCase() + a.what.slice(1)}</Txt>
            <Chip label={STATE[a.state].label} tone={STATE[a.state].tone} />
          </Row>
          <Txt variant="small">Sent {new Date(a.createdAt).toLocaleDateString()}</Txt>
          {a.decision ? <Txt>{a.decision}</Txt> : null}
        </Card>
      ))}
      <PagedTail paged={mine} />
      {!ask && !mine.loading && items.length === 0 ? <Txt variant="muted">You have not asked for any reviews.</Txt> : null}
    </Screen>
  );
}
