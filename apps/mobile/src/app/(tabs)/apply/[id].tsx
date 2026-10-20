import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Btn, Card, CheckRow, ErrorBanner, Field, Pill, PillRow, Screen, Spinner, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { EXPERIENCE } from '@/lib/constants';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, money } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { CheckLine } from '@/components/CheckLine';

/** THERE · Application. Structured so the organizer can decide; no payment, no documents. */
export default function Apply() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useMe();
  const router = useRouter();
  const go = useGo();
  const { data: t, loading } = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id]);
  const [intro, setIntro] = useState('');
  const [exp, setExp] = useState('intermediate');
  const [budgetOk, setBudgetOk] = useState(false);
  const [datesOk, setDatesOk] = useState(false);
  const [guidelines, setGuidelines] = useState(false);
  const act = useAction();

  if (loading && !t) return <Screen hasHeader><Spinner /></Screen>;
  if (!t) return <Screen hasHeader><Txt>Trip not found.</Txt></Screen>;

  const adult = !!me?.adultConfirmed;
  const verified = me?.eligibility === 'verified';
  const ready = verified && adult && intro.trim().length >= 10 && budgetOk && datesOk && guidelines;

  const submit = async () => {
    const r = await act.run(() => post(`/v1/trips/${id}/applications`, { intro: intro.trim(), experience: exp, confirmBudget: true, confirmDates: true, confirmGuidelines: true }));
    if (r) {
      await confirmAsync('Application sent', "The organizer will review it. You'll get a notification with their decision.", 'OK');
      router.back();
    }
  };

  return (
    <Screen hasHeader>
      <Card>
        <Txt variant="h3">{t.title}</Txt>
        <Txt variant="small">{dateSpan(t.dateStart, t.dateEnd)} · {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} pp (estimate) · {t.members}/{t.maxCapacity} travelers</Txt>
      </Card>
      <ErrorBanner message={act.error} />
      <Field label="Introduce yourself to the organizer" placeholder="Hello! I'd love to join. I enjoy culture, local food and exploring a city on foot." multiline value={intro} onChangeText={setIntro} maxLength={1000} hint={intro.trim().length < 10 ? 'At least 10 characters' : `${intro.length}/1000`} />
      <Txt variant="label">Your travel experience</Txt>
      <PillRow>
        {EXPERIENCE.map(([v, l]) => (
          <Pill key={v} label={l} active={exp === v} onPress={() => setExp(v)} />
        ))}
      </PillRow>

      <Card>
        <Txt variant="h3">Before sending</Txt>
        <CheckLine ok={adult} text="I am at least 18 years old" />
        <CheckLine ok={verified} text={verified ? 'Identity verified' : 'Identity verification required'} action={!verified ? <Btn title="Verify now" small variant="secondary" onPress={() => go('/verify')} style={{ alignSelf: 'flex-start' }} /> : undefined} />
        <CheckRow checked={budgetOk} onChange={setBudgetOk}>
          <Txt variant="h3">My budget is compatible</Txt>
          <Txt variant="small">I understand this is an estimate.</Txt>
        </CheckRow>
        <CheckRow checked={datesOk} onChange={setDatesOk}>
          <Txt variant="h3">I can travel within the date window</Txt>
          <Txt variant="small">No booking commitment.</Txt>
        </CheckRow>
        <CheckRow checked={guidelines} onChange={setGuidelines}>
          <Txt variant="h3">I agree to the group guidelines</Txt>
          <Txt variant="small">Adults only, verified participants.</Txt>
        </CheckRow>
      </Card>

      <Btn title="Send application" onPress={submit} loading={act.busy} disabled={!ready} />
      <Banner>Actual membership requires organizer approval. Don't send money or documents to anyone through the app.</Banner>
    </Screen>
  );
}
