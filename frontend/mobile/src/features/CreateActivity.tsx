import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, Switch, View, type HostInstance } from 'react-native';
import { Text, type InputHandle } from '@/components/ScaledText';
import { CatPhoto } from '@/components/CatPhoto';
import { DraftBar } from '@/components/DraftBar';
import { EditPopup, type Origin } from '@/components/EditPopup';
import { ClashNotice, planDays, tellWithdrawn, useClashes, type Withdrawn } from '@/components/ClashNotice';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { useClock } from '@/lib/clock';
import { AuthButton } from '@/components/AuthForm';
import { Collapse, StepTransition } from '@/components/StepMotion';
import { CategoryPill, CountPill, CreateLabel, dateFormat, MonthCalendar, PillArea, PillInput, PlacePick, RoundBtn, SmallPill, Wheel, WizardActions, WizardTop } from '@/components/CreateParts';
import { OnboardingHeading } from '@/components/OnboardingParts';
import { type Place } from '@/components/PlaceSearch';
import { Banner, BottomBar, Between, CheckRow, ErrorBanner, Row, Screen, Sheet, Txt, useGo } from '@/components/ui';
import { PlaceMapPreview } from '@/components/PlaceMapPreview';
import { shortDay } from '@/components/DateRangeSheet';
import { get, post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useVerifyGate } from '@/lib/verifyGate';
import { CITY_AREA_KM, useCity, useCityKnown, useCityPos } from '@/lib/city';
import { kmBetween, useCityCenter } from '@/features/mapShared';
import { CitySearch } from '@/components/CitySearch';
import { catColor, CATS } from '@/lib/constants';
import { useAction, useLoad } from '@/lib/hooks';
import { dropDraft } from '@/lib/drafts';
import { useFormDraft } from '@/lib/formDraft';
import { success, tap } from '@/lib/haptics';
import { closeKeyboard } from '@/lib/keyboard';
import { scrollToField } from '@/lib/pageScroll';
import { localeTag, useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { timeText } from '@/lib/format';
import { backFromMain } from '@/lib/nav';

/** the description: one or two light lines, not a paragraph (the server keeps the same limit) */
const DESC_MAX = 150;
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // every minute of the hour
const DURATIONS = [1, 2, 3, 4, 6]; // no 8-hour option: the five fit on one line
const LEAD_MIN = 10; // an activity can start no sooner than this many minutes from now

/** The earliest start the person can pick: now + 10 minutes, rounded up to the next 5. */
function earliestStart(now: number) {
  const d = new Date(now + LEAD_MIN * 60e3);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  return d;
}
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
/** The quick day choices: today (while there is still time left) and tomorrow. Any later day (up to the city's limit) is picked from a calendar. */
function dayChips(earliest: Date) {
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600e3);
  const days = [
    { i: 0, d: today, label: 'Today' },
    { i: 1, d: tomorrow, label: 'Tomorrow' },
  ];
  // the 10-minute lead can push the earliest start past midnight: then today has nothing left
  return sameDay(earliest, today) ? days : days.slice(1);
}

/** One card of the form. */
export function Section({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  return <View style={{ backgroundColor: c.surface, borderRadius: 18, borderWidth: 1, borderColor: c.line, padding: 12, gap: 10 }}>{children}</View>;
}

/** A choice chip; `tile` makes it a taller square with an icon above the word (categories). */
export function Choice({ label, active, onPress, icon, tile, spoken }: { /** what a screen reader says instead of the bare label, e.g. "Category Coffee" */ spoken?: string; label: string; active: boolean; onPress: () => void; icon?: React.ComponentProps<typeof Ionicons>['name']; tile?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 5, bottom: 5 }}
      onPress={onPress}
      style={({ pressed }) => [
        tile
          ? { flexGrow: 1, minWidth: 60, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', gap: 3 }
          : { height: 34, paddingHorizontal: 13, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
        { borderWidth: 1.5, borderColor: active ? c.forest : c.line, backgroundColor: active ? c.forest : c.surface },
        pressed && { opacity: 0.85 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={18} color={active ? '#fff' : c.text} /> : null}
      <Txt variant="h3" color={active ? '#fff' : c.text} style={{ fontSize: 12, lineHeight: 16 }}>{label}</Txt>
    </Pressable>
  );
}

/** Round − / + button. */
export function Round({ icon, label, onPress, onLongPress, disabled }: { icon: 'add' | 'remove'; label: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }, pressed && { transform: [{ scale: 0.92 }] }]}
    >
      <Ionicons name={icon} size={18} color={c.forest} />
    </Pressable>
  );
}

type Draft = { title: string; category: string; dayIdx: number; hour: number; minute: number; duration: number; capacity: number; area: string; venueName: string; place: Place | null; description: string; joinPolicy: 'instant' | 'host_approval' };

/** The small white "Edit" pill that takes the review page back to a step. */
function EditPill({ section, onPress, done }: { section: string; onPress: () => void; /** the open card's "Done" */ done?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={done ? t('Done') : t('Edit {section}', { section })}
      hitSlop={8}
      onPress={() => {
        tap('Medium'); // the dock's strength, for Edit and Done alike
        onPress();
      }}
      style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 30, paddingHorizontal: 12, borderRadius: 999, backgroundColor: done ? c.forest : c.surface }, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
    >
      <Ionicons name={done ? 'checkmark' : 'pencil'} size={13} color={done ? '#fff' : c.forest} />
      <Text style={{ color: done ? '#fff' : c.forest, fontSize: 13, fontWeight: '600' }}>{done ? t('Done') : t('Edit')}</Text>
    </Pressable>
  );
}

/** One part of the review page: a sand card with its name, an Edit pill, and what was chosen. Edit reports where the card is, so a pop-up can grow out of it. */
function ReviewSection({ title, onEdit, children, missing }: { title: string; onEdit: (from: Origin) => void; children: ReactNode; /** what is missing or wrong in this part (red border and this line); publishing waits for it */ missing?: string | false }) {
  const { c } = useTheme();
  const box = useRef<HostInstance>(null);
  return (
    <View ref={box} style={{ backgroundColor: c.sand, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderWidth: missing ? 1.2 : 0, borderColor: c.danger }}>
      <Between>
        <CreateLabel>{title}</CreateLabel>
        <EditPill section={title} onPress={() => box.current?.measureInWindow((x, y, width, height) => onEdit({ x, y, width, height }))} />
      </Between>
      {children}
      {missing ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16 }}>{missing}</Text> : null}
    </View>
  );
}

/** Which step's fields a review card opens: they are checked the same way as on that step. */
const CARD_STEP = { what: 0, when: 1, where: 2, who: 3 } as const;

/** An icon in a white circle, a main line and an optional small line under it. */
function ReviewLine({ icon, title, sub }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; sub?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={c.forest} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '500' }}>{title}</Text>
        {sub ? <Text style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

/** One way of letting people in, with its switch (see "Access control"). */
function AccessRow({ icon, title, text, on, onChange }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; text: string; on: boolean; onChange: (on: boolean) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 44 }}>
      <Ionicons name={icon} size={20} color={c.text} style={{ marginTop: 2, width: 24 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 16, lineHeight: 24, fontWeight: '500' }}>{title}</Text>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 22 }}>{text}</Text>
      </View>
      <Switch value={on} onValueChange={onChange} trackColor={{ true: c.green, false: c.line }} thumbColor={Platform.OS === 'android' && !on ? c.muted : '#fff'} ios_backgroundColor={c.line} accessibilityLabel={on ? t('{title}: on', { title }) : t('{title}: off', { title })} />
    </View>
  );
}

/** Something has been typed (the time, size and category always have a value, so they do not count). */
const hasContent = (f: Draft) => !!(f.title.trim() || f.venueName.trim() || f.place || f.description.trim());

/**
 * HERE · Create: friction-light, but public-place-only and verified-host-only. Leaving the form for another tab or page
 * keeps it as it was; leaving the app saves it as a draft (see useFormDraft). Changing `round` remounts the form, which is
 * what empties it (Clear all, or after publishing).
 */
export function CreateActivity() {
  const [round, setRound] = useState(0);
  return <ActivityForm key={round} onReset={() => setRound((r) => r + 1)} />;
}

function ActivityForm({ onReset }: { onReset: () => void }) {
  const { t, tn } = useT();
  const { me } = useMe();
  const gate = useVerifyGate();
  const { c } = useTheme();
  const go = useGo();
  // the activity's city is the app's city: picking another one here (from the city search) changes it for the whole app too
  const [city] = useCity();
  const cityPos = useCityPos();
  // a clock that ticks, so options that have just become too soon disappear while the form is open
  const now = useClock(20_000);
  const earliest = earliestStart(now);
  const [f, setF] = useState<Draft>({ title: '', category: 'drinks', dayIdx: 0, hour: earliest.getHours(), minute: earliest.getMinutes(), duration: 2, capacity: 6, area: 'Brera', venueName: '', place: null, description: '', joinPolicy: 'host_approval' });
  const [publicPlace, setPublicPlace] = useState(false);
  const act = useAction();
  // saving a draft when the app is left, "Clear all", and starting over after publishing: shared with the trip form
  const { posted, clearAll, stashNow, restart } = useFormDraft('activity', f, hasContent, onReset);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const loadDraft = useCallback((d: Record<string, unknown>) => {
    setF((p) => ({ ...p, ...(d as Partial<Draft>) }));
    setReviewing(false);
  }, []);

  // the activity's place must be a neighbourhood picked from the search, in or near the city (the same area the city's feed shows)
  const centre = useCityCenter(city, cityPos).at;
  const placeKm = f.place && centre ? kmBetween({ lat: centre[0], lng: centre[1] }, f.place) : null;
  const placeFar = placeKm !== null && placeKm > CITY_AREA_KM;
  const cityKnown = useCityKnown(); // without a real city the form would save the placeholder "Milan" as the activity's city
  const placeOk = f.place != null && !placeFar && cityKnown;
  // how far ahead this city's admin lets people plan (a month unless they set it otherwise)
  const limits = useLoad(() => get<{ here: { months: number; latest: string } }>(`/v1/regions/limits?city=${encodeURIComponent(city.trim())}`), [city.trim()]);
    const latest = limits.data ? new Date(limits.data.here.latest) : null;
  const days = dayChips(earliest);
  // dayIdx is how many days from today: 0 today, 1 tomorrow, more = a day picked from the calendar
  const later = f.dayIdx >= 2 ? { i: f.dayIdx, d: new Date(new Date().setHours(0, 0, 0, 0) + f.dayIdx * 864e5 + 12 * 3600e3), label: '' } : null;
  const day = later ?? days.find((d) => d.i === f.dayIdx) ?? days[0];
  const isEarliestDay = sameDay(day.d, earliest);
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => !isEarliestDay || h >= earliest.getHours());
  const hour = hours.includes(f.hour) ? f.hour : hours[0];
  // AM / PM are offered only where a valid start exists (at 3 pm today there is no AM), and follow the chosen hour
  const period: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';
  const periods = (['AM', 'PM'] as const).filter((p) => hours.some((h) => (h >= 12 ? 'PM' : 'AM') === p));
  const otherHalf = (h: number) => (h >= 12 ? h - 12 : h + 12); // the same clock number in the other half of the day
  const pickPeriod = (p: 'AM' | 'PM') => {
    const inP = hours.filter((h) => (h >= 12 ? 'PM' : 'AM') === p);
    set('hour', inP.find((h) => h % 12 === hour % 12) ?? inP[0]); // keep the same clock number when it exists
  };
  const periodHours = Array.from({ length: 12 }, (_, i) => (period === 'PM' ? 12 : 0) + i); // the hour wheel: 12, 1 … 11 of this half of the day
  const minutes = MINUTES.filter((m) => !(isEarliestDay && hour === earliest.getHours() && m < earliest.getMinutes()));
  const minute = minutes.includes(f.minute) ? f.minute : minutes[0];
  const startsAt = new Date(day.d);
  startsAt.setHours(hour, minute, 0, 0);
  const tooSoon = startsAt.getTime() < earliest.getTime();
  // one plan at a time: a plan you host or joined (HERE or THERE) at the chosen time blocks publishing
  const clash = useClashes(startsAt, new Date(+startsAt + f.duration * 3600e3));
  // only an activity of yours at that time stops you; a trip is just a warning (the person decides)
  const busy = clash.blocking.length > 0;
  // the days that already hold a plan of yours get a dot on the calendar (kept the same object until the plans or the minute change)
  const marks = useMemo(() => planDays(clash.all, Date.now()), [clash.all, Math.floor(clash.now / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = f.title.trim().length >= 2 && placeOk && publicPlace && !tooSoon && !busy;

  const submit = async () => {
    const endsAt = new Date(+startsAt + f.duration * 3600e3);
    const a = await act.run(() =>
      post<Activity & { withdrawn?: Withdrawn[] }>('/v1/activities', {
        title: f.title.trim(),
        category: f.category,
        description: f.description.trim() || undefined,
        city: city.trim(),
        venueName: f.place ? f.place.name : f.venueName.trim(),
        venuePlaceId: f.place?.id,
        lat: f.place?.lat,
        lng: f.place?.lng,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: f.capacity,
        joinPolicy: f.joinPolicy,
      }),
    );
    if (a) {
      posted.current = true;
      success();
      void dropDraft('activity', f);
      await tellWithdrawn(a.withdrawn, t('Your activity is live'));
      go(`/activity/${a.id}`);
    } else void clash.reload(); // refused because of a clash: show what is in the way
  };

  // set the whole start (day and clock) from one moment, for the quick picks
  const setStart = (at: Date) => setF((p) => ({ ...p, dayIdx: sameDay(at, new Date()) ? 0 : 1, hour: at.getHours(), minute: at.getMinutes() }));
  const roundUp5 = (ms: number) => {
    const d = new Date(ms);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return d;
  };
  const evening = new Date(now);
  evening.setHours(19, 0, 0, 0);
  if (evening.getTime() < earliest.getTime()) evening.setDate(evening.getDate() + 1);
  const lastStart = new Date(now + 24 * 3600e3);
  lastStart.setHours(23, 55, 0, 0);
  const quick = [
    { label: t('In {n} min', { n: LEAD_MIN }), at: earliest },
    { label: t('In 30 min'), at: roundUp5(now + 30 * 60e3) },
    { label: t('In 1 hour'), at: roundUp5(now + 60 * 60e3) },
    { label: t('7:00 PM'), at: evening },
  ].filter((q) => q.at.getTime() >= earliest.getTime() && q.at.getTime() <= lastStart.getTime());
  const quickHere = quick.filter((q) => sameDay(q.at, day.d)); // the picks that fall on the date chosen above

  // the big clock: tap − / + for a minute, press and hold for 5 minutes
  const earliestMin = earliest.getHours() * 60 + earliest.getMinutes();
  const curMin = hour * 60 + minute;
  const canMove = (d: number) => curMin + d >= 0 && curMin + d <= 24 * 60 - 1 && !(isEarliestDay && curMin + d < earliestMin);
  const move = (d: number) => canMove(d) && setF((p) => ({ ...p, hour: Math.floor((curMin + d) / 60), minute: (curMin + d) % 60 }));
  const endsAt = new Date(+startsAt + f.duration * 3600e3);
  const clock = (d: Date) => timeText(d); // the app's one time format (lib/format)

  const [step, setStep] = useState(0);
  const [barH, setBarH] = useState(0); // the height of the pinned Continue bar, so the page can scroll clear of it
  // a Continue that found something missing: that field is shown to the person (scrolled to, marked red), no message
  const [tried, setTried] = useState(false);
  useEffect(() => setTried(false), [step]);
  const titleBox = useRef<HostInstance>(null);
  const timeBox = useRef<HostInstance>(null);
  const placeBox = useRef<HostInstance>(null);
  const publicBox = useRef<HostInstance>(null);
  // Steps stay built once they were shown, hidden while another one is on screen, so going between them only shows or hides
  // one (no rebuilding the calendar and time wheels each time). The time step is also built quietly just after the form opens,
  // so the first Continue is instant too.
  const [built, setBuilt] = useState<number[]>([0]);
  if (!built.includes(step)) setBuilt((b) => (b.includes(step) ? b : [...b, step]));
  useEffect(() => {
    const job = setTimeout(() => setBuilt((b) => (b.includes(1) ? b : [...b, 1])), 400); // once the first step has settled
    return () => clearTimeout(job);
  }, []);
  const stepShown = (i: number) => (built.includes(i) || step === i ? { display: step === i ? ('flex' as const) : ('none' as const), gap: 16 } : null);
  // the review page after the four steps: everything chosen, each part with an Edit link back to its step; publishing happens only there
  const [reviewing, setReviewing] = useState(false);
  // a review card being edited in a pop-up that grows out of it (and shrinks back into it on Done)
  const [pop, setPop] = useState<null | { card: 'what' | 'when' | 'where' | 'who'; from: Origin }>(null);
  const [closing, setClosing] = useState(false);
  // Done was tapped in a pop-up whose fields are not right: they are marked red, as on their step, and it stays open
  const [popTried, setPopTried] = useState(false);
  // Publish was tapped with something missing: the review cards that need it are marked, and a line says so
  const [reviewTried, setReviewTried] = useState(false);
  const openPop = (card: 'what' | 'when' | 'where' | 'who', from: Origin) => {
    Keyboard.dismiss();
    setClosing(false);
    setPopTried(false);
    setPop({ card, from });
  };
  const bannerRef = useRef<HostInstance>(null);
  const edit = (i: number) => {
    setReviewing(false);
    setStep(i);
  };
  // both create forms stay built (one is hidden): only the one in front, on the Create tab, answers the phone's Back button
  const tabFocused = useIsFocused();
  const { mode: productMode } = useTheme(); // both hooks run every time (never one behind the other's `&&`)
  const inFront = tabFocused && productMode === 'here';
  useEffect(() => {
    if (!reviewing || !inFront) return;
    // Android's back button leaves the review page for the last step (not the Create tab)
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setReviewing(false), true));
    return () => sub.remove();
  }, [reviewing, inFront]);
  useEffect(() => Keyboard.dismiss(), [step]); // a new step starts with the keyboard down
  const descRef = useRef<InputHandle>(null);
  const placeRef = useRef<InputHandle>(null);
  const [month, setMonth] = useState(() => new Date(now));
  // the calendar always shows the month of the day that is picked (a quick pick, a draft or the review's Edit can move it)
  useEffect(() => setMonth(new Date(day.d)), [day.d.getFullYear(), day.d.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps
  // coming back to a form that has nothing typed in it: it starts on today, at the earliest time (a form being filled keeps its date)
  const fresh = useRef({ f, has: hasContent(f) });
  fresh.current = { f, has: hasContent(f) };
  useFocusEffect(
    useCallback(() => {
      if (fresh.current.has) return;
      const e = earliestStart(Date.now());
      setF((p) => ({ ...p, dayIdx: 0, hour: e.getHours(), minute: e.getMinutes() }));
      setStep(0);
    }, []),
  );
  const router = useRouter();
  const back = () => (step > 0 ? setStep(step - 1) : router.navigate(backFromMain() as never));
  const pickDay = (d: Date) => {
    const idx = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
    set('dayIdx', idx);
  };
  const stepTitles = [t('Activity type'), t('Date and time'), t('Meeting place'), t('Group size and access')];
  const stepOk = [f.title.trim().length >= 2, !tooSoon && !busy, placeOk && publicPlace, valid];
  /** a step's fields show what is wrong: after Continue on that step, or after Done in a review pop-up that opened them */
  const bad = (i: number) => (tried && step === i) || (popTried && !!pop && CARD_STEP[pop.card] === i);
  /** Done in a review pop-up: only when its fields are right (empty or wrong ones are marked, the pop-up stays) */
  const donePop = () => {
    const i = pop ? CARD_STEP[pop.card] : 3;
    if (i < 3 && !stepOk[i]) {
      closeKeyboard();
      tap('Medium');
      setPopTried(true);
      return;
    }
    Keyboard.dismiss();
    setPopTried(false);
    setClosing(true);
  };
  /** Publish: everything is checked first (the parts that are not right are marked), then a verified account, then it goes live */
  const publishNow = () => {
    if (!valid) {
      tap('Medium');
      setReviewTried(true);
      return;
    }
    setReviewTried(false);
    if (!gate.verified) return void gate.ask('publish');
    void submit();
  };
  // a step can be opened once every step before it is done (going back is always fine)
  const canStep = (i: number) => i < step || stepOk.slice(0, i).every(Boolean);
  // the keyboard's return key on a step's last field: on to the next step if this one is done, else just put the keyboard away
  const refFor = (at: number) => (at === 0 ? titleBox : at === 1 ? timeBox : placeOk ? publicBox : placeBox);
  /** Continue / Review: on if this step is done; else show what is missing (the first step that is not done, when it is the last) */
  const next = () => {
    if (stepOk[step]) {
      setTried(false);
      if (step < 3) setStep(step + 1);
      else (Keyboard.dismiss(), setReviewing(true));
      return;
    }
    closeKeyboard();
    tap('Medium');
    const at = step === 3 ? [0, 1, 2].find((i) => !stepOk[i]) ?? 3 : step;
    if (at !== step) {
      setStep(at);
      setTimeout(() => (setTried(true), scrollToField(refFor(at))), 350);
    } else {
      setTried(true);
      setTimeout(() => scrollToField(refFor(at)), 60);
    }
  };
  // Android's Back button on a later step goes one step back, not out of the form
  useEffect(() => {
    if (Platform.OS !== 'android' || step === 0 || reviewing || !inFront) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setStep(step - 1), true));
    return () => sub.remove();
  }, [step, reviewing, inFront]);
  const nextFromKeyboard = () => (step < 3 ? next() : Keyboard.dismiss());
  const CAT_PHOTOS: Record<string, number> = {
    drinks: require('../../assets/interests/nightlife.webp'),
    coffee: require('../../assets/interests/coffee.webp'),
    sports: require('../../assets/interests/fitness.webp'),
    food: require('../../assets/interests/food.webp'),
    culture: require('../../assets/interests/culture.webp'),
  };
  const [catRow, setCatRow] = useState(0);
  const catW = catRow ? Math.floor((catRow - 2 * 10) / 3) : undefined;
  const catOrder = ['drinks', 'coffee', 'sports', 'food', 'culture'].filter((k) => CATS[k]);
  const lastDay = latest ?? new Date(Date.now() + 24 * 3600e3);

  // the controls of the first three steps; the review page shows the same ones when a card is opened to edit it
  const whatFields = (
    <>
      <CreateLabel style={{ marginTop: 6 }}>{t('Select category')}</CreateLabel>
      {/* three equal columns, measured from the row itself, so any screen width (narrow Android phones too) fits three to a row */}
      <View onLayout={(e) => setCatRow(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {catOrder.map((k) => (
          <CategoryPill key={k} width={catW} label={t(CATS[k].label)} spoken={t('Category {label}', { label: t(CATS[k].label) })} photo={CAT_PHOTOS[k]} selected={f.category === k} onPress={() => set('category', k)} />
        ))}
      </View>
      <CreateLabel style={{ marginTop: 14 }}>{t('Activity name')}</CreateLabel>
      <View ref={titleBox} collapsable={false}>
        <PillInput label={t('Activity name')} placeholder={t('After-work aperitivo')} value={f.title} onChangeText={(v) => set('title', v)} maxLength={80} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => descRef.current?.focus()} style={bad(0) && f.title.trim().length < 2 ? { borderWidth: 1.2, borderColor: c.danger } : undefined} />
      </View>
      {bad(0) && f.title.trim().length < 2 ? <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16, paddingLeft: 4, marginTop: -6 }}>{t('Give your activity a name (at least 2 letters).')}</Text> : null}
      <CreateLabel style={{ marginTop: 10 }}>{t('Description (optional)')}</CreateLabel>
      {/* its return key moves on to the next step (so it takes no new lines) */}
      <PillArea ref={descRef} label={t('Description')} placeholder={t('Casual drinks and conversation with new people.')} value={f.description} onChangeText={(v) => set('description', v.slice(0, DESC_MAX))} maxLength={DESC_MAX} returnKeyType="next" submitBehavior="submit" onSubmitEditing={reviewing ? () => Keyboard.dismiss() : nextFromKeyboard} style={{ minHeight: sc(76) }} />
      <Text accessibilityElementsHidden importantForAccessibility="no" style={{ alignSelf: 'flex-end', marginTop: -8, marginRight: 14, color: f.description.length >= DESC_MAX ? c.text : c.muted, fontSize: 12 }}>{`${f.description.length}/${DESC_MAX}`}</Text>
    </>
  );
  const whenFields = (
    <>
      <CreateLabel style={{ marginTop: 6 }}>{t('Select a date')}</CreateLabel>
      <MonthCalendar month={month} onMonth={setMonth} selected={day.d} min={earliest} max={lastDay} onPick={pickDay} marks={marks} />
      {latest ? <Text style={{ color: c.muted, fontSize: 12 }}>{t('You can plan up to {date}.', { date: shortDay(latest) })}</Text> : null}
      {/* what you already have at the chosen day and time: right under the calendar, where the day was picked */}
      <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" onChanged={() => void clash.reload()} />

      <CreateLabel style={{ marginTop: 10 }}>{t('Select starting time')}</CreateLabel>
      {/* scroll the hour and the minute; − / + beside them nudge by a minute (hold for 5 minutes). Times too soon are greyed and spring back. */}
      <View ref={timeBox} collapsable={false} accessibilityLabel={t('Starts at {time}', { time: clock(startsAt) })} style={{ backgroundColor: c.sand, borderRadius: 32, paddingVertical: 12, paddingHorizontal: 16, gap: 10, alignItems: 'center', borderWidth: bad(1) && (tooSoon || busy) ? 1.2 : 0, borderColor: c.danger }}>
        <Row style={{ gap: 10, alignItems: 'center' }}>
          <RoundBtn filled icon="remove" label={t('Earlier')} disabled={!canMove(-1)} onPress={() => move(-1)} onLongPress={() => move(canMove(-5) ? -5 : -1)} />
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {/* An hour that is already past today is not refused when the same clock number is still ahead in the other half of the
                day: at 10:05 AM, picking 12 (AM, midnight) becomes 12 PM, and at 3 PM picking 1 PM gives 1 AM only when that is ahead
                (on today's date it is not, so it stays greyed). Other days have no past hours, so nothing flips there. */}
            <Wheel
              items={periodHours}
              value={hour}
              onChange={(h) => set('hour', hours.includes(h) ? h : hours.includes(otherHalf(h)) ? otherHalf(h) : h)}
              label={(h) => String(h % 12 || 12)}
              disabled={(h) => !hours.includes(h) && !hours.includes(otherHalf(h))}
              spoken={t('Hour')}
            />
            <Text style={{ fontSize: 26, lineHeight: 32, fontWeight: '700', color: c.text }}>:</Text>
            <Wheel items={MINUTES} value={minute} onChange={(m) => set('minute', m)} label={(m) => String(m).padStart(2, '0')} disabled={(m) => !minutes.includes(m)} spoken={t('Minute')} />
          </View>
          <RoundBtn filled icon="add" label={t('Later')} disabled={!canMove(1)} onPress={() => move(1)} onLongPress={() => move(canMove(5) ? 5 : 1)} />
        </Row>
        <Row style={{ gap: 12 }}>
          {periods.map((p) => (
            <SmallPill key={p} label={p} spoken={t('Start time {p}', { p })} active={period === p} onPress={() => pickPeriod(p)} />
          ))}
        </Row>
      </View>
      <Text style={{ color: c.muted, fontSize: 12 }}>{t('Earliest: {n} min from now.', { n: LEAD_MIN })}</Text>

      {/* only the picks on the date chosen above; on another date the section folds away */}
      <Collapse open={quickHere.length > 0} gap={reviewing ? 14 : 16}>
        <View style={{ gap: 16 }}>
          <CreateLabel style={{ marginTop: 6 }}>{t('Quick pick')}</CreateLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 6 }}>
            {quickHere.map((q) => (
              <SmallPill compact key={q.label} label={q.label} active={startsAt.getTime() === q.at.getTime()} onPress={() => setStart(q.at)} />
            ))}
          </View>
        </View>
      </Collapse>

      <Between style={{ marginTop: 6 }}>
        <CreateLabel>{t('Duration')}</CreateLabel>
        <Text style={{ color: c.muted, fontSize: 12 }}>{t('Ends {time}', { time: clock(endsAt) })}</Text>
      </Between>
      <View style={{ flexDirection: 'row', flexWrap: 'nowrap', gap: 6 }}>
        {DURATIONS.map((h) => (
          <SmallPill compact key={h} label={`${h}h`} active={f.duration === h} onPress={() => set('duration', h)} />
        ))}
      </View>
    </>
  );
  const whereFields = (
    <>
      <View ref={placeBox} collapsable={false}>
      <PlacePick
        invalid={bad(2) && !placeOk}
        label={t('Neighborhood')}
        text={f.venueName}
        onText={(v) => set('venueName', v)}
        place={f.place}
        onPlace={(p) => setF((prev) => ({ ...prev, place: p, venueName: p ? p.name : prev.venueName }))}
        city={city}
        near={cityPos}
        inputRef={placeRef}
        onSubmit={reviewing ? () => Keyboard.dismiss() : nextFromKeyboard}
      />
      </View>
      {/* a small piece of map: the picked place with a pin, or the city until one is picked */}
      <PlaceMapPreview at={f.place ? { lat: f.place.lat, lng: f.place.lng } : centre ? { lat: centre[0], lng: centre[1] } : null} picked={!!f.place} />
      {/* only a neighbourhood picked from the list, in or near the city, lets the step go on: say why when it cannot */}
      {placeFar && f.place ? (
        <Banner tone="bad">{t('{place} is about {km} km from {city}. Pick a neighbourhood in or near {city} (within {limit} km), or change the city above.', { place: f.place.name, km: Math.round(placeKm!), city, limit: CITY_AREA_KM })}</Banner>
      ) : !f.place && f.venueName.trim().length >= 2 ? (
        <Text style={{ color: bad(2) ? c.danger : c.muted, fontSize: 13, lineHeight: 18 }}>{t('Pick a neighbourhood from the list to continue.')}</Text>
      ) : !f.place && bad(2) ? (
        <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 13, lineHeight: 18 }}>{t('Search for a neighbourhood and pick it from the list.')}</Text>
      ) : null}
      {/* the city is the app's city: shown here, not chosen (change it on Home or the map); the neighbourhood is searched inside it */}
      <View accessible accessibilityLabel={t('City: {city}', { city })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, borderRadius: 32, backgroundColor: c.sand, paddingHorizontal: 20 }}>
        <Ionicons name="location" size={18} color={c.forest} />
        <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 14, fontWeight: '600' }}>{city}</Text>
        <Ionicons name="lock-closed-outline" size={15} color={c.muted} />
      </View>
      {cityKnown ? (
        <Text style={{ color: c.muted, fontSize: 12, marginTop: -6, paddingLeft: 4 }}>{t('Your activity is in your current city. To post somewhere else, change the city on Home first.')}</Text>
      ) : (
        <Banner tone="warn" onPress={() => go('/')}>{t('Choose your city on Home first. Your activity is posted in your city.')}</Banner>
      )}
      <View ref={publicBox} collapsable={false} style={{ backgroundColor: '#F7F7F5', borderRadius: 24, paddingVertical: 16, paddingHorizontal: 16, marginTop: 6, borderWidth: bad(2) && placeOk && !publicPlace ? 1.2 : 0, borderColor: c.danger }}>
        <CheckRow checked={publicPlace} onChange={setPublicPlace}>
          <Text style={{ color: c.text, fontSize: 14, lineHeight: 24 }}>{t('This is a public place. First meetings never happen at a private home.')}</Text>
        </CheckRow>
      </View>
    </>
  );

  const whoFields = (
    <>
      <CreateLabel style={{ marginTop: 14 }}>{t('Maximum people')}</CreateLabel>
      <CountPill
        value={f.capacity}
        minusLabel={t('Fewer people')}
        plusLabel={t('More people')}
        canMinus={f.capacity > 2}
        canPlus={f.capacity < 20}
        onMinus={() => set('capacity', Math.max(2, f.capacity - 1))}
        onPlus={() => set('capacity', Math.min(20, f.capacity + 1))}
      />
      <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>{`${t('Including you')} · ${tn(f.capacity - 1, 'You + {n} spot', 'You + {n} spots')}`}</Text>

      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 20, lineHeight: 26, fontWeight: '500', marginTop: 16 }}>{t('Access control')}</Text>
      {/* exactly one is always on: turning the one that is on off turns the other on */}
      <AccessRow
        icon="flash"
        title={t('Instant join')}
        text={t('Verified people join at once.')}
        on={f.joinPolicy === 'instant'}
        onChange={(on) => set('joinPolicy', on ? 'instant' : 'host_approval')}
      />
      <View style={{ height: 1, backgroundColor: c.line }} />
      <AccessRow
        icon="hand-left-outline"
        title={t('Request to join')}
        text={t('You approve each person.')}
        on={f.joinPolicy === 'host_approval'}
        onChange={(on) => set('joinPolicy', on ? 'host_approval' : 'instant')}
      />
    </>
  );

  const venue = f.place ? f.place.name : f.venueName.trim();
  return (
    <View style={{ flex: 1 }}>
      {reviewing ? (
        <Screen tabBar plain title={t('Review activity')} onBack={() => setReviewing(false)}>
          <OnboardingHeading title={t('Check your activity')} subtitle={t('Check everything before your activity goes live.')} />
          {!gate.verified && <Banner onPress={() => void gate.ask('publish')}>{gate.isGuest ? t("You're exploring as a guest. To publish, create a free account and verify your identity ›") : t('Verify your identity to publish. Everything you entered stays here ›')}</Banner>}
          <ErrorBanner message={act.error} />
          {/* the activity's photo with its name over it, as it will look in the feed */}
          <View ref={bannerRef}>
          <CatPhoto category={f.category} style={{ height: 170, borderRadius: 24, justifyContent: 'flex-end' }}>
            <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.6)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 }} />
            <View style={{ position: 'absolute', top: 12, right: 12 }}>
              <EditPill section={t('What')} onPress={() => bannerRef.current?.measureInWindow((x, y, width, height) => openPop('what', { x, y, width, height }))} />
            </View>
            <View style={{ padding: 16, gap: 2 }}>
              <Text numberOfLines={2} style={{ color: '#fff', fontSize: 22, lineHeight: 28, fontWeight: '700' }}>{f.title.trim()}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.88)', fontSize: 14 }}>{t(CATS[f.category]?.label ?? f.category)}</Text>
            </View>
          </CatPhoto>
          </View>
          {!stepOk[0] ? (
            <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16, marginTop: -6, paddingLeft: 4 }}>{t('The activity name is missing. Tap Edit on the photo to add it.')}</Text>
          ) : null}
          <ReviewSection title={t('When')} onEdit={(from) => openPop('when', from)} missing={!stepOk[1] && (busy ? t('You already have a plan at this time. Tap Edit to change it.') : t('This time has passed. Tap Edit to pick a later one.'))}>
            <ReviewLine icon="calendar-outline" title={shortDay(startsAt)} />
            <ReviewLine icon="time-outline" title={`${clock(startsAt)} – ${clock(endsAt)}`} sub={`${f.duration}h`} />
          </ReviewSection>
          <ReviewSection title={t('Where')} onEdit={(from) => openPop('where', from)} missing={!stepOk[2] && (!placeOk ? t('The meeting place is missing. Tap Edit to pick one.') : t('Confirm it is a public place. Tap Edit.'))}>
            <ReviewLine icon="location-outline" title={venue} sub={city.trim()} />
          </ReviewSection>
          <ReviewSection title={t('Who can join')} onEdit={(from) => openPop('who', from)}>
            <ReviewLine icon="people-outline" title={t('{n} people', { n: f.capacity })} sub={t('Including you')} />
            <ReviewLine icon={f.joinPolicy === 'instant' ? 'flash' : 'hand-left-outline'} title={f.joinPolicy === 'instant' ? t('Instant join') : t('Request to join')} sub={f.joinPolicy === 'instant' ? t('Verified people join at once.') : t('You approve each person.')} />
          </ReviewSection>
          <ClashNotice firm={clash.firm} pending={clash.pending} now={clash.now} mode="create" onChanged={() => void clash.reload()} />
          {reviewTried && !valid ? <Banner tone="bad">{t('Some details are missing. Fix the parts marked in red, then publish.')}</Banner> : null}
          <AuthButton compact title={gate.verified ? t('Publish activity') : gate.title('publish')} loading={act.busy} onPress={publishNow} style={{ marginTop: 10 }} />
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t("Your activity is public in the feed. Only the venue is shown, never anyone's live location.")}</Text>
        </Screen>
      ) : null}
      {pop ? (
        <EditPopup
          from={pop.from}
          closing={closing}
          onDone={donePop}
          onClosed={() => (setPop(null), setPopTried(false))}
          header={
            <View style={{ alignItems: 'flex-end' }}>
              <EditPill section="" done onPress={donePop} />
            </View>
          }
        >
          {pop.card === 'what' ? whatFields : pop.card === 'when' ? whenFields : pop.card === 'who' ? whoFields : whereFields}
        </EditPopup>
      ) : null}
      {/* the steps stay mounted under the review page, so going back to edit keeps everything (and a draft opened meanwhile still loads) */}
      <View style={reviewing ? { display: 'none' } : { flex: 1 }}>
      <Screen tabBar plain bottomRoom={barH} header={
    <WizardTop
      step={step}
      title={stepTitles[step]}
      onBack={back}
      onStep={setStep}
      canStep={canStep}
      right={<WizardActions canRestart={step > 0 || reviewing || hasContent(f)} onRestart={() => void restart()} canClear={hasContent(f)} onClear={() => void clearAll()} />}
    />
      }>

        {/* swipe left for the next step (once this one is done), right for the one before; it stops at step 4 */}
        <StepTransition step={step} style={{ gap: 16 }} swipe={{ canNext: step < 3 && stepOk[step], canBack: step > 0, onNext: () => setStep(step + 1), onBack: () => setStep(step - 1) }}>
        {stepShown(0) && (
          <View style={stepShown(0)}>
            <OnboardingHeading title={t('What are you planning?')} subtitle={t('Choose a vibe and give your spontaneous plan a catchy name.')} />
            {whatFields}
          </View>
        )}

        {stepShown(1) && (
          <View style={stepShown(1)}>
            <OnboardingHeading title={t('When are you meeting?')} subtitle={t('HERE is built for right now, today, or tomorrow.')} />
            {whenFields}
          </View>
        )}

        {stepShown(2) && (
          <View style={stepShown(2)}>
            <OnboardingHeading title={t("Where's the spot?")} subtitle={t('Choose a public, easily accessible neighborhood spot for everyone to gather.')} />
            {whereFields}
          </View>
        )}

        {stepShown(3) && (
          <View style={stepShown(3)}>
            <OnboardingHeading title={t('Who can join?')} subtitle={t('Set your party size, privacy, and preview before going live.')} />
            <ErrorBanner message={act.error} />
            {whoFields}
          </View>
        )}
        </StepTransition>

        {/* on every step: saving a draft (a draft opened from My drafts loads whichever step is showing) */}
        <DraftBar kind="activity" data={f} onLoad={loadDraft} beforeLoad={stashNow} showMyDrafts={step === 0} named={f.title.trim().length > 0} />
      </Screen>
      {/* Continue stays at the bottom of the screen, whatever the step is long */}
      <BottomBar onHeight={setBarH}>
        <AuthButton compact title={step < 3 ? t('Continue') : t('Review')} disabled={step === 2 && placeFar && !!f.place} onPress={next} />
      </BottomBar>
      </View>
    </View>
  );
}
