import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Chip, Empty, ErrorBanner, Row, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { useAction, useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type PublicProfile = {
  id: string;
  displayName: string;
  homeCity: string | null;
  languages: string[];
  interests: string[];
  bio: string | null;
  photoUrl: string | null;
  verifiedAdult: boolean;
  stats: { activitiesHosted: number; activitiesJoined: number };
};

/** Another person's public profile: picture, About, interests. No email, no documents, only the verified-adult badge. */
export default function UserProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const router = useRouter();
  const user = useLoad(() => get<PublicProfile>(`/v1/users/${id}`), [id]);
  const act = useAction();
  const [report, setReport] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const p = user.data;
  const mine = me?.id === id;

  if (user.loading && !p)
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  if (user.error || !p)
    return (
      <Screen>
        <Empty title="Profile not available">This person may have left or you may not be able to see them.</Empty>
      </Screen>
    );

  const block = async () => {
    if (await confirmAsync(`Block ${p.displayName}?`, "Their messages will be hidden from you and they can't contact you, in HERE or THERE.", 'Block', true)) {
      const r = await act.run(() => post('/v1/blocks', { userId: p.id }));
      if (r) {
        setBlocked(true);
        router.back();
      }
    }
  };

  return (
    <Screen tabBar>
      {!mine && !blocked ? (
        <Stack.Screen options={{ headerRight: () => <Menu items={[{ label: 'Report this person', onSelect: () => setReport(true) }, { label: `Block ${p.displayName}`, danger: true, onSelect: block }]} /> }} />
      ) : null}
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={p.displayName} uri={p.photoUrl} size={104} />
        <Txt variant="h2" style={{ fontSize: 22 }}>{p.displayName} {p.verifiedAdult ? <Ionicons name="checkmark" size={18} color={c.green} /> : null}</Txt>
        <Txt variant="muted">{p.homeCity ?? 'City not set'} · {p.verifiedAdult ? 'Verified adult' : 'Not verified'}</Txt>
      </View>

      <View style={{ flexDirection: 'row', paddingVertical: 8 }}>
        {[
          [p.stats.activitiesHosted, 'Hosted'],
          [p.stats.activitiesJoined, 'Joined'],
        ].map(([n, l], i) => (
          <View key={String(l)} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line }}>
            <Txt variant="h2" style={{ fontSize: 24, lineHeight: 30 }}>{n}</Txt>
            <Txt variant="muted">{l}</Txt>
          </View>
        ))}
      </View>

      <ErrorBanner message={act.error} />
      <Txt variant="h3">About</Txt>
      {p.bio ? <Txt style={{ lineHeight: 21 }}>{p.bio}</Txt> : <Txt variant="muted">{p.displayName} has not written anything yet.</Txt>}
      {p.interests.length > 0 && (
        <>
          <Txt variant="h3">Interests</Txt>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {p.interests.map((i) => (
              <Chip key={i} label={i} tone="neutral" />
            ))}
          </Row>
        </>
      )}
      {p.languages.length > 0 && <Txt variant="small">Languages: {p.languages.join(', ')}</Txt>}

      {mine ? <Btn title="Edit my profile" variant="secondary" onPress={() => go('/edit-profile')} /> : null}
      {!p.verifiedAdult && <Banner tone="warn">This person has not completed identity verification.</Banner>}
      <ReportSheet target={report ? { type: 'user', id: p.id } : null} onClose={() => setReport(false)} />
    </Screen>
  );
}
