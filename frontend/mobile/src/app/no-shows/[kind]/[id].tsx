import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Avatar, Banner, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { del, get, post, type NoShowList } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

import { sc, sp } from '@/lib/scale';
const STATE: Record<string, [string, 'warn' | 'ok' | 'neutral' | 'info']> = {
  marked: ['Noted', 'warn'],
  disputed: ['Disputed', 'info'],
  upheld: ['Confirmed', 'warn'],
  overturned: ['Overturned', 'ok'],
};

/** Host: who did not come? Anyone you do not mark is counted as having come. (The rules are in the notes for staff.) */
export default function NoShows() {
  const { t } = useT();
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const base = `/v1/${kind === 'trip' ? 'trips' : 'activities'}/${id}/no-shows`;
  const list = useLoad(() => get<NoShowList>(base), [base], undefined, 'noshows');
  const { refreshing, onRefresh } = useRefresh(list.reload);
  const act = useAction(() => void list.reload());
  const d = list.data;
  // Marking (or undoing) changes that one person's card at once, while the server is told in the background: nobody else's
  // buttons wait or flicker. If the server refuses, the card goes back and the reason is shown above.
  const [local, setLocal] = useState<Record<string, 'marked' | 'none'>>({});
  useEffect(() => setLocal({}), [list.data]); // the server's own list has arrived: it takes over
  const change = (userId: string, to: 'marked' | 'none', send: () => Promise<unknown>) => {
    setLocal((m) => ({ ...m, [userId]: to }));
    void act.run(send).then((ok) => {
      if (ok === undefined) setLocal((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== userId)));
    });
  };
  const mark = async (userId: string, name: string) => {
    if (await confirmAsync(t('Say {name} did not come?', { name }), t('They will be told.'), t('Yes'), true)) change(userId, 'marked', () => post(base, { userId }));
  };

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={list.error?.message ?? act.error} />
      {list.loading && !d && <Spinner />}
      {d && (
        <>
          <Txt variant="muted">{d.title}</Txt>
          {!d.canMark ? <Banner tone="warn">{t('This list is closed.')}</Banner> : null}
          {d.items.length === 0 && <Empty title={t('Nobody else was in this one')} />}
          {d.items.map((m0) => (local[m0.userId] === 'marked' ? { ...m0, mark: { ...(m0.mark ?? {}), state: 'marked' } } : local[m0.userId] === 'none' ? { ...m0, mark: null } : m0) as typeof m0).map((m) => (
            <Card key={m.userId} style={{ padding: sp(12), borderRadius: sc(18), gap: sp(8) }}>
              <Row style={{ gap: sp(12), alignItems: 'center' }}>
                <Avatar name={m.displayName} uri={m.photoUrl} />
                <View style={{ flex: 1 }}>
                  <Txt variant="h3" style={{ fontSize: 16, lineHeight: 21 }}>{m.displayName}</Txt>
                  {m.mark ? <Chip label={t(STATE[m.mark.state]?.[0] ?? m.mark.state)} tone={STATE[m.mark.state]?.[1] ?? 'neutral'} /> : null}
                </View>
                {!m.mark && d.canMark ? <Btn title={t('Did not come')} variant="danger" small onPress={() => void mark(m.userId, m.displayName)} /> : null}
                {/* undo a mark made by mistake: they did come */}
                {m.mark?.state === 'marked' ? <Btn title={t('Undo')} variant="secondary" small onPress={() => change(m.userId, 'none', () => del(`${base}/${m.userId}`))} /> : null}
              </Row>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
