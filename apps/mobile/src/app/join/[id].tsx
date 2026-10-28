import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { CatPhoto } from '@/components/CatPhoto';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { CheckLine } from '@/components/CheckLine';
import { Banner, Btn, Card, CheckRow, Chip, ErrorBanner, Field, Screen, Sheet, Txt, useGo } from '@/components/ui';
import { del, get, post, type Activity } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { clashesWith, type MyActivitiesData } from '@/lib/myActivities';
import { useMe } from '@/lib/auth';
import { catColor, CATS } from '@/lib/constants';
import { hhmm, when } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** HERE · Join request. Chat stays closed until the host approves. */
export default function Join() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const router = useRouter();
  const go = useGo();
  const { data: a, loading } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  const [intro, setIntro] = useState('');
  const [agree, setAgree] = useState(false);
  const act = useAction();

  // Plans the person already has that overlap this one. Joining both stays allowed, but they are asked what they want.
  const mine = useLoad(
    () => (a ? get<MyActivitiesData>(`/v1/me/activities/overlapping?${new URLSearchParams({ from: a.startsAt, to: a.endsAt, exclude: a.id })}`) : Promise.resolve(null)),
    [a?.id, a?.startsAt, a?.endsAt],
    undefined,
    'me:clash',
  );
  const clashes = a ? clashesWith(mine.data, a) : [];
  const [clashOpen, setClashOpen] = useState(false);
  const asked = useRef(false);
  useEffect(() => {
    if (clashes.length && !asked.current) {
      asked.current = true; // asked once when the page opens; the notice below stays
      setClashOpen(true);
    }
  }, [clashes.length]);

  if (loading && !a) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (!a) return <Screen hasHeader><Txt>{t('Activity not found.')}</Txt></Screen>;

  const instant = a.joinPolicy === 'instant' && a.spotsLeft > 0; // a full activity still has a waiting list the host never has to approve
  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';

  // free up the time: leave what they are in, withdraw what they asked for, cancel what they host (asked first)
  const freeUp = async () => {
    for (const x of clashes) {
      if (x.label === 'You host this' && !(await confirmAsync(t('Cancel "{title}"?', { title: x.activity.title }), t('You host it. Everyone who joined is told it is cancelled.'), t('Cancel activity'), true))) return;
    }
    const ok = await act.run(async () => {
      for (const x of clashes) {
        if (x.kind === 'pending') await del(`/v1/activities/${x.activity.id}/requests/mine`);
        else if (x.label === 'You host this') await post(`/v1/activities/${x.activity.id}/cancel`);
        else await post(`/v1/activities/${x.activity.id}/leave`);
      }
      return true;
    });
    if (ok) {
      await mine.reload();
      setClashOpen(false);
    }
  };
  const first = clashes[0];
  const freeLabel = !first ? '' : clashes.length > 1 ? t('Free up my time ({n} plans)', { n: clashes.length }) : first.kind === 'pending' ? t('Withdraw my request for "{title}"', { title: first.activity.title }) : first.label === 'You host this' ? t('Cancel my activity "{title}"', { title: first.activity.title }) : t('Leave "{title}"', { title: first.activity.title });

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
        <Txt variant="muted">{when(a.startsAt)} · {a.venueName} · {t('{going}/{capacity} going', { going: a.going, capacity: a.capacity })}</Txt>
      </View>

      <ErrorBanner message={act.error} />
      {clashes.length > 0 ? (
        <Banner tone="warn" onPress={() => setClashOpen(true)}>
          {clashes.length === 1 ? t('This overlaps with "{title}" ({from} to {to}).', { title: first.activity.title, from: hhmm(first.activity.startsAt), to: hhmm(first.activity.endsAt) }) : t('This overlaps with {n} plans you already have.', { n: clashes.length })} {t('Tap to choose.')}
        </Banner>
      ) : null}
      {a.spotsLeft === 0 ? <Banner tone="warn">{t('This activity is full. You can join the waiting list.')}</Banner> : null}
      {instant ? null : <Field label={t('Introduce yourself to the host')} placeholder={t('Say hi')} multiline value={intro} onChangeText={setIntro} maxLength={500} hint={`${intro.length} / 500`} />}

      <Card style={{ borderRadius: 20, paddingVertical: 6 }}>
        <Txt variant="h3" style={{ fontSize: 18, paddingTop: 8 }}>{t('Before joining')}</Txt>
        <CheckLine ok={adult} text={t('I am at least 18 years old')} />
        <CheckLine ok={verified} text={verified ? t('Identity verified') : t('Identity verification required')} action={!verified ? <Btn title={t('Verify now')} small variant="secondary" onPress={() => go('/verify')} style={{ alignSelf: 'flex-start' }} /> : undefined} />
        <View style={{ paddingVertical: 12 }}>
          <CheckRow checked={agree} onChange={setAgree}>
            <Txt>{t('I agree to the group guidelines: be respectful, meet in public, and report anything that feels wrong.')}</Txt>
          </CheckRow>
        </View>
      </Card>

      <Sheet visible={clashOpen && clashes.length > 0} title={t('This overlaps with a plan you already have')} onClose={() => setClashOpen(false)}>
        {clashes.map((x) => (
          <View key={x.key} style={{ gap: 4 }}>
            <Txt variant="h3" style={{ fontSize: 15 }}>{x.activity.title}</Txt>
            <Txt variant="muted">{t('{from} to {to}', { from: when(x.activity.startsAt), to: hhmm(x.activity.endsAt) })}</Txt>
            <View style={{ flexDirection: 'row' }}><Chip label={t(x.label)} tone={x.tone} /></View>
          </View>
        ))}
        <ErrorBanner message={act.error} />
        <Btn title={freeLabel} onPress={() => void freeUp()} loading={act.busy} />
        <Btn title={t('Don\'t join "{title}"', { title: a.title })} variant="secondary" onPress={() => router.back()} />
        <Btn title={t('Keep both')} variant="ghost" small onPress={() => setClashOpen(false)} />
      </Sheet>

      <Btn title={a.spotsLeft === 0 ? t('Join the waiting list') : instant ? t('Join now') : t('Send request')} onPress={submit} loading={act.busy} disabled={!verified || !adult || !agree} />
    </Screen>
  );
}
