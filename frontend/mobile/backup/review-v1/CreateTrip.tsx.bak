import { useIsFocused, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, View, type HostInstance } from 'react-native';
import { EditPopup, type Origin } from '@/components/EditPopup';
import { AuthButton } from '@/components/AuthForm';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { DraftBar } from '@/components/DraftBar';
import { CountPill, WizardActions } from '@/components/CreateParts';
import { ClashNotice, planDays, tellWithdrawn, useClashes, type Withdrawn } from '@/components/ClashNotice';
import { Text, TextInput, type InputHandle } from '@/components/ScaledText';
import { StepTransition } from '@/components/StepMotion';
import { DestinationResults, TRIP_WHITE, TripAmount, TripCard, TripField, TripHeading, TripInput, TripLabel, TripPill, TripTop, TripValue, TravelStyleChoice, type TravelStyle } from '@/components/TripCreateParts';
import { Banner, CheckRow, Chip, ErrorBanner, Screen, Txt, useGo } from '@/components/ui';
import { TripThumb } from '@/components/Cards';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useVerifyGate } from '@/lib/verifyGate';
import { TRIP_TAGS } from '@/lib/constants';
import { TripStylePicker } from '@/components/ThereParts';
import { FLEX } from '@/lib/constants';
import { money, parseDay } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { dropDraft } from '@/lib/drafts';
import { useFormDraft } from '@/lib/formDraft';
import { useDroppedPin } from '@/lib/dropPin';
import { success, tap } from '@/lib/haptics';
import { closeKeyboard } from '@/lib/keyboard';
import { scrollToField } from '@/lib/pageScroll';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { backFromMain } from '@/lib/nav';

import { sc, sp, sph } from '@/lib/scale';
const STEPS = 4;
/** "About the trip": the server's limit (trips.service), shown under the box as "120/300" */
const DESC_MAX = 300;

/** One part of the review page: its name, an Edit pill and what was chosen. Edit reports where the card is, so a pop-up can grow out of it. */
function ReviewCard({ title, onEdit, children, missing }: { title: string; onEdit: (from: Origin) => void; children: React.ReactNode; /** what is missing or wrong in this part (red border and this line); publishing waits for it */ missing?: string | false }) {
  const { c } = useTheme();
  const { t } = useT();
  const box = useRef<HostInstance>(null);
  return (
    <View ref={box} collapsable={false} style={{ backgroundColor: TRIP_WHITE, borderRadius: sc(24), paddingVertical: sp(14), paddingHorizontal: sph(16), gap: sp(8), marginTop: sp(6), borderWidth: missing ? 1.2 : 0, borderColor: c.danger }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: c.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Edit {section}', { section: title })}
          hitSlop={8}
          onPress={() => {
            tap('Medium');
            box.current?.measureInWindow((x, y, width, height) => onEdit({ x, y, width, height }));
          }}
          style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(4), minHeight: sc(30), paddingHorizontal: sph(12), borderRadius: sc(999), backgroundColor: c.surface }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
        >
          <Ionicons name="pencil" size={sc(13)} color={c.forest} />
          <Text style={{ color: c.forest, fontSize: 12, fontWeight: '600' }}>{t('Edit')}</Text>
        </Pressable>
      </View>
      {children}
      {missing ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16 }}>{missing}</Text> : null}
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
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(4), minHeight: sc(30), paddingHorizontal: sph(12), borderRadius: sc(999), backgroundColor: c.forest }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
    >
      <Ionicons name="checkmark" size={sc(13)} color="#fff" />
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>{t('Done')}</Text>
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
  ['food', 'Food'],
  ['travel', 'Travel'],
  ['stay', 'Stay'],
] as const;

/** The exact number of people (you included), chosen like in HERE. */
const MIN_PEOPLE = 2;
const MAX_PEOPLE = 20;
/** Drafts saved before the counter hold a range; the top of it becomes the number. */
const RANGE_TOP: Record<string, number> = { '2-3': 3, '4-6': 6, '7-10': 10, '10+': 20 };

// `style`: how the group gets there. `originOk` / `destOk` are false while the field holds typed text that was not picked from the
// search results (a value picked, filled in from the profile, or from an older draft counts as picked)
type Draft = { style: TravelStyle; originOk?: boolean; destOk?: boolean; destLat?: number; destLng?: number; destination: string; originCity: string; description: string; start: string; end: string; flex: string; min: string; max: string; includes: string[]; tags: string[]; capacity: number };

/** A bordered tile with a small label above the value, like the route and date boxes (also used by the trip search). */
export function Tile({ label, children, style }: { label: string; children: ReactNode; style?: object }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View style={[{ borderWidth: 1, borderColor: c.line, borderRadius: sc(12), backgroundColor: c.surface, paddingHorizontal: sph(10), paddingVertical: sp(6), gap: 0 }, style]}>
      <Text style={{ color: c.muted, fontSize: 12 }}>{t(label)}</Text>
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
  const { c, mode } = useTheme();
  const go = useGo();
  const router = useRouter();
  const gate = useVerifyGate();
  const [step, setStep] = useState(0);
  useEffect(() => Keyboard.dismiss(), [step]); // a new step starts with the keyboard down
  const destRef = useRef<InputHandle>(null);
  const maxRef = useRef<InputHandle>(null);
  const aboutRef = useRef<InputHandle>(null);
  const [f, setF] = useState<Draft>({ style: 'together', destination: '', originCity: me?.profile?.homeCity ?? '', description: '', start: '', end: '', flex: 'plus_minus_3', min: '', max: '', includes: [], tags: [], capacity: 6 });
  // a spot pinned on the THERE map ("Plan a trip here?") becomes the destination, with its position, so the trip shows as a pin
  useDroppedPin('trip', (p) => { setF((prev) => ({ ...prev, destination: p.name.slice(0, 100), destOk: true, destLat: p.lat, destLng: p.lng })); setStep(0); });
  const [agree, setAgree] = useState(false);
  const [tried, setTried] = useState(false);
  // the review page: the card being edited in a pop-up that grows out of it and folds back into it on Done (as in HERE)
  const [pop, setPop] = useState<null | { card: 'route' | 'budget' | 'group' | 'about'; from: Origin }>(null);
  const [closing, setClosing] = useState(false);
  // Done was tapped in a pop-up whose fields are not right: they are marked red, as on their step, and it stays open
  const [popTried, setPopTried] = useState(false);
  // Publish was tapped with something missing: the review cards that need it are marked, and a line says so
  const [reviewTried, setReviewTried] = useState(false);
  const openPop = (card: 'route' | 'budget' | 'group' | 'about', from: Origin) => {
    Keyboard.dismiss();
    setClosing(false);
    setPopTried(false);
    setPop({ card, from });
  };
  useEffect(() => setPop(null), [step]);
  const aboutBox = useRef<HostInstance>(null);
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const [destFocus, setDestFocus] = useState(false); // the destination field has the cursor
  const [originFocus, setOriginFocus] = useState(false); // the same for the departure city
  const [originTyped, setOriginTyped] = useState(false);
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
  // (a trip that meets at the destination has no departure city: the destination's city decides, as on the server)
  const together = f.style === 'together';
  const limitCity = together ? f.originCity.trim() : f.destination.split(',')[0].trim();
  const limits = useLoad(() => get<{ there: { months: number; latest: string } }>(`/v1/regions/limits?city=${encodeURIComponent(limitCity)}`), [limitCity]);
  const lastDay = limits.data ? new Date(limits.data.there.latest) : lastPlanningDay(6);
  const monthsAhead = limits.data?.there.months ?? 6;

  // what is still missing, so a button can say so instead of sitting there greyed out
  const routeProblems = [
    together && (f.originCity.trim().length < 2 || f.originOk === false) && t('where you leave from, picked from the list'),
    (f.destination.trim().length < 2 || f.destOk === false) && t('a destination picked from the list'),
    !start && t('a departure date'),
    !!start && !end && t('a return date'),
    !!start && !!end && end < start && t('a return date on or after the departure'),
    !!start && start < tomorrow && t('a departure from tomorrow on'),
    (nights ?? 0) > 90 && t('a trip of at most 90 nights'),
    ((!!start && start > lastDay) || (!!end && end > lastDay)) && tn(monthsAhead, 'dates within the next month', 'dates within the next {n} months'),
  ].filter(Boolean) as string[];
  const budgetProblems = [
    (!f.min || !f.max || Number.isNaN(min) || Number.isNaN(max)) && t('a budget range'),
    !Number.isNaN(min) && !Number.isNaN(max) && !!f.min && !!f.max && max <= min && t('a maximum budget higher than the minimum'),
    // what the budget covers (Food, Travel, Stay) and the travel interests (Adventure, Nature, Beach, Photography): at least one of each, so every trip says
    // what it is about (and the filters on THERE Home have something to find it by)
    f.includes.length === 0 && t('what the budget includes'),
    !f.tags.some((x) => TRIP_TAGS.includes(x)) && t('at least one travel interest'),
  ].filter(Boolean) as string[];
  // one plan at a time: a trip or activity you are in on these days blocks the trip (it holds its whole days)
  const clash = useClashes(start, start && end && end >= start ? new Date(+end + 864e5) : null, undefined, 'trip');
  // only an activity of yours on those days stops the trip; a trip you are on is just a warning (the person decides)
  const busy = clash.blocking.length > 0;
  const marks = useMemo(() => planDays(clash.all, Date.now()), [clash.all, Math.floor(clash.now / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const publishProblems = [...routeProblems, ...budgetProblems, !agree && t('the guidelines ticked')].filter(Boolean) as string[];

  // what is missing is shown to the person (scrolled to, marked red), with no message
  const originBox = useRef<HostInstance>(null);
  const destBox = useRef<HostInstance>(null);
  const startBox = useRef<HostInstance>(null);
  const endBox = useRef<HostInstance>(null);
  const budgetBox = useRef<HostInstance>(null);
  const agreeBox = useRef<HostInstance>(null);
  const originBad = together && (f.originCity.trim().length < 2 || f.originOk === false);
  const destBad = f.destination.trim().length < 2 || f.destOk === false;
  const startBad = !start || start < tomorrow || (!!start && start > lastDay) || (nights ?? 0) > 90;
  const endBad = !!start && (!end || (!!end && end > lastDay) || (!!end && end < start));
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
  // both create forms stay built (one is hidden): only the one in front, on the Create tab, answers the phone's Back button
  const inFront = useIsFocused() && mode === 'there';
  useEffect(() => {
    if (Platform.OS !== 'android' || step === 0 || !inFront) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setTried(false), setStep(step - 1), true));
    return () => sub.remove();
  }, [step, inFront]);
  const nextFromKeyboard = () => (step < STEPS - 1 ? next() : Keyboard.dismiss());
  const back = () => {
    if (step > 0) {
      setTried(false);
      setStep(step - 1);
    } else router.navigate(backFromMain() as never);
  };

  const publish = async () => {
    if (routeProblems.length || budgetProblems.length || !start || !end || busy) {
      tap('Medium');
      setReviewTried(true);
      return;
    }
    if (!agree) return showProblem(2);
    setReviewTried(false);
    if (!gate.verified) return void gate.ask('publish');
    const created = await act.run(() =>
      post<Trip & { withdrawn?: Withdrawn[] }>('/v1/trips', {
        destination: f.destination.trim(),
        destinationLat: f.destLat,
        destinationLng: f.destLng,
        travelStyle: f.style,
        originCity: together ? f.originCity.trim() : undefined,
        description: f.description.trim() || undefined,
        dateStart: start.toISOString(),
        dateEnd: end.toISOString(),
        dateFlexibility: f.flex,
        budgetCurrency: 'EUR',
        budgetMin: Math.floor(min),
        budgetMax: Math.floor(max),
        budgetIncludesTransport: f.includes.includes('travel'),
        budgetIncludes: f.includes,
        tags: f.tags.filter((x) => TRIP_TAGS.includes(x)),
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

  const stepNames = [t('Destination and vibe'), t('Budget and preferences'), t('Group guidelines'), t('Review and publish')];
  const flexLabel = t(FLEX.find(([v]) => v === f.flex)?.[1] ?? '');
  const groupLabel = t('{n} people', { n: f.capacity });
  const dayText = (d: Date | null) => (d ? `${shortDay(d)}, ${d.getFullYear()}` : '');
  /** a step's fields show what is wrong: after Continue on that step, or after Done in a review pop-up that opened them */
  const bad = (i: number) => (tried && step === i) || (popTried && !!pop && ((i === 0 && pop.card === 'route') || (i === 1 && pop.card === 'budget')));
  const budgetBad = (k: 'min' | 'max') => bad(1) && (!f[k] || (k === 'max' && !!f.min && max <= min));

  const dateField = (k: 'start' | 'end') => {
    const d = k === 'start' ? start : end;
    const label = k === 'start' ? t('Departure date') : t('Return date');
    return (
      <View key={k} ref={k === 'start' ? startBox : endBox} collapsable={false}>
        <TripField
          label={label}
          icon="calendar-outline"
          invalid={(bad(0) && (k === 'start' ? startBad || busy : endBad)) || (k === 'end' && !!start && !!end && end < start)}
          hint={k === 'end' && !!start && !!end && end < start ? t('The return must be on or after the departure.') : undefined}
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
      {/* how the group gets there: leave together from one city, or each on their own and meet at the destination */}
      <TravelStyleChoice value={f.style} onChange={(v) => set('style', v)} />
      <View style={{ gap: sp(4), marginTop: sp(8) }}>
        {together ? (
          <View ref={originBox} collapsable={false}>
            <TripField label={t('Departing from')} invalid={bad(0) && originBad} hint={t('Search, then pick a place from the list.')}>
              <TripInput label={t('Departing from')} autoCapitalize="words" placeholder={t('Search a city')} value={f.originCity} onChangeText={(v) => { setF((p) => ({ ...p, originCity: v, originOk: false })); setOriginTyped(true); }} onFocus={() => { setOriginFocus(true); setOriginTyped(false); }} onBlur={() => setTimeout(() => setOriginFocus(false), 200)} maxLength={60} returnKeyType="search" />
            </TripField>
          </View>
        ) : null}
        {/* the departure city's results, right under its field */}
        {together ? <DestinationResults text={f.originCity} active={originFocus && originTyped} onPick={(label) => { setF((p) => ({ ...p, originCity: label.slice(0, 60), originOk: true })); setOriginTyped(false); destRef.current?.focus(); }} /> : null}
        <View ref={destBox} collapsable={false}>
          <TripField label={together ? t('Destination') : t('Where you meet')} invalid={bad(0) && destBad} hint={t('Search, then pick a place from the list.')}>
            <TripInput ref={destRef} label={together ? t('Destination') : t('Where you meet')} autoCapitalize="words" placeholder={t('Search a place')} value={f.destination} onChangeText={(v) => { setF((p) => ({ ...p, destination: v, destOk: false, destLat: undefined, destLng: undefined })); setDestTyped(true); }} onFocus={() => { setDestFocus(true); setDestTyped(false); }} onBlur={() => setTimeout(() => setDestFocus(false), 200)} maxLength={100} returnKeyType="search" />
          </TripField>
        </View>
      </View>
      {/* any place in the world, named with its country ("Milan, Italy", "Kerala, India"): tap one to use it */}
      <DestinationResults text={f.destination} active={destFocus && destTyped} onPick={(label, at) => { setF((p) => ({ ...p, destination: label, destOk: true, destLat: at?.lat, destLng: at?.lng })); setDestTyped(false); Keyboard.dismiss(); }} />
    </>
  );
  const dateFields = (
    <View style={{ gap: sp(4) }}>
      {dateField('start')}
      {dateField('end')}
    </View>
  );
  const flexFields = (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('How flexible are your dates?')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) }}>
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
            {i === 1 ? <Text accessibilityElementsHidden importantForAccessibility="no" style={{ width: sc(28), textAlign: 'center', color: c.muted, fontSize: 16 }}>–</Text> : null}
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: sc(32), borderWidth: budgetBad(k) ? 1.2 : 0, borderColor: c.danger }}>
              <TripAmount ref={k === 'max' ? maxRef : undefined} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => (k === 'min' ? maxRef.current?.focus() : step === 1 ? aboutRef.current?.focus() : Keyboard.dismiss())} label={k === 'min' ? t('Budget minimum in euros') : t('Budget maximum in euros')} placeholder={k === 'min' ? t('Min') : t('Max')} placeholderTextColor={c.placeholder} value={f[k]} onChangeText={(v) => set(k, v.replace(/\D/g, '').slice(0, 6))} />
            </View>
          </Fragment>
        ))}
      </View>
      {bad(1) && !!f.min && !!f.max && max <= min ? <Text style={{ color: c.muted, fontSize: 12 }}>{t('The maximum has to be higher than the minimum.')}</Text> : null}
    </>
  );
  // what the budget covers: plain pills, no pictures (each is chosen by tapping it and cleared by tapping it again)
  const includesFields = (
    <View accessibilityLabel={t('Includes')} style={{ flexDirection: 'row', gap: sp(8), flexWrap: 'wrap' }}>
      {INCLUDES.map(([k, label]) => {
        const on = f.includes.includes(k);
        return <TripPill key={k} label={t(label)} active={on} onPress={() => set('includes', on ? f.includes.filter((x) => x !== k) : [...f.includes, k])} />;
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
  // the travel interests: the same four cards as the chips on THERE Home, several can be chosen (at least one)
  const tagFields = <TripStylePicker value={f.tags} onToggle={(tag) => set('tags', f.tags.includes(tag) ? f.tags.filter((x) => x !== tag) : [...f.tags, tag])} />;
  const includesHint = bad(1) && f.includes.length === 0 ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16, paddingLeft: sph(4) }}>{t('Choose at least one: Food, Travel or Stay.')}</Text> : null;
  const tagsHint = bad(1) && !f.tags.some((x) => TRIP_TAGS.includes(x)) ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16, paddingLeft: sph(4) }}>{t('Choose at least one travel interest.')}</Text> : null;
  const aboutField = (
    // the whole box (counter included) is scrolled clear of the keyboard once it is up, not just the line being typed
    <View ref={aboutBox} collapsable={false} style={{ backgroundColor: TRIP_WHITE, borderRadius: sc(32), paddingHorizontal: sph(22), paddingVertical: sp(16) }}>
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
        style={{ minHeight: sc(76), color: c.text, fontSize: 16, lineHeight: 23, textAlignVertical: 'top', paddingVertical: 0, includeFontPadding: false }}
      />
      <Text style={{ color: c.muted, fontSize: 12, textAlign: 'right' }}>{`${f.description.length}/${DESC_MAX}`}</Text>
    </View>
  );

  // closing the pop-up: the keyboard and an open calendar go first, then it folds back into its card
  const donePop = () => {
    const wrong = pop?.card === 'route' ? routeProblems.length > 0 || busy : pop?.card === 'budget' ? budgetProblems.length > 0 : false;
    if (wrong) {
      closeKeyboard();
      tap('Medium');
      setPopTried(true);
      return;
    }
    Keyboard.dismiss();
    setCalendar(null);
    setPopTried(false);
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
        <StepTransition step={step} style={{ gap: sp(16) }} swipe={{ canNext: step < 3 && !!stepOk[step], canBack: step > 0, onNext: next, onBack: () => jump(step - 1) }}>
        {step === 0 && (
          <>
            <TripHeading title={t('Where do you want to go?')} subtitle={t('Choose how the group travels and where to, then the dates.')} />
            <TripLabel style={{ marginTop: sp(8) }}>{t('How will the group get there?')}</TripLabel>
            {routeFields}

            <TripLabel style={{ marginTop: sp(14) }} right={nights !== null && nights >= 0 ? tn(nights, '{n} night', '{n} nights') : undefined}>{t('When would you like to go?')}</TripLabel>
            {dateFields}
            {/* what you already have on the chosen days: right under the dates (an activity blocks, a trip only warns) */}
            <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" creating="trip" onChanged={() => void clash.reload()} />
            <TripLabel style={{ marginTop: sp(10) }}>{t('How flexible are your dates?')}</TripLabel>
            {flexFields}
            <ErrorBanner message={act.error} />
          </>
        )}

        {step === 1 && (
          <>
            <TripHeading title={t('What kind of trip are you planning?')} subtitle={t('Set a budget range per person, what it covers and how big the group should be.')} />
            <TripLabel style={{ marginTop: sp(10) }}>{t('Budget per person')}</TripLabel>
            {budgetFields}
            <Text style={{ color: c.muted, fontSize: 12 }}>{t('Shown as an estimate, never a price.')}</Text>

            <TripLabel style={{ marginTop: sp(10) }} right={t('Choose at least one')}>{t('Includes')}</TripLabel>
            {includesFields}{includesHint}

            <TripLabel style={{ marginTop: sp(10) }}>{t('How big should the group be?')}</TripLabel>
            {sizeFields}

            <TripLabel style={{ marginTop: sp(10) }} right={t('Choose at least one')}>{t('Travel interests')}</TripLabel>
            {tagFields}{tagsHint}

            <TripLabel style={{ marginTop: sp(10) }}>{t('About the trip')}</TripLabel>
            {aboutField}
          </>
        )}

        {step === 2 && (
          <>
            <TripHeading title={t('Group guidelines')} subtitle={t('A trip is a proposal. These rules keep every group safe.')} />
            <TripCard style={{ marginTop: sp(6) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(10) }}>
                <Ionicons accessibilityElementsHidden name="alert-circle" size={sc(22)} color={c.danger} />
                <Text style={{ flex: 1, color: c.text, fontSize: 16, lineHeight: 23, fontWeight: '500' }}>{t('THERE is not a travel agency')}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18, paddingLeft: sph(32) }}>{t('THERE is not a travel agency. Everyone books flights, stays and activities themselves, directly with suppliers. Never ask for or send deposits.')}</Text>
            </TripCard>
            <View ref={agreeBox} collapsable={false} style={{ marginTop: sp(12), paddingHorizontal: sph(12), paddingVertical: sp(4), borderRadius: sc(20), borderWidth: tried && step === 2 && !agree ? 1.2 : 0, borderColor: c.danger }}>
              <CheckRow checked={agree} onChange={setAgree}>
                <Text style={{ color: c.text, fontSize: 16, lineHeight: 25 }}>{t('I confirm this is a non-commercial proposal for adults and I agree to the group guidelines.')}</Text>
              </CheckRow>
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <TripHeading title={t('Review your trip')} subtitle={t('Check everything before your trip goes live.')} />
            {!gate.verified && <Banner onPress={() => void gate.ask('publish')}>{gate.isGuest ? t("You're exploring as a guest. To publish, create a free account and verify your identity ›") : t('Verify your identity to publish. Everything you entered stays here ›')}</Banner>}
            <ErrorBanner message={act.error} />
            {/* every part can be changed from here: Edit opens its fields in a pop-up that grows out of the card, Done folds it back */}
            {/* the trip at a glance: its picture, the route, how long, how many people (Edit opens the route and dates) */}
            <ReviewCard title={t('Your trip')} onEdit={(from) => openPop('route', from)} missing={(routeProblems.length > 0 || busy) && t('Missing or not right: {what}. Tap Edit.', { what: busy ? t('you already have a plan on these days') : routeProblems.join(', ') })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(14) }}>
                <TripThumb t={{ tags: f.tags } as unknown as Trip} size={26} style={{ width: sc(96), height: sc(76), borderRadius: sc(20) }} />
                <View style={{ flex: 1, gap: sp(5) }}>
                  {together ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp(6) }}>
                      <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{f.originCity || '—'}</Text>
                      <Ionicons accessibilityElementsHidden name="airplane" size={sc(14)} color={c.muted} />
                      <Text numberOfLines={1} style={{ flexShrink: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{f.destination || '—'}</Text>
                    </View>
                  ) : (
                    <Text numberOfLines={2} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{f.destination || '—'}</Text>
                  )}
                  <Text style={{ color: c.muted, fontSize: 12 }}>{nights !== null && nights >= 0 ? t('{days} days / {n} nights', { days: nights + 1, n: nights }) : '—'}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 }}>{together ? t('Travel together') : t('Meet at destination')} · {groupLabel}</Text>
                </View>
              </View>
            </ReviewCard>

            {/* the dates, as two boxes side by side with a round mark between them */}
            <ReviewCard title={t('Travel dates')} onEdit={(from) => openPop('route', from)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(8) }}>
                {([[t('Departure date'), start], [t('Return date'), end]] as const).map(([label, day], i) => (
                  <Fragment key={label}>
                    {i === 1 ? (
                      <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: sc(30), height: sc(30), borderRadius: sc(15), backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="swap-horizontal" size={sc(16)} color="#fff" />
                      </View>
                    ) : null}
                    <View style={{ flex: 1, backgroundColor: c.bg, borderRadius: sc(22), paddingVertical: sp(10), paddingHorizontal: sph(14), gap: 2 }}>
                      <Text style={{ color: c.muted, fontSize: 12 }}>{label}</Text>
                      <Text numberOfLines={1} style={{ color: c.text, fontSize: 12, fontWeight: '500' }}>{day ? dayText(day) : '—'}</Text>
                    </View>
                  </Fragment>
                ))}
              </View>
              <Text style={{ color: c.muted, fontSize: 12 }}>{t('Dates: {flex}', { flex: flexLabel })}</Text>
            </ReviewCard>

            <ReviewCard title={t('Budget')} onEdit={(from) => openPop('budget', from)} missing={budgetProblems.length > 0 && t('Missing or not right: {what}. Tap Edit.', { what: budgetProblems.join(', ') })}>
              <Text style={{ color: c.text, fontSize: 16, fontWeight: '500' }}>{t('{range} per person', { range: `${money(min || 0, 'EUR')}–${money(max || 0, 'EUR')}` })}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{f.includes.length ? INCLUDES.filter(([k]) => f.includes.includes(k)).map(([, label]) => t(label)).join(' · ') : t('Nothing included')}</Text>
            </ReviewCard>

            <ReviewCard title={t('Group and interests')} onEdit={(from) => openPop('group', from)}>
              <Text style={{ color: c.text, fontSize: 16 }}>{groupLabel}</Text>
              {f.tags.some((x) => TRIP_TAGS.includes(x)) ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(6) }}>
                  {f.tags.filter((x) => TRIP_TAGS.includes(x)).map((tag) => (
                    <Chip key={tag} label={t(cap(tag))} tone="neutral" />
                  ))}
                </View>
              ) : (
                <Text style={{ color: c.muted, fontSize: 12 }}>{t('No interests chosen')}</Text>
              )}
            </ReviewCard>

            <ReviewCard title={t('About the trip')} onEdit={(from) => openPop('about', from)}>
              <Text style={{ color: f.description.trim() ? c.text : c.muted, fontSize: 16, lineHeight: 23 }}>{f.description.trim() || t('Nothing written yet')}</Text>
            </ReviewCard>
          </>
        )}
        </StepTransition>

        {/* on the last step, next to Publish: what stops it (the same card as under the dates) */}
        {step === STEPS - 1 && reviewTried && (routeProblems.length > 0 || budgetProblems.length > 0 || busy) ? <Banner tone="bad">{t('Some details are missing. Fix the parts marked in red, then publish.')}</Banner> : null}
        {step === STEPS - 1 ? <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" creating="trip" onChanged={() => void clash.reload()} /> : null}

        <AuthButton
          compact
          title={step < STEPS - 1 ? t('Continue') : gate.verified ? t('Publish trip') : gate.title('publish')}
          loading={step === STEPS - 1 && act.busy}
          onPress={() => (step < STEPS - 1 ? next() : void publish())}
          style={{ marginTop: sp(10) }}
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
          onClosed={() => (setPop(null), setPopTried(false))}
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
              {includesFields}{includesHint}
            </>
          ) : pop.card === 'group' ? (
            <>
              {sizeFields}
              {tagFields}{tagsHint}
            </>
          ) : (
            aboutField
          )}
        </EditPopup>
      ) : null}
    </View>
  );
}
