import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Between, Btn, CheckRow, Chip, ErrorBanner, Field, Row, Screen, Txt, useGo } from '@/components/ui';
import { post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useCity } from '@/lib/city';
import { catColor, CATS, MILAN_AREAS } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

const DRAFT = 'ht_activity_draft';
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
/** HERE is for plans within a day: today (while there is still time left) or tomorrow. */
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

type Draft = { title: string; category: string; dayIdx: number; hour: number; minute: number; duration: number; capacity: number; area: string; venueName: string; description: string };

/** HERE · Create: friction-light, but public-place-only and verified-host-only. Drafts stay on this device. */
export function CreateActivity() {
  const { me } = useMe();
  const { c } = useTheme();
  const go = useGo();
  const [city, setCity] = useCity();
  // a clock that ticks, so options that have just become too soon disappear while the form is open
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  const earliest = earliestStart(now);
  const [f, setF] = useState<Draft>({ title: '', category: 'drinks', dayIdx: 0, hour: earliest.getHours(), minute: earliest.getMinutes(), duration: 2, capacity: 6, area: 'Brera', venueName: '', description: '' });
  const [publicPlace, setPublicPlace] = useState(false);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    AsyncStorage.getItem(DRAFT)
      .then((raw) => raw && setF((p) => ({ ...p, ...JSON.parse(raw) })))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => AsyncStorage.setItem(DRAFT, JSON.stringify(f)).then(() => setSaved(true)).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [f]);

  const isMilan = city.trim().toLowerCase() === 'milan';
  const verified = me?.eligibility === 'verified';
  const days = dayChips(earliest);
  const day = days.find((d) => d.i === f.dayIdx) ?? days[0];
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
  const valid = f.title.trim().length >= 2 && f.venueName.trim().length >= 2 && publicPlace && !tooSoon;

  const submit = async () => {
    const endsAt = new Date(+startsAt + f.duration * 3600e3);
    const geo = isMilan ? MILAN_AREAS[f.area] : undefined;
    const a = await act.run(() =>
      post<Activity>('/v1/activities', {
        title: f.title.trim(),
        category: f.category,
        description: f.description.trim() || undefined,
        city: city.trim(),
        venueName: isMilan ? `${f.venueName.trim()} (${f.area})` : f.venueName.trim(),
        lat: geo?.[0],
        lng: geo?.[1],
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: f.capacity,
      }),
    );
    if (a) {
      AsyncStorage.removeItem(DRAFT).catch(() => {});
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
    { label: `In ${LEAD_MIN} min`, at: earliest },
    { label: 'In 30 min', at: roundUp5(now + 30 * 60e3) },
    { label: 'In 1 hour', at: roundUp5(now + 60 * 60e3) },
    { label: '7:00 PM', at: evening },
  ].filter((q) => q.at.getTime() >= earliest.getTime() && q.at.getTime() <= lastStart.getTime());

  // the big clock: tap − / + for 5 minutes, press and hold for an hour
  const earliestMin = earliest.getHours() * 60 + earliest.getMinutes();
  const curMin = hour * 60 + minute;
  const canMove = (d: number) => curMin + d >= 0 && curMin + d <= 24 * 60 - 5 && !(isEarliestDay && curMin + d < earliestMin);
  const move = (d: number) => canMove(d) && setF((p) => ({ ...p, hour: Math.floor((curMin + d) / 60), minute: (curMin + d) % 60 }));
  const endsAt = new Date(+startsAt + f.duration * 3600e3);
  const clock = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const CAT_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
    coffee: 'cafe-outline',
    drinks: 'wine-outline',
    food: 'restaurant-outline',
    sports: 'basketball-outline',
    culture: 'color-palette-outline',
  };

  return (
    <Screen tabBar header={<TabHeader />}>
      <Between>
        <View style={{ flex: 1 }}>
          <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>Create an activity</Txt>
          <Txt variant="muted">Plan something for today or tomorrow. It takes about a minute.</Txt>
        </View>
        {saved ? <Chip label="DRAFT" tone="info" /> : null}
      </Between>

      {!verified && <Banner onPress={() => go('/verify')}>You need a verified identity to publish. You can fill this in now and it is kept as a draft. Verify ›</Banner>}
      <ErrorBanner message={act.error} />

      <Section>
        <Field label="Activity name" placeholder="After-work aperitivo" value={f.title} onChangeText={(v) => set('title', v)} maxLength={80} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(CATS).map(([k, v]) => (
            <Choice key={k} tile icon={CAT_ICONS[k] ?? 'sparkles-outline'} label={v.label} spoken={`Category ${v.label}`} active={f.category === k} onPress={() => set('category', k)} />
          ))}
        </View>
      </Section>

      <Section>
        <View style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 999, padding: 3 }}>
          {days.map((d) => (
            <Pressable
              key={d.i}
              accessibilityRole="button"
              accessibilityLabel={`Day ${d.label}`}
              accessibilityState={{ selected: day.i === d.i }}
              onPress={() => set('dayIdx', d.i)}
              style={{ flex: 1, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: day.i === d.i ? c.forest : 'transparent' }}
            >
              <Txt variant="h3" color={day.i === d.i ? '#fff' : c.text} style={{ fontSize: 12, lineHeight: 16 }}>{d.label}</Txt>
            </Pressable>
          ))}
        </View>
        <Txt variant="small">HERE is for plans today or tomorrow. Planning a trip? Switch to THERE.</Txt>

        <View style={{ backgroundColor: c.sand, borderRadius: 16, padding: 10, gap: 8, alignItems: 'center' }}>
          <Row style={{ gap: 14 }}>
            <Round icon="remove" label="Earlier" disabled={!canMove(-5)} onPress={() => move(-5)} onLongPress={() => move(-60)} />
            <Text accessibilityLabel={`Starts at ${clock(startsAt)}`} style={{ fontSize: 32, lineHeight: 38, fontWeight: '800', color: c.text, minWidth: 100, textAlign: 'center' }}>
              {`${hour % 12 || 12}:${String(minute).padStart(2, '0')}`}
            </Text>
            <Round icon="add" label="Later" disabled={!canMove(5)} onPress={() => move(5)} onLongPress={() => move(60)} />
          </Row>
          <Row style={{ gap: 8 }}>
            {periods.map((p) => (
              <Choice key={p} label={p} spoken={`Start time ${p}`} active={period === p} onPress={() => pickPeriod(p)} />
            ))}
          </Row>
        </View>
        <Txt variant="small">Tap − or + for 5 minutes, press and hold for an hour. Earliest you can pick is {LEAD_MIN} minutes from now.</Txt>

        <Txt variant="label">Quick pick</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {quick.map((q) => (
            <Choice key={q.label} label={q.label} active={startsAt.getTime() === q.at.getTime()} onPress={() => setStart(q.at)} />
          ))}
        </View>

        <Between>
          <Txt variant="label">Duration</Txt>
          <Txt variant="small">Ends {clock(endsAt)}</Txt>
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
            <Txt variant="h3">Maximum people</Txt>
            <Txt variant="small">Including you</Txt>
          </View>
          <Row style={{ gap: 10 }}>
            <Round icon="remove" label="Fewer people" disabled={f.capacity <= 2} onPress={() => set('capacity', Math.max(2, f.capacity - 1))} />
            <Txt variant="h2" style={{ fontSize: 18, lineHeight: 24, minWidth: 24, textAlign: 'center' }}>{f.capacity}</Txt>
            <Round icon="add" label="More people" disabled={f.capacity >= 20} onPress={() => set('capacity', Math.min(20, f.capacity + 1))} />
          </Row>
        </Between>
        <Row style={{ gap: 5, flexWrap: 'wrap' }}>
          {Array.from({ length: f.capacity }).map((_, i) => (
            <View key={i} accessibilityElementsHidden importantForAccessibility="no" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === 0 ? c.forest : 'transparent', borderWidth: 1.5, borderColor: i === 0 ? c.forest : c.muted }} />
          ))}
          <Txt variant="small" style={{ marginLeft: 6 }}>You + {f.capacity - 1} {f.capacity - 1 === 1 ? 'spot' : 'spots'}</Txt>
        </Row>
      </Section>

      <Section>
        <Field label="City" value={city} onChangeText={setCity} />
        {isMilan ? (
          <>
            <Txt variant="label">Neighborhood</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {Object.keys(MILAN_AREAS).map((a) => (
                <Choice key={a} label={a} active={f.area === a} onPress={() => set('area', a)} />
              ))}
            </View>
          </>
        ) : (
          <Txt variant="small">Map pins are only available in Milan for now. Your activity still appears in the list.</Txt>
        )}
        <Field label="Public meeting location" icon="location-outline" placeholder="e.g. Bar Brera, Parco Sempione north gate" value={f.venueName} onChangeText={(v) => set('venueName', v)} maxLength={100} />
        <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 10 }}>
          <CheckRow checked={publicPlace} onChange={setPublicPlace}>
            <Txt>This is a public place. First meetings never happen at a private home.</Txt>
          </CheckRow>
        </View>
      </Section>

      <Section>
        <Field label="Description" placeholder="Casual drinks and conversation with new people." multiline value={f.description} onChangeText={(v) => set('description', v)} maxLength={1000} />
        <Between>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Txt variant="h3">Approve requests manually</Txt>
            <Txt variant="muted">Members join after host review. Always on for now.</Txt>
          </View>
          <Switch value disabled trackColor={{ true: '#2F7D65', false: '#ccc' }} thumbColor="#fff" accessibilityLabel="Approve requests manually, always on" />
        </Between>
      </Section>

      <Btn title="Publish activity" onPress={submit} loading={act.busy} disabled={!valid} />
      <Txt variant="small">Your activity is public in the feed. Only the venue is shown, never anyone's live location.</Txt>
    </Screen>
  );
}
