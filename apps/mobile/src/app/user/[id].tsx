import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Chip, Empty, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { del, get, post, type Reliability } from '@/lib/api';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { useMe } from '@/lib/auth';
import { confirmAsync } from '@/lib/confirm';
import { useAction, useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
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
  reliability?: Reliability | null;
  stats: { activitiesHosted: number; activitiesJoined: number };
  relation: { following: boolean; followsYou: boolean; buddy: boolean };
};

/** Another person's public profile: picture, About, interests. No email, no documents, only the verified-adult badge. */
export default function UserProfile() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const router = useRouter();
  const user = useLoad(() => get<PublicProfile>(`/v1/users/${id}`), [id], undefined, 'user', { animate: true });
  const act = useAction();
  const [report, setReport] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const p = user.data;
  const [rel, setRel] = useState<PublicProfile['relation'] | null>(null);
  const relation = rel ?? p?.relation;
  const mine = me?.id === id;

  if (user.loading && !p)
    return (
      <Screen>
        <SkeletonDetail />
      </Screen>
    );
  if (user.error || !p)
    return (
      <Screen>
        <Empty title={t('Profile not available')} />
      </Screen>
    );

  const block = async () => {
    if (await confirmAsync(t('Block {name}?', { name: p.displayName }), t("Their messages will be hidden from you and they can't contact you, in HERE or THERE."), t('Block'), true)) {
      const r = await act.run(() => post('/v1/blocks', { userId: p.id }));
      if (r) {
        setBlocked(true);
        router.back();
      }
    }
  };

  // the button changes at once; the server's answer (which also says if you are now buddies) settles it
  const toggleFollow = async () => {
    if (!relation) return;
    const was = relation;
    setRel({ ...was, following: !was.following, buddy: !was.following && was.followsYou });
    const r = await act.run(() => (was.following ? del<PublicProfile['relation']>(`/v1/follows/${p.id}`) : post<PublicProfile['relation']>('/v1/follows', { userId: p.id })));
    setRel(r ?? was);
  };

  return (
    <Screen tabBar>
      {!mine && !blocked ? (
        <Stack.Screen options={{ headerRight: () => <Menu items={[{ label: t('Report this person'), onSelect: () => setReport(true) }, { label: t('Block {name}', { name: p.displayName }), danger: true, onSelect: block }]} /> }} />
      ) : null}
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Avatar name={p.displayName} uri={p.photoUrl} size={104} />
        <Txt variant="h2" style={{ fontSize: 22 }}>{p.displayName} {p.verifiedAdult ? <Ionicons name="checkmark" size={18} color={c.green} /> : null}</Txt>
        <Txt variant="muted">{p.homeCity ?? t('City not set')} · {p.verifiedAdult ? t('Verified adult') : t('Not verified')}</Txt>
        <ReliabilityChip r={p.reliability} />
      </View>

      <View style={{ flexDirection: 'row', paddingVertical: 8 }}>
        {[
          [p.stats.activitiesHosted, t('Hosted')],
          [p.stats.activitiesJoined, t('Joined')],
        ].map(([n, l], i) => (
          <View key={String(l)} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: c.line }}>
            <Txt variant="h2" style={{ fontSize: 24, lineHeight: 30 }}>{n}</Txt>
            <Txt variant="muted">{l}</Txt>
          </View>
        ))}
      </View>

      <ErrorBanner message={act.error} />
      <Txt variant="h3">{t('About')}</Txt>
      {p.bio ? <Txt style={{ lineHeight: 21 }}>{p.bio}</Txt> : <Txt variant="muted">{t('No bio yet.')}</Txt>}
      {p.interests.length > 0 && (
        <>
          <Txt variant="h3">{t('Interests')}</Txt>
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {p.interests.map((i) => (
              <Chip key={i} label={t(i)} tone="neutral" />
            ))}
          </Row>
        </>
      )}
      {p.languages.length > 0 && <Txt variant="small">{t('Languages: {list}', { list: p.languages.map((l) => t(l)).join(', ') })}</Txt>}

      {mine ? <Btn title={t('Edit my profile')} variant="secondary" onPress={() => go('/edit-profile')} /> : null}
      {!mine && relation ? (
        <>
          <Btn title={relation.buddy ? t('Buddies ✓') : relation.following ? t('Following ✓') : relation.followsYou ? t('Follow back') : t('Follow')} variant={relation.following ? 'secondary' : 'primary'} onPress={toggleFollow} />
          {!relation.buddy && relation.followsYou && !relation.following ? <Txt variant="small" style={{ textAlign: 'center' }}>{t('{name} follows you.', { name: p.displayName })}</Txt> : null}
        </>
      ) : null}
      {!p.verifiedAdult && <Banner tone="warn">{t('This person has not completed identity verification.')}</Banner>}
      <ReportSheet target={report ? { type: 'user', id: p.id } : null} onClose={() => setReport(false)} />
    </Screen>
  );
}
