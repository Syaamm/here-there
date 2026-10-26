import { useState } from 'react';
import { View } from 'react-native';
import { Avatar, Btn, Card, Chip, Empty, ErrorBanner, Grid, Pill, PillRow, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { del, post } from '@/lib/api';
import { useAction, useRefresh } from '@/lib/hooks';
import { PagedTail, useCursorList } from '@/lib/paged';

type Kind = 'buddies' | 'following' | 'followers';
type Person = { userId: string; displayName: string; homeCity: string | null; photoUrl: string | null; verifiedAdult: boolean; following: boolean; followsYou: boolean; buddy: boolean };
type Counts = { counts: Record<Kind, number> };

const EMPTY: Record<Kind, [string, string]> = {
  buddies: ['No buddies yet', 'When you and someone else follow each other, you become buddies.'],
  following: ['You are not following anyone', "Open someone's profile from an activity or trip and tap Follow."],
  followers: ['No followers yet', 'People who follow you will show up here. Only you can see this list.'],
};

/** Your buddies, the people you follow and the people who follow you. Private: nobody else can see these lists. */
export default function Connections() {
  const go = useGo();
  const [kind, setKind] = useState<Kind>('buddies');
  // the server sends one list at a time, a few people per request, with how many each list holds
  const list = useCursorList<Person, Counts>('/v1/me/connections', { kind }, 'me:buddies3');
  const act = useAction();
  const { refreshing, onRefresh } = useRefresh(list.reload);
  const items = list.items;
  const toggle = async (p: Person) => {
    await act.run(() => (p.following ? del(`/v1/follows/${p.userId}`) : post('/v1/follows', { userId: p.userId })));
    list.reload();
  };

  return (
    <Screen tabBar wide onRefresh={onRefresh} refreshing={refreshing}>
      <PillRow>
        {(['buddies', 'following', 'followers'] as Kind[]).map((k) => (
          <Pill key={k} label={`${k[0].toUpperCase()}${k.slice(1)}${list.data ? ` ${list.data.counts[k]}` : ''}`} active={kind === k} onPress={() => setKind(k)} />
        ))}
      </PillRow>
      <ErrorBanner message={list.error?.message ?? act.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && items.length === 0 && <Empty title={EMPTY[kind][0]}>{EMPTY[kind][1]}</Empty>}
      <Grid>
        {items.map((p) => (
          <Card key={p.userId} onPress={() => go(`/user/${p.userId}`)} accessibilityLabel={`${p.displayName}, open profile`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }}>
            <Avatar name={p.displayName} uri={p.photoUrl} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{p.displayName}</Txt>
              <Row style={{ gap: 6 }}>
                <Txt variant="small">{p.homeCity ?? 'City not set'}</Txt>
                {p.buddy && <Chip label="Buddy" tone="ok" />}
              </Row>
            </View>
            {!p.following && <Btn title="Follow back" small onPress={() => toggle(p)} />}
          </Card>
        ))}
      </Grid>
      <PagedTail paged={list} />
    </Screen>
  );
}
