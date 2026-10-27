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
  if (!a) return <Screen hasHeader><Txt>Activity not found.</Txt></Screen>;

  const instant = a.joinPolicy === 'instant' && a.spotsLeft > 0; // a full activity still has a waiting list the host never has to approve
  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';

  // free up the time: leave what they are in, withdraw what they asked for, cancel what they host (asked first)
  const freeUp = async () => {
    for (const x of clashes) {
      if (x.label === 'You host this' && !(await confirmAsync(`Cancel "${x.activity.title}"?`, 'You host it. Everyone who joined is told it is cancelled.', 'Cancel activity', true))) return;
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
  const freeLabel = !first ? '' : clashes.length > 1 ? `Free up my time (${clashes.length} plans)` : first.kind === 'pending' ? `Withdraw my request for "${first.activity.title}"` : first.label === 'You host this' ? `Cancel my activity "${first.activity.title}"` : `Leave "${first.activity.title}"`;

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
      {clashes.length > 0 ? (
        <Banner tone="warn" onPress={() => setClashOpen(true)}>
          {clashes.length === 1 ? `This overlaps with "${first.activity.title}" (${hhmm(first.activity.startsAt)} to ${hhmm(first.activity.endsAt)}).` : `This overlaps with ${clashes.length} plans you already have.`} Tap to choose.
        </Banner>
      ) : null}
      {a.spotsLeft === 0 ? <Banner tone="warn">This activity is full. Join the waiting list: if a place opens up, the first person in line is let in automatically and told straight away.</Banner> : null}
      {instant ? null : <Field label="Introduce yourself to the host" placeholder="Hi! I'm new to town and would love to join." multiline value={intro} onChangeText={setIntro} maxLength={500} hint={`${intro.length} / 500`} />}

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

      <Sheet visible={clashOpen && clashes.length > 0} title="This overlaps with a plan you already have" onClose={() => setClashOpen(false)}>
        {clashes.map((x) => (
          <View key={x.key} style={{ gap: 4 }}>
            <Txt variant="h3" style={{ fontSize: 15 }}>{x.activity.title}</Txt>
            <Txt variant="muted">{when(x.activity.startsAt)} to {hhmm(x.activity.endsAt)}</Txt>
            <View style={{ flexDirection: 'row' }}><Chip label={x.label} tone={x.tone} /></View>
          </View>
        ))}
        <Txt variant="small">"{a.title}" runs {hhmm(a.startsAt)} to {hhmm(a.endsAt)}. You can't be at both. What would you like to do?</Txt>
        <ErrorBanner message={act.error} />
        <Btn title={freeLabel} onPress={() => void freeUp()} loading={act.busy} />
        <Btn title={`Don't join "${a.title}"`} variant="secondary" onPress={() => router.back()} />
        <Btn title="Keep both" variant="ghost" small onPress={() => setClashOpen(false)} />
      </Sheet>

      <Btn title={a.spotsLeft === 0 ? 'Join the waiting list' : instant ? 'Join now' : 'Send request'} onPress={submit} loading={act.busy} disabled={!verified || !adult || !agree} />
      <Txt variant="muted" style={{ textAlign: 'center' }}>{instant ? 'You join straight away and can chat with the group. The host can still remove anyone.' : 'Chat access opens only after the host approves.'}</Txt>
    </Screen>
  );
}
