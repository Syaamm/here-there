import { useLocalSearchParams, useRouter } from 'expo-router';
import { SkeletonDetail } from '@/components/Skeleton';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { type TextInput, View } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Btn, Card, CheckRow, ErrorBanner, Field, Pill, PillRow, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { EXPERIENCE } from '@/lib/constants';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { CheckLine } from '@/components/CheckLine';
import { ClashNotice, useClashes } from '@/components/ClashNotice';
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
  const introRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  // One plan at a time: a trip or activity you are in on these days blocks applying (a trip holds its whole days)
  const clash = useClashes(trip?.dateStart, trip ? new Date(+new Date(trip.dateEnd) + 864e5) : null, trip ? `trip:${trip.id}` : undefined);

  if (loading && !trip) return <Screen hasHeader><SkeletonDetail /></Screen>;
  if (!trip) return <Screen hasHeader><Txt>{t('Trip not found.')}</Txt></Screen>;

  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';
  // Send stays grey until the three boxes are ticked (and the person is 18+ and verified, with nothing clashing); then it
  // turns green. The introduction is not part of that: tapping Send without one simply takes you to its box.
  const ready = budgetOk && datesOk && guidelines && adult && verified && clash.firm.length === 0;

  const submit = async () => {
    if (intro.trim().length < 10) {
      // no message: the page scrolls to the introduction and opens the keyboard there
      introRef.current?.focus();
      return;
    }
    const r = await act.run(() => post(`/v1/trips/${id}/applications`, { intro: intro.trim(), experience: exp, confirmBudget: true, confirmDates: true, confirmGuidelines: true }));
    if (r) appAlert(t('Application sent'), t("The organizer will review it. You'll get a notification with their decision."), [{ text: t('OK'), onPress: () => router.back() }], { cancelable: false });
    else void clash.reload(); // refused because of a clash: show what is in the way
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
      <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="apply" onChanged={() => void clash.reload()} />
      <Field inputRef={introRef} label={t('Introduce yourself to the organizer')} placeholder={t("Hello! I'd love to join.")} multiline value={intro} onChangeText={setIntro} maxLength={1000} />
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

      {/* grey until ready, then green; no list of what is missing and no fine print under it */}
      <Btn title={t('Send application')} variant={ready ? 'accent' : 'off'} onPress={() => void submit()} loading={act.busy} disabled={!ready} />
    </Screen>
  );
}
