import { useState } from 'react';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { Btn, Card, Chip, ErrorBanner, Field, Row, Screen, Sheet, Spinner, Txt } from '@/components/ui';
import { get, post, type MyNoShow, type MyReliability } from '@/lib/api';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useCursorList } from '@/lib/paged';

/** Your level, kept simple: the level, one line, and anything a host said that you can answer. */
export default function Reliability() {
  const rel = useLoad(() => get<MyReliability>('/v1/me/reliability'), [], undefined, 'me:reliability');
  const info = useLoad(() => get<{ items: { what: string; how: string; why: string }[] }>('/v1/reliability/info'), [], undefined, 'reliability:info');
  const notes = useCursorList<MyNoShow>('/v1/me/no-shows', {}, 'me:noshows');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([rel.reload(), notes.reload()]));
  const [disputing, setDisputing] = useState<MyNoShow | null>(null);
  const [text, setText] = useState('');
  const send = useAction(() => {
    setDisputing(null);
    setText('');
    void notes.reload();
    void rel.reload();
  });
  const r = rel.data;
  // only what can still be answered, or is waiting for a decision
  const open = (notes.data?.items ?? []).filter((n) => (n.state === 'marked' && n.canDispute) || n.state === 'disputed');

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={rel.error?.message ?? notes.error?.message} />
      {rel.loading && !r && <Spinner />}
      {r && (
        <Card style={{ padding: 16, borderRadius: 20, gap: 10 }}>
          <Row style={{ gap: 10, alignItems: 'center' }}>
            <Txt variant="h2" style={{ fontSize: 22 }}>Your level</Txt>
            <ReliabilityChip r={{ level: r.level, label: r.label }} />
          </Row>
          <Txt>{r.line}</Txt>
        </Card>
      )}

      {open.map((n) => (
        <Card key={n.id} style={{ padding: 14, borderRadius: 18, gap: 8 }}>
          <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{n.title}</Txt>
          <Txt>The host says you did not come.</Txt>
          {n.state === 'disputed' ? <Chip label="Disputed" tone="info" /> : n.canDispute ? <Btn title="Dispute" variant="secondary" small onPress={() => setDisputing(n)} /> : null}
        </Card>
      ))}

      {info.data && info.data.items.length > 0 ? (
        <>
          <Txt variant="h3">How it works</Txt>
          {info.data.items.map((i) => (
            <Card key={i.what} style={{ padding: 14, borderRadius: 18, gap: 4 }}>
              <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{i.what}</Txt>
              <Txt>{i.how}</Txt>
              <Txt variant="small">{i.why}</Txt>
            </Card>
          ))}
        </>
      ) : null}

      <Sheet visible={!!disputing} title="Dispute" onClose={() => setDisputing(null)}>
        <ErrorBanner message={send.error} />
        <Field label="What happened?" value={text} onChangeText={setText} multiline maxLength={500} />
        <Btn title="Send" onPress={() => void send.run(() => post(`/v1/no-shows/${disputing!.id}/dispute`, { note: text.trim() }))} loading={send.busy} disabled={text.trim().length < 3} />
      </Sheet>
    </Screen>
  );
}
