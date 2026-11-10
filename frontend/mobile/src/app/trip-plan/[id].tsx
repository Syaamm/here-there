import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ScaledText';
import { TripCalendar } from '@/components/TripCalendar';
import { TripThumb } from '@/components/Cards';
import { softShadow, WHITE } from '@/components/TripParts';
import { Avatar, Btn, Card, Chip, Empty, ErrorBanner, Field, Row, Screen, Sheet, Spinner, Txt } from '@/components/ui';
import { DayStrip, Segmented } from '@/components/DayStrip';
import { Swap } from '@/components/Pop';
import { ApiError, del, get, patch, post, type Trip } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { dateLang, dateSpan, isoDay } from '@/lib/format';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useLiveEvents } from '@/lib/live';
import { useTheme } from '@/lib/theme';
import { localeTag, t, tn, useT } from '@/lib/i18n';

type Line = { id: string; kind: 'itinerary'; title: string; note: string | null; day: string | null; time: string | null; addedBy: string; canEdit: boolean };
type Plan = {
  editable: boolean;
  itinerary: { days: { day: string; locked: boolean; items: Line[] }[]; ideas: { items: Line[]; total: number } };
};

const DAY = 24 * 3600e3;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A calendar day is kept as "YYYY-MM-DD"; it is stored as noon UTC of that date so it stays the same day in every time zone. */
const atNoon = (key: string) => new Date(`${key}T12:00:00Z`);
const fmt = (key: string, o: Intl.DateTimeFormatOptions) => atNoon(key).toLocaleDateString(dateLang(), { ...o, timeZone: 'UTC' });
const dayLabel = (key: string) => fmt(key, { weekday: 'short', day: 'numeric', month: 'short' });
const daysBetween = (a: string, b: string) => Math.round((+atNoon(b) - +atNoon(a)) / DAY);
const when = (n: number) => (n === 1 ? t('tomorrow') : n < 14 ? t('in {n} days', { n }) : n < 60 ? t('in {n} weeks', { n: Math.round(n / 7) }) : t('in {n} months', { n: Math.round(n / 30) }));
const PARTS = [['Any time', '', 'time-outline', 'no set time'], ['Morning', '09:00', 'partly-sunny-outline', '9:00'], ['Afternoon', '14:00', 'sunny-outline', '14:00'], ['Evening', '19:00', 'moon-outline', '19:00']] as const;

/**
 * The group's shared plan, laid out on the trip's own calendar: every day of the trip in order with its date, a strip of days
 * to jump between them, and stops with a time. Only people in the group can open it.
 */
export default function TripPlan() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const router = useRouter();
  // someone in the group changed the plan (or the trip's dates): it loads at once; the poll is only a rare safety net while the live connection is up
  const plan = useLoad(() => get<Plan>(`/v1/trips/${id}/plan`), [id], 30_000, 'trip:plan:v2', { live: true });
  const trip = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip:plan:trip');
  useLiveEvents((e) => {
    if (e.type === 'ready' || (e.type === 'group-changed' && e.kind === 'trip' && e.id === id)) {
      void plan.reload();
      if (e.type === 'group-changed') void trip.reload();
    }
  });
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([plan.reload(), trip.reload()]));

  // the day chosen on the calendar (until one is chosen, the day that makes most sense: see `active` below)
  const [sel, setSel] = useState<string | null>(null);
  // the form: a new line, or an existing one being changed
  const [form, setForm] = useState<null | { kind: 'itinerary'; edit?: Line }>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState('');
  // "See all": the ideas in full, a page at a time (the plan itself carries only the first few)
  const [all, setAll] = useState<null | 'ideas'>(null);
  const [allRows, setAllRows] = useState<Line[]>([]);
  const [allNext, setAllNext] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const loadAll = async (kind: 'ideas', cursor?: string | null) => {
    setAllBusy(true);
    setAllError(null);
    try {
      const r = await get<{ items: Line[]; nextCursor: string | null }>(`/v1/trips/${id}/plan/items?kind=${kind}&limit=20${cursor ? `&cursor=${cursor}` : ''}`);
      setAllRows((rows) => (cursor ? [...rows, ...r.items] : r.items));
      setAllNext(r.nextCursor);
    } catch (e) {
      setAllError(e instanceof Error ? e.message : t('Could not load the list'));
    } finally {
      setAllBusy(false);
    }
  };
  const showAll = (kind: 'ideas') => {
    setAll(kind);
    setAllRows([]);
    setAllNext(null);
    void loadAll(kind);
  };
  const act = useAction(() => {
    setForm(null);
    void plan.reload();
  });

  const open = (kind: 'itinerary', edit?: Line, presetDay?: string | null, presetTitle?: string) => {
    setAll(null);
    setForm({ kind, edit });
    setTitle(edit?.title ?? presetTitle ?? '');
    setNote(edit?.note ?? '');
    // a new line goes on the day on show, unless a day (or "no day", for an idea) was asked for
    const wanted = edit ? (edit.day ? edit.day.slice(0, 10) : null) : presetDay === undefined ? active : presetDay;
    setDay(wanted && isPast(wanted) ? (tripDays.includes(today) ? today : null) : wanted);
    setTime(edit?.time ?? '');
    act.setError(null);
  };
  const timeOk = time === '' || TIME.test(time);
  const save = () =>
    void act.run(() => {
      const dayIso = day ? `${day}T12:00:00.000Z` : undefined;
      const body = { title: title.trim(), note: note.trim() || undefined, day: dayIso, time: time || undefined };
      return form!.edit ? patch(`/v1/trips/${id}/plan/items/${form!.edit.id}`, { ...body, note: note.trim() || null, day: dayIso ?? null, time: time || null }) : post(`/v1/trips/${id}/plan/items`, { kind: 'itinerary', ...body });
    });
  const remove = async (l: Line) => {
    setAll(null);
    if (await confirmAsync(t('Remove this line?'), undefined, t('Remove'), true)) void act.run(() => del(`/v1/trips/${id}/plan/items/${l.id}`));
  };

  const p = plan.data;
  const tr = trip.data;
  const forbidden = plan.error instanceof ApiError && plan.error.status === 403;

  // the calendar days of the trip, in the person's own calendar (the same days the trip shows everywhere else)
  const tripDays: string[] = [];
  if (tr) {
    const a = new Date(tr.dateStart);
    const b = new Date(tr.dateEnd);
    const last = isoDay(b);
    for (let i = 0; i < 100; i++) {
      const k = isoDay(new Date(a.getFullYear(), a.getMonth(), a.getDate() + i));
      tripDays.push(k);
      if (k >= last) break;
    }
  }
  const planned = new Map<string, Line[]>((p?.itinerary.days ?? []).filter((d) => d.day).map((d) => [d.day as string, d.items]));
  const ideas = p?.itinerary.ideas?.items ?? [];
  const ideasTotal = p?.itinerary.ideas?.total ?? 0;
  // days outside the trip dates (allowed up to a week either side) still show, in their place
  const allDays = [...new Set([...tripDays, ...planned.keys()])].sort();
  const today = isoDay(new Date());
  const nights = tripDays.length > 0 ? tripDays.length - 1 : 0;
  // the design's white cards on the ivory page
  const white = { backgroundColor: WHITE, borderWidth: 0, ...softShadow } as const;
  // once the trip has started, a day before today is a record of what happened: its plan can no longer be changed
  const started = tripDays.length > 0 && today >= tripDays[0];
  const isPast = (k: string) => started && k < today;
  const finished = tripDays.length > 0 && today > tripDays[tripDays.length - 1];
  const status = !tripDays.length ? '' : today < tripDays[0] ? t('Leaves {when}', { when: when(daysBetween(today, tripDays[0])) }) : finished ? t('Trip finished') : t('Day {n} of {total}', { n: tripDays.indexOf(today) + 1, total: tripDays.length });
  // the day on show: the one chosen; else today if it is a day of the trip; else the first day with plans; else the first day
  const active = sel && allDays.includes(sel) ? sel : tripDays.includes(today) ? today : (allDays.find((k) => planned.has(k)) ?? tripDays[0] ?? null);
  const counts = new Map([...planned].map(([k, v]) => [k, v.length] as const));

  const dayNumber = (k: string) => (tripDays.includes(k) ? t('Day {n}', { n: tripDays.indexOf(k) + 1 }) : tripDays.length && k < tripDays[0] ? t('Before the trip') : t('After the trip'));

  const actions = (l: Line) =>
    l.canEdit ? (
      <>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Edit {title}', { title: l.title })} onPress={() => open(l.kind, l)} hitSlop={8}><Txt variant="small" style={{ color: c.green, fontWeight: '800' }}>{t('Edit')}</Txt></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Remove {title}', { title: l.title })} onPress={() => void remove(l)} hitSlop={8}><Txt variant="small" style={{ color: c.danger, fontWeight: '800' }}>{t('Remove')}</Txt></Pressable>
      </>
    ) : null;

  /** One stop: its time on the left, then the stop on a line that runs down the day. */
  const stop = (l: Line) => (
    <View key={l.id} style={{ flexDirection: 'row', gap: 10 }}>
      <Text style={{ width: 56, color: l.time ? c.text : c.muted, fontSize: l.time ? 15 : 12, fontWeight: '500', paddingTop: l.time ? 0 : 3 }}>{l.time ?? t('Any time')}</Text>
      <View style={{ flex: 1, borderLeftWidth: 2, borderColor: c.line, paddingLeft: 12, paddingBottom: 14, gap: 2 }}>
        <View style={{ position: 'absolute', left: -6, top: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: l.time ? c.forest : WHITE, borderWidth: 2, borderColor: c.forest }} />
        <Text style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>{l.title}</Text>
        {l.note ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 19 }}>{l.note}</Text> : null}
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <Txt variant="small" style={{ flex: 1 }}>{t('Added by {name}', { name: l.addedBy })}</Txt>
          {actions(l)}
        </Row>
      </View>
    </View>
  );

  /** The chosen day in full: what it is, a few facts about its plan, and the stops. */
  const dayPanel = (k: string) => {
    const items = planned.get(k) ?? [];
    const isToday = k === today;
    const times = items.flatMap((l) => (l.time ? [l.time] : [])).sort();
    const untimed = items.length - times.length;
    const people = [...new Set(items.map((l) => l.addedBy))];
    const facts = [
      items.length ? tn(items.length, '{n} stop', '{n} stops') : null,
      times.length > 1 ? t('from {from} to {to}', { from: times[0], to: times[times.length - 1] }) : times.length === 1 ? t('at {time}', { time: times[0] }) : null,
      untimed > 0 && times.length > 0 ? t('{n} with no time yet', { n: untimed }) : untimed > 0 ? t('no times yet') : null,
      people.length ? t('by {names}', { names: people.join(', ') }) : null,
    ].filter(Boolean) as string[];
    return (
      <Card key={k} style={{ ...white, padding: 16, borderRadius: 28, gap: 12 }}>
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <View style={{ flex: 1, alignItems: 'center', gap: 2, paddingLeft: p?.editable && !isPast(k) ? 64 : 0 }}>
            <Text style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '600', textAlign: 'center' }}>{dayNumber(k)} · {fmt(k, { weekday: 'long' })}</Text>
            <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>{isToday ? t('Today') : fmt(k, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
          </View>
          {p?.editable && !isPast(k) ? <Btn title={t('Add')} small variant="secondary" onPress={() => open('itinerary', undefined, k)} /> : null}
        </Row>
        {facts.length ? (
          <Row style={{ flexWrap: 'wrap', gap: 6 }}>
            {facts.map((f) => <Chip key={f} label={f} tone="neutral" />)}
          </Row>
        ) : null}
        {items.length ? <View>{items.map(stop)}</View> : <Txt variant="muted">{isPast(k) ? t('Nothing was planned for this day.') : t('Nothing planned yet.')}</Txt>}
      </Card>
    );
  };

  const seeAll = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}>
      <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{label}</Txt>
      <Ionicons name="chevron-forward" size={13} color={c.forest} />
    </Pressable>
  );
  // the design's round white fields in the add form
  const pill = { borderRadius: 999, paddingHorizontal: 20, minHeight: 50 } as const;
  const parts = PARTS.map(([l, v, i, h]) => [t(l), v, i, t(h)] as const);

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      {plan.loading && !p && <Spinner />}
      {forbidden ? <Empty title={t('The plan is for the group')} /> : <ErrorBanner message={plan.error?.message} />}
      {p ? (
        <>
          {/* the trip this plan belongs to */}
          {tr ? (
            <Card style={{ ...white, padding: 16, borderRadius: 28, gap: 12 }}>
              <Row style={{ gap: 16, alignItems: 'center' }}>
                <TripThumb t={tr} size={30} style={{ width: 86, height: 86, borderRadius: 20 }} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text numberOfLines={2} style={{ color: c.text, fontSize: 16, lineHeight: 21, fontWeight: '600' }}>{tr.title}</Text>
                  <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{dateSpan(tr.dateStart, tr.dateEnd)}</Text>
                  <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{t('{d} days / {n} nights', { d: tripDays.length, n: nights })}</Text>
                </View>
              </Row>
              <Row style={{ gap: 10, alignItems: 'center' }}>
                <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row' }}>
                  {(tr.participants ?? []).slice(0, 4).map((x, i) => (
                    <View key={x.id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 999, borderWidth: 2, borderColor: WHITE }}>
                      <Avatar name={x.displayName} uri={x.photoUrl} size={28} />
                    </View>
                  ))}
                </View>
                <Text style={{ flex: 1, minWidth: 0, color: c.text, fontSize: 12 }}>{t('{going} of {capacity} going', { going: tr.members, capacity: tr.maxCapacity })}</Text>
                <Text style={{ flexShrink: 0, color: tr.spotsLeft === 0 ? c.danger : c.green, fontSize: 12, fontWeight: '500' }}>{tr.spotsLeft === 0 ? t('Full') : tn(tr.spotsLeft, '{n} spot left', '{n} spots left')}</Text>
              </Row>
              {/* the status gets its own line: beside the other three it squeezed "3 of 6 going" into a column of single letters */}
              {status ? <View style={{ alignSelf: 'flex-start' }}><Chip label={status} tone={finished ? 'neutral' : 'ok'} /></View> : null}
            </Card>
          ) : null}

          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, lineHeight: 20, fontWeight: '600', paddingLeft: 6 }}>{t('Itinerary')}</Text>

          {/* the trip as a calendar: days with something planned are marked; tap a day to see its plan below */}
          {active ? (
            <Card style={{ ...white, padding: 16, borderRadius: 32 }}>
              <TripCalendar tripDays={tripDays} planned={counts} selected={active} today={today} onSelect={setSel} dayNumber={dayNumber} />
            </Card>
          ) : null}
          {active ? <Swap key={active}>{dayPanel(active)}</Swap> : <Empty title={t('Nothing planned yet')} />}

          {/* ideas have no day, so they sit outside the calendar */}
          {ideas.length ? (
            <Card style={{ ...white, padding: 16, borderRadius: 28, gap: 10 }}>
              <Row style={{ gap: 12, alignItems: 'center' }}>
                <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 44, height: 48, borderRadius: 12, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="bulb-outline" size={22} color={c.forest} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{t('Ideas, no day yet')}</Txt>
                </View>
                {p.editable ? <Btn title={t('Add')} small variant="secondary" onPress={() => open('itinerary', undefined, null)} /> : null}
              </Row>
              <View>{ideas.map(stop)}</View>
              {ideasTotal > ideas.length ? seeAll(t('See all ideas'), () => showAll('ideas')) : null}
            </Card>
          ) : null}

        </>
      ) : null}

      <Sheet visible={all !== null} title={t('All ideas, no day yet')} onClose={() => setAll(null)}>
        <ErrorBanner message={allError} />
        <View>{allRows.map(stop)}</View>
        {allBusy && allRows.length === 0 ? <Spinner /> : null}
        {allNext ? <Btn title={t('Show more')} variant="secondary" loading={allBusy} onPress={() => void loadAll(all!, allNext)} /> : null}
      </Sheet>

      <Sheet bg={c.bg} visible={!!form} title={form?.edit ? t('Change a stop or idea') : t('Add a stop or idea')} onClose={() => setForm(null)}>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>{t('Add something your group might want to do during the trip.')}</Text>
        <ErrorBanner message={act.error} />
        <Field label={t('What is the plan?')} value={title} onChangeText={setTitle} maxLength={100} style={pill} />
        <View style={{ gap: 6 }}>
          <Txt variant="label">{t('Which day?')}</Txt>
          <DayStrip days={tripDays.filter((d) => !isPast(d))} value={day} onChange={setDay} dayNumber={dayNumber} />
          <Txt variant="small">{day ? `${dayNumber(day)} · ${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}` : t('No day yet: goes on the ideas list')}</Txt>
        </View>
        <View style={{ gap: 6 }}>
          <Txt variant="label">{t('What time of day?')}</Txt>
          <Segmented options={parts} value={time} onChange={setTime} />
        </View>
        <Field label={t('Exact time (optional)')} value={time} onChangeText={(v) => setTime(v.replace(/[^0-9:]/g, '').slice(0, 5))} keyboardType="numbers-and-punctuation" maxLength={5} placeholder={t('Like 14:30')} style={pill} error={timeOk ? null : t('Use 24-hour time like 09:30')} />
        <Field label={t('Note (optional)')} value={note} onChangeText={setNote} multiline maxLength={500} style={{ borderRadius: 24, paddingHorizontal: 20 }} />
        <Btn title={t('Save')} loading={act.busy} disabled={title.trim().length < 2 || !timeOk} onPress={save} />
      </Sheet>
    </Screen>
  );
}
