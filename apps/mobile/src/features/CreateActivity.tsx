import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { TabHeader } from '@/components/TabHeader';
import { Banner, Between, Btn, CheckRow, Chip, ErrorBanner, Field, Pill, PillRow, Screen, Stepper, Txt, useGo } from '@/components/ui';
import { post, type Activity } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useCity } from '@/lib/city';
import { catColor, CATS, MILAN_AREAS } from '@/lib/constants';
import { useAction } from '@/lib/hooks';

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

type Draft = { title: string; category: string; dayIdx: number; hour: number; minute: number; duration: number; capacity: number; area: string; venueName: string; description: string };

/** HERE · Create: friction-light, but public-place-only and verified-host-only. Drafts stay on this device. */
export function CreateActivity() {
  const { me } = useMe();
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

  return (
    <Screen tabBar>
      <TabHeader />
      <Between>
        <Txt variant="h1">Create an activity</Txt>
        {saved ? <Chip label="DRAFT" tone="info" /> : null}
      </Between>

      {/* cover: a stand-in for the activity photo, tinted by the chosen category */}
      <View style={{ height: 170, borderRadius: 24, backgroundColor: catColor(f.category), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 60, opacity: 0.45 }} accessibilityElementsHidden>{CATS[f.category]?.emoji}</Text>
      </View>

      {!verified && <Banner onPress={() => go('/verify')}>You need a verified identity to publish. You can fill this in now and it is kept as a draft. Verify ›</Banner>}
      <ErrorBanner message={act.error} />

      <Field label="Activity name *" placeholder="After-work aperitivo" value={f.title} onChangeText={(v) => set('title', v)} maxLength={80} />

      <Txt variant="label">Category *</Txt>
      <PillRow>
        {Object.entries(CATS).map(([k, v]) => (
          <Pill key={k} label={`${v.emoji} ${v.label}`} active={f.category === k} onPress={() => set('category', k)} />
        ))}
      </PillRow>

      <Txt variant="label">Day *</Txt>
      <PillRow>
        {days.map((d) => (
          <Pill key={d.i} label={d.label} active={day.i === d.i} onPress={() => set('dayIdx', d.i)} />
        ))}
      </PillRow>
      <Txt variant="small">HERE is for plans today or tomorrow. Planning a trip? Switch to THERE.</Txt>
      <Txt variant="label">Starts at *</Txt>
      <PillRow>
        {periods.map((p) => (
          <Pill key={p} label={p} active={period === p} onPress={() => pickPeriod(p)} />
        ))}
      </PillRow>
      <PillRow>
        {hoursInPeriod.map((h) => (
          <Pill key={h} label={String(h % 12 || 12)} active={hour === h} onPress={() => set('hour', h)} />
        ))}
      </PillRow>
      <Txt variant="label">Minutes</Txt>
      <PillRow>
        {minutes.map((m) => (
          <Pill key={m} label={`:${String(m).padStart(2, '0')}`} active={minute === m} onPress={() => set('minute', m)} />
        ))}
      </PillRow>
      <Txt variant="muted">
        {`Starts ${day.label.toLowerCase()} at ${startsAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. The earliest you can pick is 10 minutes from now.`}
      </Txt>
      <Txt variant="label">Duration</Txt>
      <PillRow>
        {DURATIONS.map((h) => (
          <Pill key={h} label={`${h} h`} active={f.duration === h} onPress={() => set('duration', h)} />
        ))}
      </PillRow>

      <Stepper label="Maximum people (including you) *" value={f.capacity} min={2} max={20} onChange={(n) => set('capacity', n)} />

      <Field label="City *" value={city} onChangeText={setCity} />
      {isMilan ? (
        <>
          <Txt variant="label">Neighborhood *</Txt>
          <PillRow>
            {Object.keys(MILAN_AREAS).map((a) => (
              <Pill key={a} label={a} active={f.area === a} onPress={() => set('area', a)} />
            ))}
          </PillRow>
        </>
      ) : (
        <Txt variant="small">Map pins are only available in Milan for now. Your activity still appears in the list.</Txt>
      )}
      <Field label="Public meeting location *" icon="location-outline" placeholder="e.g. Bar Brera, Parco Sempione north gate" value={f.venueName} onChangeText={(v) => set('venueName', v)} maxLength={100} />
      <CheckRow checked={publicPlace} onChange={setPublicPlace}>
        <Txt>This is a public place. First meetings never happen at a private home.</Txt>
      </CheckRow>

      <Field label="Description" placeholder="Casual drinks and conversation with new people." multiline value={f.description} onChangeText={(v) => set('description', v)} maxLength={1000} />
      <Between>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Txt variant="h3">Approve requests manually</Txt>
          <Txt variant="muted">Members join after host review. Always on for now.</Txt>
        </View>
        <Switch value disabled trackColor={{ true: '#2F7D65', false: '#ccc' }} thumbColor="#fff" accessibilityLabel="Approve requests manually, always on" />
      </Between>

      <Btn title="Publish activity" onPress={submit} loading={act.busy} disabled={!valid} />
      <Txt variant="small">Your activity is public in the feed. Only the venue is shown, never anyone's live location.</Txt>
    </Screen>
  );
}
