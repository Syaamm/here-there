import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { DraftBar } from '@/components/DraftBar';
import { useRouter } from 'expo-router';
import { AuthButton } from '@/components/AuthForm';
import { CategoryPill, CountPill, CreateLabel, MonthCalendar, PillArea, PillInput, PlacePick, RoundBtn, SmallPill, WizardTop } from '@/components/CreateParts';
import { OnboardingHeading } from '@/components/OnboardingParts';
import { type Place } from '@/components/PlaceSearch';
import { Banner, Between, CheckRow, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { shortDay } from '@/components/DateRangeSheet';
import { get, post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useCity } from '@/lib/city';
import { catColor, CATS, MILAN_AREAS } from '@/lib/constants';
import { useAction, useLoad } from '@/lib/hooks';
import { dropDraft } from '@/lib/drafts';
import { useFormDraft } from '@/lib/formDraft';
import { localeTag, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const DURATIONS = [1, 2, 3, 4, 6, 8];
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
      <Switch value={on} onValueChange={onChange} trackColor={{ true: '#43A047', false: '#B7DDB9' }} thumbColor="#fff" accessibilityLabel={on ? t('{title}: on', { title }) : t('{title}: off', { title })} />
    </View>
  );
}

/** Something has been typed (the time, size and category always have a value, so they do not count). */
const hasContent = (f: Draft) => !!(f.title.trim() || f.venueName.trim() || f.place || f.description.trim());

/**
 * HERE · Create: friction-light, but public-place-only and verified-host-only. Leaving the form (another tab, another
 * page) saves what was typed as a draft and the form comes back empty; the person's drafts are under "My drafts".
 * Changing `round` remounts the form, which is what empties it.
 */
export function CreateActivity() {
  const [round, setRound] = useState(0);
  return <ActivityForm key={round} onReset={() => setRound((r) => r + 1)} />;
}

function ActivityForm({ onReset }: { onReset: () => void }) {
  const { t, tn } = useT();
  const { me } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const [city, setCity] = useCity();
  // a clock that ticks, so options that have just become too soon disappear while the form is open
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, []);
  const earliest = earliestStart(now);
  const [f, setF] = useState<Draft>({ title: '', category: 'drinks', dayIdx: 0, hour: earliest.getHours(), minute: earliest.getMinutes(), duration: 2, capacity: 6, area: 'Brera', venueName: '', place: null, description: '', joinPolicy: 'host_approval' });
  const [publicPlace, setPublicPlace] = useState(false);
  const act = useAction();
  // leaving saves a draft and empties the form, "Clear all", and saving on leaving the app: shared with the trip form
  const { posted, clearAll } = useFormDraft('activity', f, hasContent, onReset);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const loadDraft = useCallback((d: Record<string, unknown>) => setF((p) => ({ ...p, ...(d as Partial<Draft>) })), []);

  const isMilan = city.trim().toLowerCase() === 'milan';
  const verified = me?.eligibility === 'verified';
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
  const hoursInPeriod = hours.filter((h) => (h >= 12 ? 'PM' : 'AM') === period);
  const pickPeriod = (p: 'AM' | 'PM') => {
    const inP = hours.filter((h) => (h >= 12 ? 'PM' : 'AM') === p);
    set('hour', inP.find((h) => h % 12 === hour % 12) ?? inP[0]); // keep the same clock number when it exists
  };
  const minutes = MINUTES.filter((m) => !(isEarliestDay && hour === earliest.getHours() && m < earliest.getMinutes()));
  const minute = minutes.includes(f.minute) ? f.minute : minutes[0];
  const startsAt = new Date(day.d);
  startsAt.setHours(hour, minute, 0, 0);
  const tooSoon = startsAt.getTime() < earliest.getTime();
  const valid = f.title.trim().length >= 2 && (f.place != null || f.venueName.trim().length >= 2) && publicPlace && !tooSoon;

  const submit = async () => {
    const endsAt = new Date(+startsAt + f.duration * 3600e3);
    // a place picked from the map search carries its own position; a typed name falls back to the neighbourhood in Milan
    const geo = f.place ? undefined : isMilan ? MILAN_AREAS[f.area] : undefined;
    const a = await act.run(() =>
      post<Activity>('/v1/activities', {
        title: f.title.trim(),
        category: f.category,
        description: f.description.trim() || undefined,
        city: city.trim(),
        venueName: f.place ? f.place.name : isMilan ? `${f.venueName.trim()} (${f.area})` : f.venueName.trim(),
        venuePlaceId: f.place?.id,
        lat: f.place ? f.place.lat : geo?.[0],
        lng: f.place ? f.place.lng : geo?.[1],
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: f.capacity,
        joinPolicy: f.joinPolicy,
      }),
    );
    if (a) {
      posted.current = true;
      void dropDraft('activity');
      go(`/activity/${a.id}`);
    }
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

  // the big clock: tap − / + for 5 minutes, press and hold for an hour
  const earliestMin = earliest.getHours() * 60 + earliest.getMinutes();
  const curMin = hour * 60 + minute;
  const canMove = (d: number) => curMin + d >= 0 && curMin + d <= 24 * 60 - 5 && !(isEarliestDay && curMin + d < earliestMin);
  const move = (d: number) => canMove(d) && setF((p) => ({ ...p, hour: Math.floor((curMin + d) / 60), minute: (curMin + d) % 60 }));
  const endsAt = new Date(+startsAt + f.duration * 3600e3);
  const clock = (d: Date) => d.toLocaleTimeString(localeTag(), { hour: 'numeric', minute: '2-digit' });

  const [step, setStep] = useState(0);
  const [month, setMonth] = useState(() => new Date(now));
  const router = useRouter();
  const back = () => (step > 0 ? setStep(step - 1) : router.canGoBack() ? router.back() : router.navigate('/' as never));
  const pickDay = (d: Date) => {
    const idx = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
    set('dayIdx', idx);
  };
  const stepTitles = [t('Activity Type Selection'), t('Activity Time & Date Selection'), t('Activity Spot Selection'), t('Activity Size & Access')];
  const stepOk = [f.title.trim().length >= 2, !tooSoon, (f.place != null || f.venueName.trim().length >= 2) && publicPlace, valid];
  const CAT_PHOTOS: Record<string, number> = {
    drinks: require('../../assets/interests/nightlife.webp'),
    coffee: require('../../assets/interests/coffee.webp'),
    sports: require('../../assets/interests/fitness.webp'),
    food: require('../../assets/interests/food.webp'),
    culture: require('../../assets/interests/culture.webp'),
  };
  const catOrder = ['drinks', 'coffee', 'sports', 'food', 'culture'].filter((k) => CATS[k]);
  const lastDay = latest ?? new Date(Date.now() + 24 * 3600e3);

  return (
    <View style={{ flex: 1 }}>
      <Screen tabBar>
        <WizardTop
          step={step}
          title={stepTitles[step]}
          onBack={back}
          right={
            <Pressable accessibilityRole="button" accessibilityLabel={t('Clear all')} accessibilityState={{ disabled: !hasContent(f) }} disabled={!hasContent(f)} hitSlop={8} onPress={() => void clearAll()} style={{ minHeight: 30, justifyContent: 'center', opacity: hasContent(f) ? 1 : 0.4 }}>
              <Text style={{ color: c.forest, fontSize: 13, fontWeight: '500' }}>{t('Clear all')}</Text>
            </Pressable>
          }
        />

        {step === 0 && (
          <>
            <OnboardingHeading title={t('What are you planning?')} subtitle={t('Choose a vibe and give your spontaneous plan a catchy name.')} />
            {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
            <CreateLabel style={{ marginTop: 6 }}>{t('Select category')}</CreateLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {catOrder.map((k) => (
                <CategoryPill key={k} label={t(CATS[k].label)} spoken={t('Category {label}', { label: t(CATS[k].label) })} photo={CAT_PHOTOS[k]} selected={f.category === k} onPress={() => set('category', k)} />
              ))}
            </View>
            <CreateLabel style={{ marginTop: 14 }}>{t('Activity name')}</CreateLabel>
            <PillInput label={t('Activity name')} placeholder={t('After-work aperitivo')} value={f.title} onChangeText={(v) => set('title', v)} maxLength={80} />
            <CreateLabel style={{ marginTop: 10 }}>{t('Description (optional)')}</CreateLabel>
            <PillArea label={t('Description')} placeholder={t('Casual drinks and conversation with new people.')} value={f.description} onChangeText={(v) => set('description', v)} maxLength={1000} />
          </>
        )}

        {step === 1 && (
          <>
            <OnboardingHeading title={t('When are you meeting?')} subtitle={t('HERE is built for right now, today, or tomorrow.')} />
            <CreateLabel style={{ marginTop: 6 }}>{t('Select a date')}</CreateLabel>
            <MonthCalendar month={month} onMonth={setMonth} selected={day.d} min={earliest} max={lastDay} onPick={pickDay} />
            {latest ? <Text style={{ color: c.muted, fontSize: 12 }}>{t('You can plan up to {date}.', { date: shortDay(latest) })}</Text> : null}

            <CreateLabel style={{ marginTop: 10 }}>{t('Select starting time')}</CreateLabel>
            <View style={{ backgroundColor: c.sand, borderRadius: 32, paddingVertical: 20, paddingHorizontal: 16, gap: 14, alignItems: 'center' }}>
              <Text accessibilityLabel={t('Starts at {time}', { time: clock(startsAt) })} style={{ fontSize: 32, lineHeight: 40, fontWeight: '700', color: c.text }}>
                {`${hour % 12 || 12}:${String(minute).padStart(2, '0')}`}
              </Text>
              <Row style={{ gap: 12 }}>
                {periods.map((p) => (
                  <SmallPill key={p} label={p} spoken={t('Start time {p}', { p })} active={period === p} onPress={() => pickPeriod(p)} />
                ))}
              </Row>
              <Row style={{ gap: 14 }}>
                <RoundBtn filled icon="remove" label={t('Earlier')} disabled={!canMove(-5)} onPress={() => move(-5)} onLongPress={() => move(-60)} />
                <Text style={{ color: c.text, fontSize: 14, fontWeight: '500', letterSpacing: 1 }}>{t('Adjust').toUpperCase()}</Text>
                <RoundBtn filled icon="add" label={t('Later')} disabled={!canMove(5)} onPress={() => move(5)} onLongPress={() => move(60)} />
              </Row>
            </View>
            <Text style={{ color: c.muted, fontSize: 12 }}>{t('Earliest: {n} min from now.', { n: LEAD_MIN })}</Text>

            <CreateLabel style={{ marginTop: 6 }}>{t('Quick pick')}</CreateLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {quick.map((q) => (
                <SmallPill key={q.label} label={q.label} active={startsAt.getTime() === q.at.getTime()} onPress={() => setStart(q.at)} />
              ))}
            </View>

            <Between style={{ marginTop: 6 }}>
              <CreateLabel>{t('Duration')}</CreateLabel>
              <Text style={{ color: c.muted, fontSize: 12 }}>{t('Ends {time}', { time: clock(endsAt) })}</Text>
            </Between>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {DURATIONS.map((h) => (
                <SmallPill key={h} label={`${h}h`} active={f.duration === h} onPress={() => set('duration', h)} />
              ))}
            </View>
          </>
        )}

        {step === 2 && (
          <>
            <OnboardingHeading title={t("Where's the spot?")} subtitle={t('Choose a public, easily accessible neighborhood spot for everyone to gather.')} />
            <PillInput label={t('City')} value={city} onChangeText={setCity} placeholder={t('City')} />
            <PlacePick
              label={t('Public meeting location')}
              text={f.venueName}
              onText={(v) => set('venueName', v)}
              place={f.place}
              onPlace={(p) => setF((prev) => ({ ...prev, place: p, venueName: p ? p.name : prev.venueName }))}
              city={city}
            />
            {f.place || !isMilan ? null : (
              <>
                <CreateLabel style={{ marginTop: 6 }}>{t('Neighborhood')}</CreateLabel>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {Object.keys(MILAN_AREAS).map((a) => (
                    <SmallPill key={a} label={a} active={f.area === a} onPress={() => set('area', a)} />
                  ))}
                </View>
              </>
            )}
            <View style={{ backgroundColor: c.sand, borderRadius: 24, paddingVertical: 8, paddingHorizontal: 16, marginTop: 6 }}>
              <CheckRow checked={publicPlace} onChange={setPublicPlace}>
                <Text style={{ color: c.text, fontSize: 14, lineHeight: 20, paddingVertical: 8 }}>{t('This is a public place. First meetings never happen at a private home.')}</Text>
              </CheckRow>
            </View>
          </>
        )}

        {step === 3 && (
          <>
            <OnboardingHeading title={t('Who can join?')} subtitle={t('Set your party size, privacy, and preview before going live.')} />
            {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
            <ErrorBanner message={act.error} />
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
              onChange={(on) => set('joinPolicy', on ? 'instant' : 'host_approval')}
            />
          </>
        )}

        <AuthButton
          title={step < 3 ? t('Continue') : t('Publish activity')}
          disabled={!stepOk[step]}
          loading={step === 3 && act.busy}
          onPress={() => (step < 3 ? setStep(step + 1) : void submit())}
          style={{ marginTop: 10 }}
        />
        {step === 3 ? (
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{t("Your activity is public in the feed. Only the venue is shown, never anyone's live location.")}</Text>
        ) : null}
        {/* always mounted: opening a saved draft from "My drafts" loads it whichever step is showing; its buttons show on the last step */}
        <View style={step === 3 ? undefined : { display: 'none' }}>
          <DraftBar kind="activity" data={f} onLoad={loadDraft} />
        </View>
      </Screen>
    </View>
  );
}
