import Ionicons from '@expo/vector-icons/Ionicons';
import { SkeletonDetail } from '@/components/Skeleton';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Menu } from '@/components/Menu';
import { ReportSheet } from '@/components/ReportSheet';
import { Avatar, Banner, Btn, Chip, Empty, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { del, get, post, type Reliability } from '@/lib/api';
import { ReliabilityChip } from '@/components/ReliabilityChip';
import { useMe } from '@/lib/auth';
import { useVerifyGate } from '@/lib/verifyGate';
import { confirmAsync } from '@/lib/confirm';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { StatsCard } from '@/components/StatsCard';
import { useTheme } from '@/lib/theme';
import { SampleTag } from '@/components/SampleTag';
import { FirstTimeHint } from '@/components/FirstTimeHint';

import { sc, sp } from '@/lib/scale';
type PublicProfile = {
  id: string;
  displayName: string;
  homeCity: string | null;
  languages: string[];
  interests: string[];
  bio: string | null;
  photoUrl: string | null;
  verifiedAdult: boolean;
  /** a made-up person of the sample data */
  sample?: boolean;
  reliability?: Reliability | null;
  stats: { activitiesHosted: number; activitiesJoined: number; tripsDone: number };
  relation: { following: boolean; followsYou: boolean; buddy: boolean };
};

/** Another person's public profile: picture, About, interests. No email, no documents, only the verified-adult badge. */
export default function UserProfile() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const gate = useVerifyGate();
  const router = useRouter();
  const user = useLoad(() => get<PublicProfile>(`/v1/users/${id}`), [id], undefined, 'user', { animate: true });
  const { refreshing, onRefresh } = useRefresh(user.reload); // pull down to refresh
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
    <Screen tabBar onRefresh={onRefresh} refreshing={refreshing} right={!mine && !blocked ? <Menu items={[{ label: t('Report this person'), onSelect: () => setReport(true) }, { label: t('Block {name}', { name: p.displayName }), danger: true, onSelect: block }]} /> : undefined}>
      <View style={{ alignItems: 'center', gap: sp(6) }}>
        <Avatar name={p.displayName} uri={p.photoUrl} size={104} />
        <Txt variant="h2" style={{ fontSize: 22 }}>{p.displayName} {p.verifiedAdult ? <Ionicons name="checkmark" size={sc(18)} color={c.green} /> : null}</Txt>
        <Txt variant="muted">{p.homeCity ?? t('City not set')} · {p.verifiedAdult ? t('Verified adult') : t('Identity not verified')}</Txt>
        <Row style={{ gap: sp(8), flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* how you and this person are connected: friends (you follow each other), you follow them, or they follow you */}
          {!mine && relation?.buddy ? <Chip label={t('Friends')} tone="ok" /> : null}
          {!mine && relation && !relation.buddy && relation.following ? <Chip label={t('Following')} tone="neutral" /> : null}
          {!mine && relation && !relation.buddy && !relation.following && relation.followsYou ? <Chip label={t('Follows you')} tone="neutral" /> : null}
          {p.sample ? <SampleTag /> : null}
          <ReliabilityChip r={p.reliability} />
        </Row>
        {/* the same in words, right under the pills */}
        {!mine && relation && (relation.buddy || relation.following || relation.followsYou) ? (
          <Txt variant="small" style={{ textAlign: 'center' }}>
            {relation.buddy ? t('You and {name} follow each other.', { name: p.displayName }) : relation.following ? t('You follow {name}.', { name: p.displayName }) : t('{name} follows you.', { name: p.displayName })}
          </Txt>
        ) : null}
      </View>
      {!mine && relation?.buddy ? <FirstTimeHint id="friends" title={t('You are Friends')} text={t('When you follow each other you are Friends. Friends are your travel buddies: you see when they go to a plan or a trip, and plans with friends come first in your feed.')} /> : null}

      <StatsCard hosted={p.stats.activitiesHosted} joined={p.stats.activitiesJoined} trips={p.stats.tripsDone} />

      <ErrorBanner message={act.error} />
      <Txt variant="h3">{t('About')}</Txt>
      {p.bio ? <Txt style={{ lineHeight: 21 }}>{p.bio}</Txt> : <Txt variant="muted">{t('No bio yet.')}</Txt>}
      {p.interests.length > 0 && (
        <>
          <Txt variant="h3">{t('Interests')}</Txt>
          <Row style={{ flexWrap: 'wrap', gap: sp(6) }}>
            {p.interests.map((i) => (
              <Chip key={i} label={t(i)} tone="neutral" />
            ))}
          </Row>
        </>
      )}
      {p.languages.length > 0 && <Txt variant="small">{t('Languages: {list}', { list: p.languages.map((l) => t(l)).join(', ') })}</Txt>}

      {mine ? <Btn title={gate.isGuest ? gate.title('edit') : t('Edit my profile')} variant="secondary" onPress={() => (gate.isGuest ? void gate.ask('edit') : go('/edit-profile'))} /> : null}
      {!mine && relation ? (
        <>
          <Btn title={relation.buddy ? t("Friends") : relation.following ? t("Following") : relation.followsYou ? t('Follow back') : t('Follow')} variant={relation.following ? 'secondary' : 'primary'} onPress={toggleFollow} />
        </>
      ) : null}
      {!p.verifiedAdult && <Banner tone="warn">{t('This person has not completed identity verification.')}</Banner>}
      <ReportSheet target={report ? { type: 'user', id: p.id } : null} onClose={() => setReport(false)} />
    </Screen>
  );
}
