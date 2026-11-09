import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, View, type HostInstance } from 'react-native';
import { EditPopup, type Origin } from '@/components/EditPopup';
import { AuthButton } from '@/components/AuthForm';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { DraftBar } from '@/components/DraftBar';
import { CountPill, RoundPhoto, WizardActions } from '@/components/CreateParts';
import { ClashNotice, planDays, tellWithdrawn, useClashes, type Withdrawn } from '@/components/ClashNotice';
import { Text, TextInput, type InputHandle } from '@/components/ScaledText';
import { StepTransition } from '@/components/StepMotion';
import { DestinationResults, TRIP_WHITE, TripAmount, TripCard, TripField, TripHeading, TripInput, TripLabel, TripPill, TripRoundDark, TripTop, TripValue } from '@/components/TripCreateParts';
import { Banner, CheckRow, Chip, ErrorBanner, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { TRIP_TAGS } from '@/lib/constants';
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
/** "About the trip": the server's limit (trips.service), shown under the box as "120/300" */
const DESC_MAX = 300;

/** One part of the review page: its name, an Edit pill and what was chosen. Edit reports where the card is, so a pop-up can grow out of it. */
function ReviewCard({ title, onEdit, children }: { title: string; onEdit: (from: Origin) => void; children: React.ReactNode }) {
  const { c } = useTheme();
  const { t } = useT();
  const box = useRef<HostInstance>(null);
  return (
    <View ref={box} collapsable={false} style={{ backgroundColor: c.sand, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 16, gap: 8, marginTop: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Edit {section}', { section: title })}
          hitSlop={8}
          onPress={() => {
            tap('Medium');
            box.current?.measureInWindow((x, y, width, height) => onEdit({ x, y, width, height }));
          }}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.surface }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
        >
          <Ionicons name="pencil" size={13} color={c.forest} />
          <Text style={{ color: c.forest, fontSize: 13, fontWeight: '600' }}>{t('Edit')}</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

/** The pop-up's "Done". */
function DonePill({ onPress }: { onPress: () => void }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('Done')}
      hitSlop={8}
      onPress={() => {
        tap('Medium');
        onPress();
      }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.forest }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
    >
      <Ionicons name="checkmark" size={13} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{t('Done')}</Text>
    </Pressable>
  );
}
/** The four date choices. */
const FLEX_CHOICES: readonly (readonly [string, string])[] = [
  ['exact', 'Exact'],
  ['plus_minus_1', '±1 day'],
  ['plus_minus_3', '±3 days'],
  ['plus_minus_7', '±1 wk'],
];
/** What the budget covers: three choices, each one chosen by tapping it and cleared by tapping it again (like the categories in HERE). */
const INCLUDES = [
  ['food', 'Food', require('../../assets/includes/food.webp')],
  ['travel', 'Travel', require('../../assets/includes/travel.webp')],
  ['stay', 'Stay', require('../../assets/includes/stay.webp')],
] as const;

/** The exact number of people (you included), chosen like in HERE. */
const MIN_PEOPLE = 2;
const MAX_PEOPLE = 20;
/** Drafts saved before the counter hold a range; the top of it becomes the number. */
const RANGE_TOP: Record<string, number> = { '2-3': 3, '4-6': 6, '7-10': 10, '10+': 20 };

type Draft = { destination: string; originCity: string; description: string; start: string; end: string; flex: string; min: string; max: string; includes: string[]; tags: string[]; capacity: number };

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
  const [f, setF] = useState<Draft>({ destination: '', originCity: me?.profile?.homeCity ?? '', description: '', start: '', end: '', flex: 'plus_minus_3', min: '', max: '', includes: [], tags: [], capacity: 6 });
  const [agree, setAgree] = useState(false);
  const [tried, setTried] = useState(false);
  // the review page: the card being edited in a pop-up that grows out of it and folds back into it on Done (as in HERE)
  const [pop, setPop] = useState<null | { card: 'route' | 'budget' | 'group' | 'about'; from: Origin }>(null);
  const [closing, setClosing] = useState(false);
  const openPop = (card: 'route' | 'budget' | 'group' | 'about', from: Origin) => {
    Keyboard.dismiss();
    setClosing(false);
    setPop({ card, from });
  };
  useEffect(() => setPop(null), [step]);
  const aboutBox = useRef<HostInstance>(null);
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const [destFocus, setDestFocus] = useState(false); // the destination field has the cursor
  const [destTyped, setDestTyped] = useState(false); // and its text was changed since: only then are suggestions looked up (tapping it again, or a place just picked, shows none)
  const act = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const loadDraft = useCallback((d: Record<string, unknown>) => {
    const { size, transport, ...rest } = d; // `size` is the old range and `transport` the old "travel included" flag; the number and the list replace them
    setF((p) => ({ ...p, ...(rest as Partial<Draft>), includes: Array.isArray(rest.includes) ? (rest.includes as string[]) : typeof transport === 'boolean' ? (transport ? ['travel'] : []) : p.includes, capacity: typeof rest.capacity === 'number' ? Math.min(MAX_PEOPLE, Math.max(MIN_PEOPLE, rest.capacity)) : typeof size === 'string' ? (RANGE_TOP[size] ?? p.capacity) : p.capacity }));
  }, []);
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
  // only an activity of yours on those days stops the trip; a trip you are on is just a warning (the person decides)
  const busy = clash.blocking.length > 0;
  const marks = useMemo(() => planDays(clash.all, Date.now()), [clash.all, Math.floor(clash.now / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
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
        budgetIncludesTransport: f.includes.includes('travel'),
        budgetIncludes: f.includes,
        tags: f.tags,
        capacity: f.capacity,
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
  const groupLabel = t('{n} people', { n: f.capacity });
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

  // ---- the fields, written once: steps 1 and 2 show them, and the review page opens them inside its cards (Edit)
  const routeFields = (
    <>
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
    </>
  );
  const dateFields = (
    <View style={{ gap: 4 }}>
      {dateField('start')}
      {dateField('end')}
      <View style={{ position: 'absolute', right: 12, top: '50%', marginTop: -22 }}>
        <TripRoundDark icon="calendar-outline" label={t('Open the calendar')} onPress={() => setCalendar('start')} />
      </View>
    </View>
  );
  const flexFields = (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('How flexible are your dates?')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {FLEX_CHOICES.map(([v, l]) => (
        <TripPill key={v} label={t(l)} active={f.flex === v} onPress={() => set('flex', v)} />
      ))}
    </View>
  );
  const budgetFields = (
    <>
      <View ref={budgetBox} collapsable={false} style={{ flexDirection: 'row', alignItems: 'center' }}>
        {(['min', 'max'] as const).map((k, i) => (
          <Fragment key={k}>
            {/* its own slot between the two pills, centred in it, so it is exactly halfway between them */}
            {i === 1 ? <Text accessibilityElementsHidden importantForAccessibility="no" style={{ width: 28, textAlign: 'center', color: c.muted, fontSize: 14 }}>–</Text> : null}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 32, borderWidth: budgetBad(k) ? 1.2 : 0, borderColor: c.danger }}>
              <TripAmount ref={k === 'max' ? maxRef : undefined} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => (k === 'min' ? maxRef.current?.focus() : step === 1 ? aboutRef.current?.focus() : Keyboard.dismiss())} label={k === 'min' ? t('Budget minimum in euros') : t('Budget maximum in euros')} placeholder={k === 'min' ? t('Min') : t('Max')} placeholderTextColor={c.placeholder} value={f[k]} onChangeText={(v) => set(k, v.replace(/\D/g, '').slice(0, 6))} />
            </View>
          </Fragment>
        ))}
      </View>
      {tried && step === 1 && !!f.min && !!f.max && max <= min ? <Text style={{ color: c.muted, fontSize: 12 }}>{t('The maximum has to be higher than the minimum.')}</Text> : null}
    </>
  );
  const includesFields = (
    <View accessibilityLabel={t('Includes')} style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      {INCLUDES.map(([k, label, photo]) => {
        const on = f.includes.includes(k);
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={t(label)}
            accessibilityState={{ selected: on }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              tap();
              set('includes', on ? f.includes.filter((x) => x !== k) : [...f.includes, k]);
            }}
            style={({ pressed: p }) => [{ minHeight: 48, borderRadius: 999, backgroundColor: on ? c.forest : TRIP_WHITE, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 6, paddingRight: 16 }, p && { opacity: 0.85 }]}
          >
            <RoundPhoto source={photo} size={36} ring={on} />
            <Text style={{ color: on ? '#fff' : c.text, fontSize: 14, fontWeight: '500' }}>{t(label)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
  const sizeFields = (
    <>
      <CountPill
        value={f.capacity}
        minusLabel={t('Fewer people')}
        plusLabel={t('More people')}
        canMinus={f.capacity > MIN_PEOPLE}
        canPlus={f.capacity < MAX_PEOPLE}
        onMinus={() => set('capacity', Math.max(MIN_PEOPLE, f.capacity - 1))}
        onPlus={() => set('capacity', Math.min(MAX_PEOPLE, f.capacity + 1))}
      />
      <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>{`${t('Including you')} · ${tn(f.capacity - 1, 'You + {n} spot', 'You + {n} spots')}`}</Text>
    </>
  );
  const tagFields = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {TRIP_TAGS.map((tag) => {
        const on = f.tags.includes(tag);
        return <TripPill key={tag} label={t(cap(tag))} active={on} onPress={() => set('tags', on ? f.tags.filter((x) => x !== tag) : [...f.tags, tag])} />;
      })}
    </View>
  );
  const aboutField = (
    // the whole box (counter included) is scrolled clear of the keyboard once it is up, not just the line being typed
    <View ref={aboutBox} collapsable={false} style={{ backgroundColor: TRIP_WHITE, borderRadius: 32, paddingHorizontal: 22, paddingVertical: 16 }}>
      {/* its return key moves on to the next step (so it takes no new lines) */}
      <TextInput
        ref={aboutRef}
        returnKeyType={step === 1 ? 'next' : 'done'}
        submitBehavior="submit"
        onSubmitEditing={step === 1 ? nextFromKeyboard : () => Keyboard.dismiss()}
        onFocus={() => setTimeout(() => scrollToField(aboutBox), 320)}
        accessibilityLabel={t('About the trip')}
        placeholder={t('Culture, food, city walks and local experiences.')}
        placeholderTextColor={c.placeholder}
        selectionColor={c.forest}
        cursorColor={c.forest}
        underlineColorAndroid="transparent"
        multiline
        value={f.description}
        onChangeText={(v) => set('description', v)}
        maxLength={DESC_MAX}
        style={{ minHeight: 76, color: c.text, fontSize: 14, lineHeight: 20, textAlignVertical: 'top', paddingVertical: 0, includeFontPadding: false }}
      />
      <Text style={{ color: c.muted, fontSize: 12, textAlign: 'right' }}>{`${f.description.length}/${DESC_MAX}`}</Text>
    </View>
  );

  // closing the pop-up: the keyboard and an open calendar go first, then it folds back into its card
  const donePop = () => {
    Keyboard.dismiss();
    setCalendar(null);
    setClosing(true);
  };
  const calendarSheet = (
    <DateRangeSheet
      visible={calendar !== null}
      focus={calendar ?? 'start'}
      start={f.start}
      end={f.end}
      min={tomorrow}
      max={lastDay}
      marks={marks}
      onClose={() => setCalendar(null)}
      onDone={(s, e) => {
        setF((p) => ({ ...p, start: s, end: e }));
        setCalendar(null);
      }}
    />
  );

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
            {routeFields}

            <TripLabel style={{ marginTop: 14 }} right={nights !== null && nights >= 0 ? tn(nights, '{n} night', '{n} nights') : undefined}>{t('When would you like to go?')}</TripLabel>
            {dateFields}
            {/* what you already have on the chosen days: right under the dates (an activity blocks, a trip only warns) */}
            <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" onChanged={() => void clash.reload()} />
            <TripLabel style={{ marginTop: 10 }}>{t('How flexible are your dates?')}</TripLabel>
            {flexFields}
            <ErrorBanner message={act.error} />
          </>
        )}

        {step === 1 && (
          <>
            <TripHeading title={t('What kind of trip are you planning?')} subtitle={t('Set a budget range per person, what it covers and how big the group should be.')} />
            <TripLabel style={{ marginTop: 10 }}>{t('Budget per person')}</TripLabel>
            {budgetFields}
            <Text style={{ color: c.muted, fontSize: 12 }}>{t('Shown as an estimate, never a price.')}</Text>

            <TripLabel style={{ marginTop: 10 }}>{t('Includes')}</TripLabel>
            {includesFields}

            <TripLabel style={{ marginTop: 10 }}>{t('How big should the group be?')}</TripLabel>
            {sizeFields}

            <TripLabel style={{ marginTop: 10 }}>{t('Travel interests')}</TripLabel>
            {tagFields}

            <TripLabel style={{ marginTop: 10 }}>{t('About the trip')}</TripLabel>
            {aboutField}
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
            {/* every part can be changed from here: Edit opens its fields in a pop-up that grows out of the card, Done folds it back */}
            <ReviewCard title={t('Route and dates')} onEdit={(from) => openPop('route', from)}>
              <Txt variant="h3" style={{ fontSize: 18, lineHeight: 24 }}>{f.originCity || '—'} → {f.destination || '—'}</Txt>
              <Text style={{ color: c.text, fontSize: 14 }}>{start && end ? `${dayText(start)} – ${dayText(end)}` : '—'}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{nights !== null ? tn(nights, '{n} night', '{n} nights') : '—'}{' · '}{t('Dates: {flex}', { flex: flexLabel })}</Text>
            </ReviewCard>

            <ReviewCard title={t('Budget')} onEdit={(from) => openPop('budget', from)}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '500' }}>{t('{range} per person', { range: `${money(min || 0, 'EUR')}–${money(max || 0, 'EUR')}` })}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{f.includes.length ? INCLUDES.filter(([k]) => f.includes.includes(k)).map(([, label]) => t(label)).join(' · ') : t('Nothing included')}</Text>
            </ReviewCard>

            <ReviewCard title={t('Group and interests')} onEdit={(from) => openPop('group', from)}>
              <Text style={{ color: c.text, fontSize: 15 }}>{groupLabel}</Text>
              {f.tags.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {f.tags.map((tag) => (
                    <Chip key={tag} label={t(cap(tag))} tone="neutral" />
                  ))}
                </View>
              ) : (
                <Text style={{ color: c.muted, fontSize: 13 }}>{t('No interests chosen')}</Text>
              )}
            </ReviewCard>

            <ReviewCard title={t('About the trip')} onEdit={(from) => openPop('about', from)}>
              <Text style={{ color: f.description.trim() ? c.text : c.muted, fontSize: 14, lineHeight: 20 }}>{f.description.trim() || t('Nothing written yet')}</Text>
            </ReviewCard>
          </>
        )}
        </StepTransition>

        {/* on the last step, next to Publish: what stops it (the same card as under the dates) */}
        {step === STEPS - 1 ? <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" onChanged={() => void clash.reload()} /> : null}

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
      {/* the calendar sits just above the dock, outside the scrolling page (inside the pop-up while one is open: the page below would be hidden by it) */}
      {!pop ? calendarSheet : null}
      {pop ? (
        <EditPopup
          from={pop.from}
          closing={closing}
          onDone={donePop}
          onClosed={() => setPop(null)}
          header={
            <View style={{ alignItems: 'flex-end' }}>
              <DonePill onPress={donePop} />
            </View>
          }
          overlay={calendarSheet}
        >
          {pop.card === 'route' ? (
            <>
              {routeFields}
              {dateFields}
              {flexFields}
            </>
          ) : pop.card === 'budget' ? (
            <>
              {budgetFields}
              {includesFields}
            </>
          ) : pop.card === 'group' ? (
            <>
              {sizeFields}
              {tagFields}
            </>
          ) : (
            aboutField
          )}
        </EditPopup>
      ) : null}
    </View>
  );
}
