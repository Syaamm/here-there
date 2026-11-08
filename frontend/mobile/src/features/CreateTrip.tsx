import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, View, type HostInstance } from 'react-native';
import { AuthButton } from '@/components/AuthForm';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { DraftBar } from '@/components/DraftBar';
import { WizardActions } from '@/components/CreateParts';
import { ClashNotice, tellWithdrawn, useClashes, type Withdrawn } from '@/components/ClashNotice';
import { Text, TextInput, type InputHandle } from '@/components/ScaledText';
import { StepTransition } from '@/components/StepMotion';
import { DestinationResults, TRIP_WHITE, TripAmount, TripCard, TripField, TripHeading, TripInput, TripLabel, TripPill, TripRoundDark, TripTop, TripValue } from '@/components/TripCreateParts';
import { Banner, CheckRow, Chip, ErrorBanner, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { FLEX } from '@/lib/constants';
import { money, parseDay } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { dropDraft } from '@/lib/drafts';
import { useFormDraft } from '@/lib/formDraft';
import { success, tap } from '@/lib/haptics';
import { closeKeyboard } from '@/lib/keyboard';
import { scrollToField } from '@/lib/pageScroll';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const STEPS = 4;
/** The four date choices. */
const FLEX_CHOICES: readonly (readonly [string, string])[] = [
  ['exact', 'Exact'],
  ['plus_minus_1', '±1 day'],
  ['plus_minus_3', '±3 days'],
  ['plus_minus_7', '±1 wk'],
];
const GROUP_CHOICES: readonly (readonly [string, string])[] = GROUP_SIZES.map(([v]) => [v, v === '10+' ? '10 - 20' : v.replace('-', ' - ')] as const);

type Draft = { destination: string; originCity: string; description: string; start: string; end: string; flex: string; min: string; max: string; transport: boolean; tags: string[]; size: string };

/** A bordered tile with a small label above the value, like the route and date boxes (also used by the trip search). */
export function Tile({ label, children, style }: { label: string; children: ReactNode; style?: object }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View style={[{ borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.surface, paddingHorizontal: 10, paddingVertical: 6, gap: 0 }, style]}>
      <Text style={{ color: c.muted, fontSize: 10 }}>{t(label)}</Text>
      {children}
    </View>
  );
}

/** Something has been entered by the person (the origin city is filled in for them, and the other choices start with a value, so they do not count). */
const hasContent = (f: Draft) => !!(f.destination.trim() || f.description.trim() || f.start || f.end || f.min || f.max || f.tags.length);

const cap = (tag: string) => tag[0].toUpperCase() + tag.slice(1);

/**
 * THERE · Create: four short steps (Destination & Vibe, Budget & Preferences, Group guidelines, Review & publish). A trip is a
 * proposal, never a booking or an offer to sell travel. It behaves like the HERE form: leaving it for another tab or page keeps
 * it as it was, and leaving the app saves it as a draft. Changing `round` remounts the form, which is what empties it.
 */
export function CreateTrip() {
  const [round, setRound] = useState(0);
  return <TripForm key={round} onReset={() => setRound((r) => r + 1)} />;
}

function TripForm({ onReset }: { onReset: () => void }) {
  const { t, tn } = useT();
  const { me } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const [step, setStep] = useState(0);
  useEffect(() => Keyboard.dismiss(), [step]); // a new step starts with the keyboard down
  const destRef = useRef<InputHandle>(null);
  const maxRef = useRef<InputHandle>(null);
  const aboutRef = useRef<InputHandle>(null);
  const [f, setF] = useState<Draft>({ destination: '', originCity: me?.profile?.homeCity ?? '', description: '', start: '', end: '', flex: 'plus_minus_3', min: '', max: '', transport: true, tags: [], size: '4-6' });
  const [agree, setAgree] = useState(false);
  const [tried, setTried] = useState(false);
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const [destFocus, setDestFocus] = useState(false); // the destination field has the cursor
  const [destTyped, setDestTyped] = useState(false); // and its text was changed since: only then are suggestions looked up (tapping it again, or a place just picked, shows none)
  const act = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const loadDraft = useCallback((d: Record<string, unknown>) => setF((p) => ({ ...p, ...(d as Partial<Draft>) })), []);
  // saving a draft when the app is left, "Clear all", and starting over after publishing: shared with the activity form
  const { posted, clearAll, stashNow, restart } = useFormDraft('trip', f, hasContent, onReset);

  const start = parseDay(f.start);
  const end = parseDay(f.end);
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const min = Number(f.min);
  const max = Number(f.max);
  const nights = start && end ? Math.round((+end - +start) / 864e5) : null;
  // how far ahead trips from this city may be planned: set by the admin of its place (six months unless they set it otherwise)
  const limits = useLoad(() => get<{ there: { months: number; latest: string } }>(`/v1/regions/limits?city=${encodeURIComponent(f.originCity.trim())}`), [f.originCity.trim()]);
  const lastDay = limits.data ? new Date(limits.data.there.latest) : lastPlanningDay(6);
  const monthsAhead = limits.data?.there.months ?? 6;

  // what is still missing, so a button can say so instead of sitting there greyed out
  const routeProblems = [
    f.originCity.trim().length < 2 && t('where you leave from'),
    f.destination.trim().length < 2 && t('a destination'),
    !start && t('a departure date'),
    !!start && !end && t('a return date'),
    !!start && start < tomorrow && t('a departure from tomorrow on'),
    (nights ?? 0) > 90 && t('a trip of at most 90 nights'),
    ((!!start && start > lastDay) || (!!end && end > lastDay)) && tn(monthsAhead, 'dates within the next month', 'dates within the next {n} months'),
  ].filter(Boolean) as string[];
  const budgetProblems = [
    (!f.min || !f.max || Number.isNaN(min) || Number.isNaN(max)) && t('a budget range'),
    !Number.isNaN(min) && !Number.isNaN(max) && !!f.min && !!f.max && max <= min && t('a maximum budget higher than the minimum'),
  ].filter(Boolean) as string[];
  // one plan at a time: a trip or activity you are in on these days blocks the trip (it holds its whole days)
  const clash = useClashes(start, start && end && end >= start ? new Date(+end + 864e5) : null);
  const busy = clash.firm.length > 0;
  const publishProblems = [...routeProblems, ...budgetProblems, !agree && t('the guidelines ticked')].filter(Boolean) as string[];
  const verified = me?.eligibility === 'verified';

  // what is missing is shown to the person (scrolled to, marked red), with no message
  const originBox = useRef<HostInstance>(null);
  const destBox = useRef<HostInstance>(null);
  const startBox = useRef<HostInstance>(null);
  const endBox = useRef<HostInstance>(null);
  const budgetBox = useRef<HostInstance>(null);
  const agreeBox = useRef<HostInstance>(null);
  const originBad = f.originCity.trim().length < 2;
  const destBad = f.destination.trim().length < 2;
  const startBad = !start || start < tomorrow || (!!start && start > lastDay) || (nights ?? 0) > 90;
  const endBad = !!start && (!end || (!!end && end > lastDay));
  const refFor = (at: number) => (at === 0 ? (originBad ? originBox : destBad ? destBox : startBad || busy ? startBox : endBox) : at === 1 ? budgetBox : agreeBox);
  const showProblem = (at: number) => {
    closeKeyboard();
    tap('Medium');
    if (at !== step) {
      setStep(at);
      setTimeout(() => (setTried(true), scrollToField(refFor(at))), 350);
    } else {
      setTried(true);
      setTimeout(() => scrollToField(refFor(at)), 60);
    }
  };
  const next = () => {
    if (step === 0 && (routeProblems.length || busy)) return showProblem(0);
    if (step === 1 && budgetProblems.length) return showProblem(1);
    if (step === 2 && !agree) return showProblem(2);
    setTried(false);
    setStep(step + 1);
  };
  // a step can be opened once every step before it is done (going back is always fine)
  const stepOk = [!routeProblems.length && !busy, !budgetProblems.length, agree];
  const canStep = (i: number) => i < step || stepOk.slice(0, i).every(Boolean);
  const jump = (i: number) => {
    setTried(false);
    setStep(i);
  };
  // the keyboard's return key on a step's last field: on to the next step if this one is done, else just put the keyboard away
  // Android's Back button on a later step goes one step back, not out of the form
  useEffect(() => {
    if (Platform.OS !== 'android' || step === 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setTried(false), setStep(step - 1), true));
    return () => sub.remove();
  }, [step]);
  const nextFromKeyboard = () => (step < STEPS - 1 ? next() : Keyboard.dismiss());
  const back = () => {
    if (step > 0) {
      setTried(false);
      setStep(step - 1);
    } else go('/');
  };

  const publish = async () => {
    if (publishProblems.length || !start || !end || busy) return showProblem(routeProblems.length || busy ? 0 : budgetProblems.length ? 1 : 2);
    const created = await act.run(() =>
      post<Trip & { withdrawn?: Withdrawn[] }>('/v1/trips', {
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
    if (created) {
      posted.current = true;
      success();
      void dropDraft('trip', f);
      await tellWithdrawn(created.withdrawn, t('Your trip is live'));
      go(`/trip/${created.id}`);
    } else void clash.reload(); // refused because of a clash: show what is in the way
  };

  const stepNames = [t('Destination & Vibe'), t('Budget & Preferences'), t('Travel Preferences'), t('Review & publish')];
  const flexLabel = t(FLEX.find(([v]) => v === f.flex)?.[1] ?? '');
  const groupLabel = t(GROUP_SIZES.find(([v]) => v === f.size)?.[1] ?? '');
  const dayText = (d: Date | null) => (d ? `${shortDay(d)}, ${d.getFullYear()}` : '');
  const budgetBad = (k: 'min' | 'max') => tried && step === 1 && (!f[k] || (k === 'max' && !!f.min && max <= min));

  const dateField = (k: 'start' | 'end') => {
    const d = k === 'start' ? start : end;
    const label = k === 'start' ? t('Departure date') : t('Return date');
    return (
      <View key={k} ref={k === 'start' ? startBox : endBox} collapsable={false}>
        <TripField
          label={label}
          invalid={tried && step === 0 && (k === 'start' ? startBad || busy : endBad)}
          onPress={() => setCalendar(k)}
          a11y={t('{kind} date: {day}. Opens a calendar', { kind: k === 'start' ? t('Depart') : t('Return'), day: d ? shortDay(d) : t('not chosen') })}
        >
          <TripValue placeholder={t('Select date')}>{dayText(d)}</TripValue>
        </TripField>
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen tabBar plain header={
    <TripTop
      step={step}
      title={stepNames[step]}
      onBack={back}
      onStep={jump}
      canStep={canStep}
      right={<WizardActions canRestart={step > 0 || hasContent(f)} onRestart={() => void restart()} canClear={hasContent(f)} onClear={() => void clearAll()} />}
    />
      }>

        {/* swipe left for the next step (once this one is done), right for the one before; it stops at the last step */}
        <StepTransition step={step} style={{ gap: 16 }} swipe={{ canNext: step < 3 && !!stepOk[step], canBack: step > 0, onNext: next, onBack: () => jump(step - 1) }}>
        {step === 0 && (
          <>
            <TripHeading title={t('Where do you want to go?')} subtitle={t('Choose where you leave from and where you are heading, then the dates.')} />
            {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
            <TripLabel style={{ marginTop: 8 }}>{t('Route')}</TripLabel>
            <View style={{ gap: 4 }}>
              <View ref={originBox} collapsable={false}>
              <TripField label={t('Departing from')} invalid={tried && step === 0 && originBad}>
                <TripInput label={t('Departing from')} autoCapitalize="words" placeholder={t('Milan, Italy')} value={f.originCity} onChangeText={(v) => set('originCity', v)} maxLength={60} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => destRef.current?.focus()} />
              </TripField>
              </View>
              <View ref={destBox} collapsable={false}>
              <TripField label={t('Destination')} invalid={tried && step === 0 && destBad}>
                <TripInput ref={destRef} label={t('Destination')} autoCapitalize="words" placeholder={t('Tokyo & Kyoto, Japan')} value={f.destination} onChangeText={(v) => { set('destination', v); setDestTyped(true); }} onFocus={() => { setDestFocus(true); setDestTyped(false); }} onBlur={() => setTimeout(() => setDestFocus(false), 200)} maxLength={100} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => (start && end ? nextFromKeyboard() : (Keyboard.dismiss(), setCalendar(start ? 'end' : 'start')))} />
              </TripField>
              </View>
            </View>

            {/* any place in the world, named with its country ("Milan, Italy", "Kerala, India"): tap one to use it */}
            <DestinationResults text={f.destination} active={destFocus && destTyped} onPick={(label) => { set('destination', label); setDestTyped(false); Keyboard.dismiss(); }} />

            <TripLabel style={{ marginTop: 14 }} right={nights !== null && nights >= 0 ? tn(nights, '{n} night', '{n} nights') : undefined}>{t('When would you like to go?')}</TripLabel>
            <View style={{ gap: 4 }}>
              {dateField('start')}
              {dateField('end')}
              <View style={{ position: 'absolute', right: 12, top: '50%', marginTop: -22 }}>
                <TripRoundDark icon="calendar-outline" label={t('Open the calendar')} onPress={() => setCalendar('start')} />
              </View>
            </View>
            <TripLabel style={{ marginTop: 10 }}>{t('How flexible are your dates?')}</TripLabel>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('How flexible are your dates?')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {FLEX_CHOICES.map(([v, l]) => (
                <TripPill key={v} label={t(l)} active={f.flex === v} onPress={() => set('flex', v)} />
              ))}
            </View>
            <ErrorBanner message={act.error} />
          </>
        )}

        {step === 1 && (
          <>
            <TripHeading title={t('What kind of trip are you planning?')} subtitle={t('Set a budget range per person, what it covers and how big the group should be.')} />
            <TripLabel style={{ marginTop: 10 }}>{t('Budget per person')}</TripLabel>
            <View ref={budgetBox} collapsable={false} style={{ flexDirection: 'row', alignItems: 'center' }}>
              {(['min', 'max'] as const).map((k, i) => (
                <Fragment key={k}>
                  {/* its own slot between the two pills, centred in it, so it is exactly halfway between them */}
                  {i === 1 ? <Text accessibilityElementsHidden importantForAccessibility="no" style={{ width: 28, textAlign: 'center', color: c.muted, fontSize: 14 }}>–</Text> : null}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 32, borderWidth: budgetBad(k) ? 1.2 : 0, borderColor: c.danger }}>
                  <TripAmount ref={k === 'max' ? maxRef : undefined} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => (k === 'min' ? maxRef : aboutRef).current?.focus()} label={k === 'min' ? t('Budget minimum in euros') : t('Budget maximum in euros')} placeholder={k === 'min' ? t('Min') : t('Max')} placeholderTextColor={c.placeholder} value={f[k]} onChangeText={(v) => set(k, v.replace(/\D/g, '').slice(0, 6))} />
                  </View>
                </Fragment>
              ))}
            </View>
            {tried && step === 1 && !!f.min && !!f.max && max <= min ? <Text style={{ color: c.muted, fontSize: 12 }}>{t('The maximum has to be higher than the minimum.')}</Text> : null}
            <Text style={{ color: c.muted, fontSize: 12 }}>{t('Shown as an estimate, never a price.')}</Text>

            <TripLabel style={{ marginTop: 10 }}>{t('Includes')}</TripLabel>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {([[true, 'Incl. travel', 'Budget incl. travel'], [false, 'Excl. travel', 'Budget excl. travel']] as const).map(([v, l, spoken]) => (
                <TripPill key={l} label={t(l)} spoken={t(spoken)} active={f.transport === v} icon="checkmark" onPress={() => set('transport', v)} />
              ))}
            </View>

            <TripLabel style={{ marginTop: 10 }}>{t('How big should the group be?')}</TripLabel>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('Group size, including you')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {GROUP_CHOICES.map(([v, l]) => (
                <TripPill key={v} wide label={l} spoken={t(GROUP_SIZES.find(([x]) => x === v)?.[1] ?? l)} active={f.size === v} onPress={() => set('size', v)} />
              ))}
            </View>
            <Text style={{ color: c.muted, fontSize: 12 }}>{t('Group size, including you')}</Text>

            <TripLabel style={{ marginTop: 10 }} right={f.tags.length ? t('{n} selected', { n: f.tags.length }) : undefined}>{t('Travel interests')}</TripLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TRIP_TAGS.map((tag) => {
                const on = f.tags.includes(tag);
                return <TripPill key={tag} label={t(cap(tag))} active={on} icon="checkmark" onPress={() => set('tags', on ? f.tags.filter((x) => x !== tag) : [...f.tags, tag])} />;
              })}
            </View>

            <TripLabel style={{ marginTop: 10 }}>{t('About the trip')}</TripLabel>
            <View style={{ backgroundColor: TRIP_WHITE, borderRadius: 32, paddingHorizontal: 22, paddingVertical: 16 }}>
              {/* its return key moves on to the next step (so it takes no new lines) */}
              <TextInput
                ref={aboutRef}
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={nextFromKeyboard}
                accessibilityLabel={t('About the trip')}
                placeholder={t('Culture, food, city walks and local experiences.')}
                placeholderTextColor={c.placeholder}
                selectionColor={c.forest}
                cursorColor={c.forest}
                underlineColorAndroid="transparent"
                multiline
                value={f.description}
                onChangeText={(v) => set('description', v)}
                maxLength={300}
                style={{ minHeight: 76, color: c.text, fontSize: 14, lineHeight: 20, textAlignVertical: 'top', paddingVertical: 0, includeFontPadding: false }}
              />
              <Text style={{ color: c.muted, fontSize: 12, textAlign: 'right' }}>{f.description.length} / 300</Text>
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <TripHeading title={t('Group guidelines')} subtitle={t('A trip is a proposal. These rules keep every group safe.')} />
            <TripCard style={{ marginTop: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons accessibilityElementsHidden name="alert-circle" size={22} color={c.danger} />
                <Text style={{ flex: 1, color: c.text, fontSize: 14, lineHeight: 20, fontWeight: '500' }}>{t('THERE is not a travel agency')}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18, paddingLeft: 32 }}>{t('THERE is not a travel agency. Everyone books flights, stays and activities themselves, directly with suppliers. Never ask for or send deposits.')}</Text>
            </TripCard>
            <View ref={agreeBox} collapsable={false} style={{ marginTop: 12, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 20, borderWidth: tried && step === 2 && !agree ? 1.2 : 0, borderColor: c.danger }}>
              <CheckRow checked={agree} onChange={setAgree}>
                <Text style={{ color: c.text, fontSize: 14, lineHeight: 22 }}>{t('I confirm this is a non-commercial proposal for adults and I agree to the group guidelines.')}</Text>
              </CheckRow>
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <TripHeading title={t('Review Your Trip')} subtitle={t('Check everything before your trip goes live.')} />
            {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
            <ErrorBanner message={act.error} />
            <TripCard style={{ marginTop: 6 }}>
              <Txt variant="h3" style={{ fontSize: 18, lineHeight: 24 }}>{f.originCity || '—'} → {f.destination || '—'}</Txt>
              <Text style={{ color: c.muted, fontSize: 13 }}>{nights !== null ? tn(nights, '{n} night', '{n} nights') : '—'}{' · '}{groupLabel}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{t('Dates: {flex}', { flex: flexLabel })}</Text>
            </TripCard>

            <TripLabel style={{ marginTop: 10 }}>{t('Travel dates')}</TripLabel>
            <View style={{ gap: 4 }}>
              <TripField label={t('Departure date')}><TripValue placeholder="—">{dayText(start)}</TripValue></TripField>
              <TripField label={t('Return date')}><TripValue placeholder="—">{dayText(end)}</TripValue></TripField>
            </View>

            <TripLabel style={{ marginTop: 10 }}>{t('Budget')}</TripLabel>
            <TripCard>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '500' }}>{t('{range} per person', { range: `${money(min || 0, 'EUR')}–${money(max || 0, 'EUR')}` })}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{f.transport ? t('Including travel') : t('Excluding travel')}</Text>
            </TripCard>

            {f.tags.length ? (
              <>
                <TripLabel style={{ marginTop: 10 }}>{t('Travel interests')}</TripLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {f.tags.map((tag) => (
                    <Chip key={tag} label={t(cap(tag))} tone="neutral" />
                  ))}
                </View>
              </>
            ) : null}
            {f.description.trim() ? (
              <>
                <TripLabel style={{ marginTop: 10 }}>{t('About the trip')}</TripLabel>
                <TripCard><Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{f.description.trim()}</Text></TripCard>
              </>
            ) : null}

            <TripLabel style={{ marginTop: 10 }}>{t('What happens next')}</TripLabel>
            <TripCard style={{ gap: 12 }}>
              {(
                [
                  ['person-add-outline', 'People apply to join. You read each introduction and approve who comes.'],
                  ['chatbubbles-outline', 'The group chat opens only for approved members.'],
                  ['calendar-outline', 'In the chat you can run a date poll, then ask everyone to confirm the final dates.'],
                ] as const
              ).map(([icon, text]) => (
                <View key={text} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  <Ionicons accessibilityElementsHidden name={icon} size={20} color={c.forest} style={{ marginTop: 1 }} />
                  <Text style={{ flex: 1, color: c.text, fontSize: 13, lineHeight: 19 }}>{t(text)}</Text>
                </View>
              ))}
            </TripCard>
          </>
        )}
        </StepTransition>

        {/* once dates are chosen: what you already have on those days, and when it ends */}
        <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" onChanged={() => void clash.reload()} />

        <AuthButton
          title={step < STEPS - 1 ? t('Continue') : t('Publish trip')}
          loading={step === STEPS - 1 && act.busy}
          onPress={() => (step < STEPS - 1 ? next() : void publish())}
          style={{ marginTop: 10 }}
        />
        {step === STEPS - 1 ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Your trip goes live in the feed. Nobody is charged and nothing is booked.')}</Text> : null}
        {/* on every step: saving a draft (a draft opened from My drafts loads whichever step is showing) */}
        <DraftBar kind="trip" data={f} onLoad={loadDraft} beforeLoad={stashNow} showMyDrafts={step === 0} named={f.destination.trim().length > 0} />
      </Screen>
      {/* the calendar sits just above the dock, outside the scrolling page */}
      <DateRangeSheet
        visible={calendar !== null}
        focus={calendar ?? 'start'}
        start={f.start}
        end={f.end}
        min={tomorrow}
        max={lastDay}
        onClose={() => setCalendar(null)}
        onDone={(s, e) => {
          setF((p) => ({ ...p, start: s, end: e }));
          setCalendar(null);
        }}
      />
    </View>
  );
}
