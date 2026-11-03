import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Avatar, Banner, Btn, Card, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt } from '@/components/ui';
import { del, get, post, type NoShowList } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

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

  const mark = async (userId: string, name: string) => {
    if (await confirmAsync(t('Say {name} did not come?', { name }), t('They will be told.'), t('Yes'), true)) void act.run(() => post(base, { userId }));
  };

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      <ErrorBanner message={list.error?.message ?? act.error} />
      {list.loading && !d && <Spinner />}
      {d && (
        <>
          <Txt variant="h2" style={{ fontSize: 22 }}>{t('Who came?')}</Txt>
          <Txt variant="muted">{d.title}</Txt>
          {!d.canMark ? <Banner tone="warn">{t('This list is closed.')}</Banner> : null}
          {d.items.length === 0 && <Empty title={t('Nobody else was in this one')} />}
          {d.items.map((m) => (
            <Card key={m.userId} style={{ padding: 12, borderRadius: 18, gap: 8 }}>
              <Row style={{ gap: 12, alignItems: 'center' }}>
                <Avatar name={m.displayName} uri={m.photoUrl} />
                <View style={{ flex: 1 }}>
                  <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{m.displayName}</Txt>
                  {m.mark ? <Chip label={t(STATE[m.mark.state]?.[0] ?? m.mark.state)} tone={STATE[m.mark.state]?.[1] ?? 'neutral'} /> : null}
                </View>
                {!m.mark && d.canMark ? <Btn title={t('Did not come')} variant="danger" small onPress={() => void mark(m.userId, m.displayName)} loading={act.busy} /> : null}
                {m.mark?.state === 'marked' ? <Btn title={t('Take back')} variant="secondary" small onPress={() => void act.run(() => del(`${base}/${m.userId}`))} loading={act.busy} /> : null}
              </Row>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
