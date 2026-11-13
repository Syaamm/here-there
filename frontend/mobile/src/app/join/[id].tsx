import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import { CatPhoto } from '@/components/CatPhoto';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { CheckLine } from '@/components/CheckLine';
import { AuthCheck, AuthField } from '@/components/AuthForm';
import { PillButton } from '@/components/ActivityParts';
import { ClashNotice, tellWithdrawn, useClashes, type Withdrawn } from '@/components/ClashNotice';
import { Banner, Btn, ErrorBanner, Screen, Txt, useGo } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { get, post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { when } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

import { sc, sp, sph } from '@/lib/scale';
/** HERE · Join request. Chat stays closed until the host approves. */
export default function Join() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const router = useRouter();
  const go = useGo();
  const { c } = useTheme();
  const { data: a, loading } = useLoad(() => get<Activity>(`/v1/activities/${id}`), [id], undefined, 'activity', { animate: true });
  const [intro, setIntro] = useState('');
  const [agree, setAgree] = useState(false);
  const act = useAction();

  // One plan at a time: a plan you host or joined at the same time blocks joining; requests still waiting only get a note.
  const clash = useClashes(a?.startsAt, a?.endsAt, a ? `activity:${a.id}` : undefined);

  if (loading && !a) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (!a) return <Screen hasHeader><Txt>{t('Activity not found.')}</Txt></Screen>;

  const instant = a.joinPolicy === 'instant' && a.spotsLeft > 0; // a full activity still has a waiting list the host never has to approve
  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';

  const submit = async () => {
    const r = await act.run(() => post<{ state: string; withdrawn?: Withdrawn[] }>(`/v1/activities/${id}/requests`, { intro: intro.trim() || undefined }));
    // an instant join that won over other requests of yours at the same time says so before going back
    if (r) await tellWithdrawn(r.withdrawn, t("You're in!"));
    if (r) router.back();
    else void clash.reload(); // refused because of a clash: show what is in the way
  };

  return (
    <Screen hasHeader>
      {/* cover block: a stand-in for the activity photo */}
      <CatPhoto category={a.category} style={{ height: sc(190), borderRadius: sc(28) }} />
      <View>
        <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700' }}>{a.title}</Text>
        <Txt variant="muted">{when(a.startsAt)} · {a.venueName} · {t('{going}/{capacity} going', { going: a.going, capacity: a.capacity })}</Txt>
      </View>

      <ErrorBanner message={act.error} />
      <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="join" onChanged={() => void clash.reload()} />
      {a.spotsLeft === 0 ? <Banner tone="warn">{t('This activity is full. You can join the waiting list.')}</Banner> : null}
      {instant ? null : <AuthField label={t('Introduce yourself to the host')} placeholder={t('Say hi')} multiline value={intro} onChangeText={setIntro} maxLength={500} hint={`${intro.length}/500`} />}

      <View style={{ backgroundColor: c.surface, borderRadius: sc(24), borderWidth: 1, borderColor: c.line, paddingHorizontal: sph(16), paddingVertical: sp(8) }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '600', paddingTop: sp(8) }}>{t('Before joining')}</Text>
        <CheckLine ok={adult} text={t('I am at least 18 years old')} />
        <CheckLine ok={verified} text={verified ? t('Identity verified') : t('Identity verification required')} action={!verified ? <Btn title={t('Verify now')} small variant="secondary" onPress={() => go('/verify')} style={{ alignSelf: 'flex-start' }} /> : undefined} />
        <AuthCheck checked={agree} onChange={setAgree} label={t('I agree to the group guidelines: be respectful, meet in public, and report anything that feels wrong.')} />
      </View>

      <PillButton title={a.spotsLeft === 0 ? t('Join the waiting list') : instant ? t('Join now') : t('Send request')} onPress={submit} loading={act.busy} disabled={!verified || !adult || !agree || clash.firm.length > 0} />
    </Screen>
  );
}
