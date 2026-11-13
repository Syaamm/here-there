import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ProofPhotos } from '@/components/ProofPhotos';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { Btn, Card, Chip, ErrorBanner, Field, Row, Screen, Sheet, Spinner, Txt } from '@/components/ui';
import { get, post, type MyNoShow, type MyReliability } from '@/lib/api';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useCursorList } from '@/lib/paged';

import { sc, sp } from '@/lib/scale';
/** Your level, kept simple: the level, one line, and anything a host said that you can answer. */
export default function Reliability() {
  const { t } = useT();
  const rel = useLoad(() => get<MyReliability>('/v1/me/reliability'), [], undefined, 'me:reliability');
  const notes = useCursorList<MyNoShow>('/v1/me/no-shows', {}, 'me:noshows');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([rel.reload(), notes.reload()]));
  const [disputing, setDisputing] = useState<MyNoShow | null>(null);
  // opened from the alert about one note ("The host says you didn't come"): that note's dispute opens at once, once
  const { markId } = useLocalSearchParams<{ markId?: string }>();
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!markId || openedFor.current === markId) return;
    const note = (notes.data?.items ?? []).find((n) => n.id === markId);
    if (note && note.state === 'marked' && note.canDispute) {
      openedFor.current = markId;
      setDisputing(note);
    }
  }, [markId, notes.data]);
  const [text, setText] = useState('');
  const [proofs, setProofs] = useState<string[]>([]); // photos added as proof (a screenshot of the chat, say)
  const send = useAction(() => {
    setDisputing(null);
    setText('');
    setProofs([]);
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
        <Card style={{ padding: sp(16), borderRadius: sc(20), gap: sp(10) }}>
          <Row style={{ gap: sp(10), alignItems: 'center' }}>
            <Txt variant="h2" style={{ fontSize: 22 }}>{t('Your level')}</Txt>
            <ReliabilityChip r={{ level: r.level, label: r.label }} />
          </Row>
          <Txt>{r.line}</Txt>
        </Card>
      )}

      {open.map((n) => (
        <Card key={n.id} style={{ padding: sp(14), borderRadius: sc(18), gap: sp(8) }}>
          <Txt variant="h3" style={{ fontSize: 16, lineHeight: 21 }}>{n.title}</Txt>
          <Txt>{t('The host says you did not come.')}</Txt>
          {n.state === 'disputed' ? <Chip label={t('Disputed')} tone="info" /> : n.canDispute ? <Btn title={t('Dispute')} variant="secondary" small onPress={() => setDisputing(n)} /> : null}
        </Card>
      ))}

      <Sheet visible={!!disputing} title={t('Dispute')} onClose={() => setDisputing(null)}>
        <ErrorBanner message={send.error} />
        <Field label={t('What happened?')} value={text} onChangeText={setText} multiline maxLength={500} />
        {/* a screenshot of the chat, say: up to 3 photos, only you and the moderators can see them */}
        <ProofPhotos key={disputing?.id ?? 'none'} onChange={setProofs} />
        <Btn title={t('Send')} onPress={() => void send.run(() => post(`/v1/no-shows/${disputing!.id}/dispute`, { note: text.trim(), ...(proofs.length ? { proofIds: proofs } : {}) }))} loading={send.busy} disabled={text.trim().length < 3} />
      </Sheet>
    </Screen>
  );
}
