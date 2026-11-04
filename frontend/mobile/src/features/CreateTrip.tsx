import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { AuthButton } from '@/components/AuthForm';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { DraftBar } from '@/components/DraftBar';
import { Text, TextInput } from '@/components/ScaledText';
import { StepTransition } from '@/components/StepMotion';
import { TRIP_WHITE, TripAmount, TripCard, TripField, TripHeading, TripInput, TripLabel, TripPill, TripRoundDark, TripTop, TripValue } from '@/components/TripCreateParts';
import { Banner, CheckRow, Chip, ErrorBanner, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { FLEX } from '@/lib/constants';
import { money, parseDay } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { dropDraft } from '@/lib/drafts';
import { useFormDraft } from '@/lib/formDraft';
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
const GROUP_CHOICES: readonly (readonly [string, string])[] = GROUP_SIZES.map(([v]) => [v, v === '10+' ? '10+' : v.replace('-', ' - ')] as const);

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
 * proposal, never a booking or an offer to sell travel. It behaves like the HERE form: leaving it saves what was typed as a
 * draft and it comes back empty. Changing `round` remounts the form, which is what empties it (and takes it back to the first step).
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
  const [f, setF] = useState<Draft>({ destination: '', originCity: me?.profile?.homeCity ?? '', description: '', start: '', end: '', flex: 'plus_minus_3', min: '', max: '', transport: true, tags: [], size: '4-6' });
  const [agree, setAgree] = useState(false);
  const [tried, setTried] = useState(false);
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const act = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const loadDraft = useCallback((d: Record<string, unknown>) => setF((p) => ({ ...p, ...(d as Partial<Draft>) })), []);
  // leaving saves a draft and empties the form, "Clear all", and saving on leaving the app: shared with the activity form
  const { posted, clearAll } = useFormDraft('trip', f, hasContent, onReset);

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
  const publishProblems = [...routeProblems, ...budgetProblems, !agree && t('the guidelines ticked')].filter(Boolean) as string[];
  const verified = me?.eligibility === 'verified';

  const next = () => {
    if (step === 0 && routeProblems.length) return setTried(true);
    if (step === 1 && budgetProblems.length) return setTried(true);
    if (step === 2 && !agree) return setTried(true);
    setTried(false);
    setStep(step + 1);
  };
  const back = () => {
    if (step > 0) {
      setTried(false);
      setStep(step - 1);
    } else go('/');
  };

  const publish = async () => {
    if (publishProblems.length || !start || !end) return setTried(true);
    const created = await act.run(() =>
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
    if (created) {
      posted.current = true;
      void dropDraft('trip');
      go(`/trip/${created.id}`);
    }
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
      <TripField
        key={k}
        label={label}
        invalid={tried && step === 0 && !d}
        onPress={() => setCalendar(k)}
        a11y={t('{kind} date: {day}. Opens a calendar', { kind: k === 'start' ? t('Depart') : t('Return'), day: d ? shortDay(d) : t('not chosen') })}
      >
        <TripValue placeholder={t('Select date')}>{dayText(d)}</TripValue>
      </TripField>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen tabBar plain header={
    <TripTop
      step={step}
      title={stepNames[step]}
      onBack={back}
      right={
        <Pressable accessibilityRole="button" accessibilityLabel={t('Clear all')} accessibilityState={{ disabled: !hasContent(f) }} disabled={!hasContent(f)} hitSlop={8} onPress={() => void clearAll()} style={{ minHeight: 30, justifyContent: 'center', opacity: hasContent(f) ? 1 : 0.4 }}>
          <Text style={{ color: c.text, fontSize: 13, fontWeight: '500' }}>{t('Clear all')}</Text>
        </Pressable>
      }
    />
      }>

        <StepTransition step={step} style={{ gap: 16 }}>
        {step === 0 && (
          <>
            <TripHeading title={t('Where do you want to go?')} subtitle={t('Choose where you leave from and where you are heading, then the dates.')} />
            {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
            <TripLabel style={{ marginTop: 8 }}>{t('Route')}</TripLabel>
            <View style={{ gap: 4 }}>
              <TripField label={t('Departing from')}>
                <TripInput label={t('Departing from')} autoCapitalize="words" placeholder={t('Milan, Italy')} value={f.originCity} onChangeText={(v) => set('originCity', v)} maxLength={60} />
              </TripField>
              <TripField label={t('Destination')} invalid={tried && step === 0 && f.destination.trim().length < 2}>
                <TripInput label={t('Destination')} autoCapitalize="words" placeholder={t('Tokyo & Kyoto, Japan')} value={f.destination} onChangeText={(v) => set('destination', v)} maxLength={100} />
              </TripField>
              <View style={{ position: 'absolute', right: 12, top: '50%', marginTop: -22 }}>
                <TripRoundDark icon="swap-vertical" label={t('Swap departure and destination')} onPress={() => setF((p) => ({ ...p, originCity: p.destination, destination: p.originCity }))} />
              </View>
            </View>

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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {(['min', 'max'] as const).map((k, i) => (
                <View key={k} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 32, borderWidth: budgetBad(k) ? 1.2 : 0, borderColor: c.danger }}>
                  {i === 1 ? <Text style={{ color: c.muted, fontSize: 14, marginLeft: -4 }}>–</Text> : null}
                  <TripAmount label={k === 'min' ? t('Budget minimum in euros') : t('Budget maximum in euros')} placeholder={k === 'min' ? t('Min') : t('Max')} placeholderTextColor={c.placeholder} value={f[k]} onChangeText={(v) => set(k, v.replace(/\D/g, '').slice(0, 6))} />
                </View>
              ))}
            </View>
            {!!f.min && !!f.max && max <= min ? <Text style={{ color: c.danger, fontSize: 12 }}>{t('The maximum has to be higher than the minimum.')}</Text> : null}
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
              <TextInput
                accessibilityLabel={t('About the trip')}
                placeholder={t('Culture, food, city walks and local experiences.')}
                placeholderTextColor={c.placeholder}
                selectionColor={c.forest}
                cursorColor={c.forest}
                underlineColorAndroid="transparent"
                multiline
                value={f.description}
                onChangeText={(v) => set('description', v)}
                maxLength={2000}
                style={{ minHeight: 76, color: c.text, fontSize: 14, lineHeight: 20, textAlignVertical: 'top', paddingVertical: 0, includeFontPadding: false }}
              />
              <Text style={{ color: c.muted, fontSize: 12, textAlign: 'right' }}>{f.description.length} / 2000</Text>
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
            <View style={{ marginTop: 12, paddingHorizontal: 4 }}>
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

        {tried && step === 0 && routeProblems.length ? <Banner tone="bad">{t('Still needed: {list}.', { list: routeProblems.join(', ') })}</Banner> : null}
        {tried && step === 1 && budgetProblems.length ? <Banner tone="bad">{t('Still needed: {list}.', { list: budgetProblems.join(', ') })}</Banner> : null}
        {tried && step === 2 && !agree ? <Banner tone="bad">{t('Tick the box to continue.')}</Banner> : null}
        {tried && step === 3 && publishProblems.length ? <Banner tone="bad">{t('Still needed: {list}. Go back to fix it.', { list: publishProblems.join(', ') })}</Banner> : null}

        <AuthButton
          title={step < STEPS - 1 ? t('Continue') : t('Publish trip')}
          loading={step === STEPS - 1 && act.busy}
          onPress={() => (step < STEPS - 1 ? next() : void publish())}
          style={{ marginTop: 10 }}
        />
        {step === STEPS - 1 ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t('Your trip goes live in the feed. Nobody is charged and nothing is booked.')}</Text> : null}
        {/* always mounted: opening a saved draft from "My drafts" loads it whichever step is showing; its buttons show on the last step */}
        <View style={step === STEPS - 1 ? undefined : { display: 'none' }}>
          <DraftBar kind="trip" data={f} onLoad={loadDraft} />
        </View>
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
