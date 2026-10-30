import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { DraftBar } from '@/components/DraftBar';
import { PlaceSearch, type Place } from '@/components/PlaceSearch';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Between, Btn, CheckRow, ErrorBanner, Field, Row, Screen, Txt, useGo } from '@/components/ui';
import { DateRangeSheet, shortDay } from '@/components/DateRangeSheet';
import { get, post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useCity } from '@/lib/city';
import { catColor, CATS, MILAN_AREAS } from '@/lib/constants';
import { useAction, useLoad } from '@/lib/hooks';
import { isoDay, parseDay } from '@/lib/format';
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
    <Between>
      <Row style={{ flex: 1, gap: 10, paddingRight: 10, alignItems: 'flex-start' }}>
        <Ionicons name={icon} size={20} color={on ? c.forest : c.muted} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Txt variant="h3">{title}</Txt>
          <Txt variant="muted">{text}</Txt>
        </View>
      </Row>
      <Switch value={on} onValueChange={onChange} trackColor={{ true: '#2F7D65', false: '#ccc' }} thumbColor="#fff" accessibilityLabel={on ? t('{title}: on', { title }) : t('{title}: off', { title })} />
    </Between>
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
  const [calendar, setCalendar] = useState(false);
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

  const CAT_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
    coffee: 'cafe-outline',
    drinks: 'wine-outline',
    food: 'restaurant-outline',
    sports: 'basketball-outline',
    culture: 'color-palette-outline',
  };

  return (
    <View style={{ flex: 1 }}>
    <Screen tabBar header={<TabHeader />}>
      <Between>
        <View style={{ flex: 1 }}>
          <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{t('Create an activity')}</Txt>
        </View>
        <Btn title={t('Clear all')} variant="ghost" small onPress={() => void clearAll()} disabled={!hasContent(f)} />
      </Between>

      {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
      <ErrorBanner message={act.error} />

      <Section>
        <Field label={t('Activity name')} placeholder={t('After-work aperitivo')} value={f.title} onChangeText={(v) => set('title', v)} maxLength={80} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(CATS).map(([k, v]) => (
            <Choice key={k} tile icon={CAT_ICONS[k] ?? 'sparkles-outline'} label={t(v.label)} spoken={t('Category {label}', { label: t(v.label) })} active={f.category === k} onPress={() => set('category', k)} />
          ))}
        </View>
      </Section>

      <Section>
        <View style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 999, padding: 3 }}>
          {days.map((d) => (
            <Pressable
              key={d.i}
              accessibilityRole="button"
              accessibilityLabel={t('Day {label}', { label: t(d.label) })}
              accessibilityState={{ selected: day.i === d.i }}
              onPress={() => set('dayIdx', d.i)}
              style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: day.i === d.i ? c.forest : 'transparent' }}
            >
              <Txt variant="h3" color={day.i === d.i ? '#fff' : c.text} style={{ fontSize: 12, lineHeight: 16 }}>{t(d.label)}</Txt>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={later ? t('Day {label}', { label: shortDay(later.d) }) : t('Pick a later date')}
          accessibilityState={{ selected: !!later }}
          onPress={() => setCalendar(true)}
          style={{ height: 36, borderRadius: 12, borderWidth: 1.5, borderColor: later ? c.forest : c.line, backgroundColor: later ? c.accentSoft : 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <Ionicons name="calendar-outline" size={15} color={c.forest} />
          <Txt variant="h3" style={{ fontSize: 12, lineHeight: 16 }}>{later ? shortDay(later.d) : t('Pick a later date')}</Txt>
        </Pressable>
        {latest ? <Txt variant="small">{t('You can plan up to {date}.', { date: shortDay(latest) })}</Txt> : null}

        <View style={{ backgroundColor: c.sand, borderRadius: 16, padding: 10, gap: 8, alignItems: 'center' }}>
          <Row style={{ gap: 14 }}>
            <Round icon="remove" label={t('Earlier')} disabled={!canMove(-5)} onPress={() => move(-5)} onLongPress={() => move(-60)} />
            <Text accessibilityLabel={t('Starts at {time}', { time: clock(startsAt) })} style={{ fontSize: 32, lineHeight: 38, fontWeight: '800', color: c.text, minWidth: 100, textAlign: 'center' }}>
              {`${hour % 12 || 12}:${String(minute).padStart(2, '0')}`}
            </Text>
            <Round icon="add" label={t('Later')} disabled={!canMove(5)} onPress={() => move(5)} onLongPress={() => move(60)} />
          </Row>
          <Row style={{ gap: 8 }}>
            {periods.map((p) => (
              <Choice key={p} label={p} spoken={t('Start time {p}', { p })} active={period === p} onPress={() => pickPeriod(p)} />
            ))}
          </Row>
        </View>
        <Txt variant="small">{t('Earliest: {n} min from now.', { n: LEAD_MIN })}</Txt>

        <Txt variant="label">{t('Quick pick')}</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {quick.map((q) => (
            <Choice key={q.label} label={q.label} active={startsAt.getTime() === q.at.getTime()} onPress={() => setStart(q.at)} />
          ))}
        </View>

        <Between>
          <Txt variant="label">{t('Duration')}</Txt>
          <Txt variant="small">{t('Ends {time}', { time: clock(endsAt) })}</Txt>
        </Between>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {DURATIONS.map((h) => (
            <Choice key={h} label={`${h}h`} active={f.duration === h} onPress={() => set('duration', h)} />
          ))}
        </View>
      </Section>

      <Section>
        <Between>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{t('Maximum people')}</Txt>
            <Txt variant="small">{t('Including you')}</Txt>
          </View>
          <Row style={{ gap: 10 }}>
            <Round icon="remove" label={t('Fewer people')} disabled={f.capacity <= 2} onPress={() => set('capacity', Math.max(2, f.capacity - 1))} />
            <Txt variant="h2" style={{ fontSize: 18, lineHeight: 24, minWidth: 24, textAlign: 'center' }}>{f.capacity}</Txt>
            <Round icon="add" label={t('More people')} disabled={f.capacity >= 20} onPress={() => set('capacity', Math.min(20, f.capacity + 1))} />
          </Row>
        </Between>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {Array.from({ length: f.capacity }).map((_, i) => (
            <View key={i} accessibilityElementsHidden importantForAccessibility="no" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === 0 ? c.forest : 'transparent', borderWidth: 1.5, borderColor: i === 0 ? c.forest : c.muted }} />
          ))}
          <Txt variant="small" style={{ marginLeft: 6 }}>{tn(f.capacity - 1, 'You + {n} spot', 'You + {n} spots')}</Txt>
        </Row>
      </Section>

      <Section>
        <Field label={t('City')} value={city} onChangeText={setCity} />
        <PlaceSearch
          label={t('Public meeting location')}
          text={f.venueName}
          onText={(v) => set('venueName', v)}
          place={f.place}
          onPlace={(p) => setF((prev) => ({ ...prev, place: p, venueName: p ? p.name : prev.venueName }))}
          city={city}
        />
        {f.place ? null : isMilan ? (
          <>
            <Txt variant="label">{t('Neighborhood')}</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {Object.keys(MILAN_AREAS).map((a) => (
                <Choice key={a} label={a} active={f.area === a} onPress={() => set('area', a)} />
              ))}
            </View>
          </>
        ) : (
          <Txt variant="small">{t('Pick a place to show it on the map.')}</Txt>
        )}
        <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 10 }}>
          <CheckRow checked={publicPlace} onChange={setPublicPlace}>
            <Txt>{t('This is a public place. First meetings never happen at a private home.')}</Txt>
          </CheckRow>
        </View>
      </Section>

      <Section>
        <Field label={t('Description')} placeholder={t('Casual drinks and conversation with new people.')} multiline value={f.description} onChangeText={(v) => set('description', v)} maxLength={1000} />
      </Section>

      <Section>
        <Txt variant="h3">{t('Access control')}</Txt>
        {/* exactly one is always on: turning the one that is on off turns the other on */}
        <AccessRow
          icon="flash-outline"
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
      </Section>

      <Btn title={t('Publish activity')} onPress={submit} loading={act.busy} disabled={!valid} />
      <DraftBar kind="activity" data={f} onLoad={loadDraft} />
      <Txt variant="small">{t("Your activity is public in the feed. Only the venue is shown, never anyone's live location.")}</Txt>
    </Screen>
    {/* the calendar sits just above the dock, outside the scrolling page */}
    <DateRangeSheet
      single
      visible={calendar}
      focus="start"
      start={f.dayIdx >= 2 && later ? isoDay(later.d) : ''}
      end=""
      min={new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate())}
      max={latest ?? new Date(Date.now() + 24 * 3600e3)}
      onClose={() => setCalendar(false)}
      onDone={(s) => {
        const picked = parseDay(s);
        if (picked) set('dayIdx', Math.round((+picked - new Date().setHours(0, 0, 0, 0)) / 864e5));
        setCalendar(false);
      }}
    />
    </View>
  );
}
