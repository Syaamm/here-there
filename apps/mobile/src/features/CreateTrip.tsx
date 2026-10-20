import { useState } from 'react';
import { View } from 'react-native';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Btn, Card, CheckRow, ErrorBanner, Field, Pill, PillRow, Row, Screen, Txt, useGo } from '@/components/ui';
import { post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { isoDay, money, parseDay } from '@/lib/format';
import { useAction } from '@/lib/hooks';

const STEPS = ['Destination', 'Dates', 'Style & budget', 'Publish'];

/** THERE · Create: four-step wizard. A trip is a proposal, never a booking or an offer to sell travel. */
export function CreateTrip() {
  const { me } = useMe();
  const go = useGo();
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ destination: '', originCity: me?.profile?.homeCity ?? '', description: '', start: '', end: '', flex: 'plus_minus_3', min: '', max: '', transport: true, tags: [] as string[], size: '4-6' });
  const [agree, setAgree] = useState(false);
  const act = useAction();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const start = parseDay(f.start);
  const end = parseDay(f.end);
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const min = Number(f.min);
  const max = Number(f.max);

  const errors = {
    0: f.destination.trim().length < 2 ? 'Add a destination.' : f.originCity.trim().length < 2 ? 'Add your departure city.' : null,
    1: !start || !end ? 'Enter both dates as YYYY-MM-DD.' : start < tomorrow ? 'The trip must start in the future.' : end < start ? 'The end date is before the start date.' : (+end - +start) / 864e5 > 90 ? 'Trips can span at most 90 days.' : null,
    2: !f.min || !f.max || Number.isNaN(min) || Number.isNaN(max) ? 'Enter a budget range.' : max < min ? 'The maximum is lower than the minimum.' : null,
    3: !agree ? 'Please confirm the guidelines.' : null,
  } as const;
  const stepError = errors[step as 0 | 1 | 2 | 3];
  const verified = me?.eligibility === 'verified';

  const publish = async () => {
    if (!start || !end) return;
    const t = await act.run(() =>
      post<Trip>('/v1/trips', {
        destination: f.destination.trim(),
        originCity: f.originCity.trim(),
        description: f.description.trim() || undefined,
        dateStart: start.toISOString(),
        dateEnd: end.toISOString(),
        dateFlexibility: f.flex,
        budgetCurrency: 'EUR',
        budgetMin: Math.floor(min),
        budgetMax: Math.floor(max),
        budgetIncludesTransport: f.transport,
        tags: f.tags,
        groupSize: f.size,
      }),
    );
    if (t) go(`/trip/${t.id}`);
  };

  return (
    <Screen tabBar>
      <TabHeader />
      <Txt variant="h1">Propose a trip</Txt>
      <Row>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i <= step ? '#2F7D65' : '#D9D5CB' }} />
        ))}
      </Row>
      <Txt variant="muted">Step {step + 1} of 4 · {STEPS[step]}</Txt>

      {!verified && <Banner onPress={() => go('/verify')}>You need a verified identity to publish a trip. You can prepare it now. Verify ›</Banner>}
      <ErrorBanner message={act.error} />

      {step === 0 && (
        <>
          <Txt variant="h2">Where are we going?</Txt>
          <Field label="Destination *" placeholder="Tokyo & Kyoto, Japan" value={f.destination} onChangeText={(v) => set('destination', v)} maxLength={100} />
          <Field label="Your departure city *" placeholder="Milan" value={f.originCity} onChangeText={(v) => set('originCity', v)} maxLength={60} hint="Other travelers can leave from different cities." />
          <Field label="Trip description" placeholder="Culture, food, city walks and local experiences." multiline value={f.description} onChangeText={(v) => set('description', v)} maxLength={2000} />
        </>
      )}

      {step === 1 && (
        <>
          <Txt variant="h2">When?</Txt>
          <Field label="Start date *" placeholder="YYYY-MM-DD" value={f.start} onChangeText={(v) => set('start', v)} keyboardType="numbers-and-punctuation" hint={`Earliest: ${isoDay(tomorrow)}`} />
          <Field label="End date *" placeholder="YYYY-MM-DD" value={f.end} onChangeText={(v) => set('end', v)} keyboardType="numbers-and-punctuation" />
          <Txt variant="label">How flexible are the dates?</Txt>
          <PillRow>
            {FLEX.map(([v, l]) => (
              <Pill key={v} label={l} active={f.flex === v} onPress={() => set('flex', v)} />
            ))}
          </PillRow>
          <Txt variant="small">Dates are tentative until every approved member confirms them.</Txt>
        </>
      )}

      {step === 2 && (
        <>
          <Txt variant="h2">Style and budget</Txt>
          <Row>
            <View style={{ flex: 1 }}>
              <Field label="Budget from (€) *" value={f.min} onChangeText={(v) => set('min', v)} keyboardType="number-pad" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="to (€) *" value={f.max} onChangeText={(v) => set('max', v)} keyboardType="number-pad" />
            </View>
          </Row>
          <Txt variant="label">This estimate covers</Txt>
          <PillRow>
            <Pill label="Total incl. travel" active={f.transport} onPress={() => set('transport', true)} />
            <Pill label="Destination only" active={!f.transport} onPress={() => set('transport', false)} />
          </PillRow>
          <Txt variant="small">Shown to others as an estimate per person, never as a price or a quote.</Txt>
          <Txt variant="label">Travel interests</Txt>
          <PillRow>
            {TRIP_TAGS.map((t) => (
              <Pill key={t} label={t[0].toUpperCase() + t.slice(1)} active={f.tags.includes(t)} onPress={() => set('tags', f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t])} />
            ))}
          </PillRow>
          <Txt variant="label">Group size (including you)</Txt>
          <PillRow>
            {GROUP_SIZES.map(([v, l]) => (
              <Pill key={v} label={l} active={f.size === v} onPress={() => set('size', v)} />
            ))}
          </PillRow>
        </>
      )}

      {step === 3 && (
        <>
          <Txt variant="h2">Review and publish</Txt>
          <Card>
            <Txt variant="h3">{f.destination}</Txt>
            <Txt variant="muted">From {f.originCity} · {f.start} to {f.end} ({FLEX.find(([v]) => v === f.flex)?.[1]})</Txt>
            <Txt>{money(min || 0, 'EUR')}–{money(max || 0, 'EUR')} per person · {f.transport ? 'incl. travel' : 'destination only'}</Txt>
            <Txt variant="muted">{GROUP_SIZES.find(([v]) => v === f.size)?.[1]} · {f.tags.join(', ') || 'no interests selected'}</Txt>
          </Card>
          <Banner tone="warn">THERE is not a travel agency. Everyone books flights, stays and activities themselves, directly with suppliers. Never ask for or send deposits.</Banner>
          <CheckRow checked={agree} onChange={setAgree}>
            <Txt>I confirm this is a non-commercial proposal for adults and I agree to the group guidelines.</Txt>
          </CheckRow>
        </>
      )}

      {stepError && step < 3 && (f.destination || f.start || f.min) ? <Txt variant="small" color="#A8402D">{stepError}</Txt> : null}
      <Row>
        {step > 0 && <Btn title="Back" variant="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} />}
        {step < 3 ? (
          <Btn title="Continue" onPress={() => setStep(step + 1)} disabled={!!stepError} style={{ flex: 1 }} />
        ) : (
          <Btn title="Publish trip" onPress={publish} loading={act.busy} disabled={!!stepError} style={{ flex: 1 }} />
        )}
      </Row>
    </Screen>
  );
}
