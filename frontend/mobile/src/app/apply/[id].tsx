import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { View } from 'react-native';
import { Banner, Btn, Card, CheckRow, ErrorBanner, Field, Pill, PillRow, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { EXPERIENCE } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { CheckLine } from '@/components/CheckLine';
import { useT } from '@/lib/i18n';

/** THERE · Application. Structured so the organizer can decide; no payment, no documents. */
export default function Apply() {
  const { t } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const router = useRouter();
  const { c } = useTheme();
  const go = useGo();
  const { data: trip, loading } = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip');
  const [intro, setIntro] = useState('');
  const [exp, setExp] = useState('intermediate');
  const [budgetOk, setBudgetOk] = useState(false);
  const [datesOk, setDatesOk] = useState(false);
  const [guidelines, setGuidelines] = useState(false);
  const act = useAction();
  const [tried, setTried] = useState(false); // after the first tap on Send: show what is still missing

  if (loading && !trip) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (!trip) return <Screen hasHeader><Txt>{t('Trip not found.')}</Txt></Screen>;

  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';
  // everything still missing, so the button can say so instead of just sitting there greyed out
  const problems = [
    !adult && t('confirm you are 18 or older'),
    !verified && t('verify your identity'),
    intro.trim().length < 10 && t('write a short introduction (at least 10 characters)'),
    !budgetOk && t('tick "My budget is compatible"'),
    !datesOk && t('tick "I can travel within the date window"'),
    !guidelines && t('tick "I agree to the group guidelines"'),
  ].filter(Boolean) as string[];

  const submit = async () => {
    const r = await act.run(() => post(`/v1/trips/${id}/applications`, { intro: intro.trim(), experience: exp, confirmBudget: true, confirmDates: true, confirmGuidelines: true }));
    if (r) {
      await confirmAsync(t('Application sent'), t("The organizer will review it. You'll get a notification with their decision."), t('OK'));
      router.back();
    }
  };

  return (
    <Screen hasHeader>
      {/* cover block: a stand-in for the trip photo, as in an activity request */}
      <View accessibilityElementsHidden importantForAccessibility="no" style={{ height: 190, borderRadius: 24, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="airplane" size={56} color={c.forest} />
      </View>
      <View>
        <Txt variant="h1" style={{ fontSize: 30, lineHeight: 36 }}>{trip.title}</Txt>
        <Txt variant="muted">{dateSpan(trip.dateStart, trip.dateEnd)} · {money(trip.budget.min, trip.budget.currency)}–{money(trip.budget.max, trip.budget.currency)} {t('pp (estimate)')} · {t('{going}/{capacity} going', { going: trip.members, capacity: trip.maxCapacity })}</Txt>
      </View>
      <ErrorBanner message={act.error} />
      <Field label={t('Introduce yourself to the organizer')} placeholder={t("Hello! I'd love to join.")} multiline value={intro} onChangeText={setIntro} maxLength={1000} hint={intro.trim().length < 10 ? t('At least 10 characters') : `${intro.length}/1000`} error={tried && intro.trim().length < 10 ? t('Write at least 10 characters') : null} />
      <Txt variant="label">{t('Your travel experience')}</Txt>
      <PillRow>
        {EXPERIENCE.map(([v, l]) => (
          <Pill key={v} label={t(l)} active={exp === v} onPress={() => setExp(v)} />
        ))}
      </PillRow>

      <Card style={{ borderRadius: 20, paddingVertical: 6 }}>
        <Txt variant="h3" style={{ fontSize: 18, paddingTop: 8 }}>{t('Before sending')}</Txt>
        <CheckLine ok={adult} text={t('I am at least 18 years old')} />
        <CheckLine ok={verified} text={verified ? t('Identity verified') : t('Identity verification required')} action={!verified ? <Btn title={t('Verify now')} small variant="secondary" onPress={() => go('/verify')} style={{ alignSelf: 'flex-start' }} /> : undefined} />
        <CheckRow checked={budgetOk} onChange={setBudgetOk}>
          <Txt variant="h3">{t('My budget is compatible')}</Txt>
          <Txt variant="small">{t('I understand this is an estimate.')}</Txt>
        </CheckRow>
        <CheckRow checked={datesOk} onChange={setDatesOk}>
          <Txt variant="h3">{t('I can travel within the date window')}</Txt>
          <Txt variant="small">{t('No booking commitment.')}</Txt>
        </CheckRow>
        <CheckRow checked={guidelines} onChange={setGuidelines}>
          <Txt variant="h3">{t('I agree to the group guidelines')}</Txt>
        </CheckRow>
      </Card>

      {tried && problems.length ? <Banner tone="bad">{t('Before you can send: {list}.', { list: problems.join(', ') })}</Banner> : null}
      <Btn title={t('Send application')} onPress={() => (problems.length ? setTried(true) : void submit())} loading={act.busy} />
      <Banner>{t("Actual membership requires organizer approval. Don't send money or documents to anyone through the app.")}</Banner>
    </Screen>
  );
}
