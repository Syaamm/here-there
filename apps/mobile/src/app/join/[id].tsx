import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { CatPhoto } from '@/components/CatPhoto';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { CheckLine } from '@/components/CheckLine';
import { Banner, Btn, Card, CheckRow, ErrorBanner, Field, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { catColor, CATS } from '@/lib/constants';
import { when } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';

/** HERE · Join request. Chat stays closed until the host approves. */
export default function Join() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const router = useRouter();
  const go = useGo();
  const { data: a, loading } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  const [intro, setIntro] = useState('');
  const [agree, setAgree] = useState(false);
  const act = useAction();

  if (loading && !a) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (!a) return <Screen hasHeader><Txt>Activity not found.</Txt></Screen>;

  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';

  const submit = async () => {
    const r = await act.run(() => post(`/v1/activities/${id}/requests`, { intro: intro.trim() || undefined }));
    if (r) router.back();
  };

  return (
    <Screen hasHeader>
      {/* cover block: a stand-in for the activity photo */}
      <CatPhoto category={a.category} style={{ height: 190, borderRadius: 24 }} />
      <View>
        <Txt variant="h1" style={{ fontSize: 30, lineHeight: 36 }}>{a.title}</Txt>
        <Txt variant="muted">{when(a.startsAt)} · {a.venueName} · {a.going}/{a.capacity} going</Txt>
      </View>

      <ErrorBanner message={act.error} />
      {a.spotsLeft === 0 ? <Banner tone="warn">This activity is full. Join the waiting list: if a place opens up, the first person in line is let in automatically and told straight away.</Banner> : null}
      <Field label="Introduce yourself to the host" placeholder="Hi! I'm new to town and would love to join." multiline value={intro} onChangeText={setIntro} maxLength={500} hint={`${intro.length} / 500`} />

      <Card style={{ borderRadius: 20, paddingVertical: 6 }}>
        <Txt variant="h3" style={{ fontSize: 18, paddingTop: 8 }}>Before joining</Txt>
        <CheckLine ok={adult} text="I am at least 18 years old" />
        <CheckLine ok={verified} text={verified ? 'Identity verified' : 'Identity verification required'} action={!verified ? <Btn title="Verify now" small variant="secondary" onPress={() => go('/verify')} style={{ alignSelf: 'flex-start' }} /> : undefined} />
        <View style={{ paddingVertical: 12 }}>
          <CheckRow checked={agree} onChange={setAgree}>
            <Txt>I agree to the group guidelines: be respectful, meet in public, and report anything that feels wrong.</Txt>
          </CheckRow>
        </View>
      </Card>

      <Btn title={a.spotsLeft === 0 ? 'Join the waiting list' : 'Send request'} onPress={submit} loading={act.busy} disabled={!verified || !adult || !agree} />
      <Txt variant="muted" style={{ textAlign: 'center' }}>Chat access opens only after the host approves.</Txt>
    </Screen>
  );
}
