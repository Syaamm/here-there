import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text, TextInput } from '@/components/ScaledText';
import { TripCalendar } from '@/components/TripCalendar';
import { Banner, Btn, Card, Chip, Empty, ErrorBanner, Field, Row, Screen, Sheet, Spinner, Txt } from '@/components/ui';
import { DayStrip, Segmented } from '@/components/DayStrip';
import { Swap } from '@/components/Pop';
import { ApiError, del, get, patch, post, type Trip } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { dateSpan, isoDay, money } from '@/lib/format';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { localeTag, t, tn, useT } from '@/lib/i18n';

type Line = { id: string; kind: 'itinerary' | 'budget'; title: string; note: string | null; day: string | null; time: string | null; amount: number | null; addedBy: string; canEdit: boolean };
type Plan = {
  editable: boolean;
  itinerary: { days: { day: string; locked: boolean; items: Line[] }[]; ideas: { items: Line[]; total: number } };
  budget: { label: string; currency: string; includesTransport: boolean; items: Line[]; total: number; perPersonTotal: number; statedMin: number; statedMax: number; comparison: 'under' | 'within' | 'over' | null; note: string };
};

const DAY = 24 * 3600e3;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A calendar day is kept as "YYYY-MM-DD"; it is stored as noon UTC of that date so it stays the same day in every time zone. */
const atNoon = (key: string) => new Date(`${key}T12:00:00Z`);
const fmt = (key: string, o: Intl.DateTimeFormatOptions) => atNoon(key).toLocaleDateString(localeTag(), { ...o, timeZone: 'UTC' });
const dayLabel = (key: string) => fmt(key, { weekday: 'short', day: 'numeric', month: 'short' });
const daysBetween = (a: string, b: string) => Math.round((+atNoon(b) - +atNoon(a)) / DAY);
const when = (n: number) => (n === 1 ? t('tomorrow') : n < 14 ? t('in {n} days', { n }) : n < 60 ? t('in {n} weeks', { n: Math.round(n / 7) }) : t('in {n} months', { n: Math.round(n / 30) }));
const PARTS = [['Any time', '', 'time-outline', 'no set time'], ['Morning', '09:00', 'partly-sunny-outline', '9:00'], ['Afternoon', '14:00', 'sunny-outline', '14:00'], ['Evening', '19:00', 'moon-outline', '19:00']] as const;

/**
 * The group's shared plan, laid out on the trip's own calendar: every day of the trip in order with its date, a strip of days
 * to jump between them, stops with a time, and budget notes read against the range the trip itself gave. Only people in the
 * group can open it.
 */
export default function TripPlan() {
  const { t, tn } = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const plan = useLoad(() => get<Plan>(`/v1/trips/${id}/plan`), [id], 30_000, 'trip:plan:v2');
  const trip = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip:plan:trip');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([plan.reload(), trip.reload()]));

  // the day chosen on the calendar (until one is chosen, the day that makes most sense: see `active` below)
  const [sel, setSel] = useState<string | null>(null);
  // the form: a new line, or an existing one being changed
  const [form, setForm] = useState<null | { kind: 'itinerary' | 'budget'; edit?: Line }>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  // how the price entered is meant: a total, or per night / per day of the trip (it is multiplied out before it is saved)
  const [unit, setUnit] = useState<'total' | 'night' | 'day'>('total');
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState('');
  // "See all": the ideas or the budget notes in full, a page at a time (the plan itself carries only the first few)
  const [all, setAll] = useState<null | 'ideas' | 'budget'>(null);
  const [allRows, setAllRows] = useState<Line[]>([]);
  const [allNext, setAllNext] = useState<string | null>(null);
  const [allBusy, setAllBusy] = useState(false);
  const [allError, setAllError] = useState<string | null>(null);
  const loadAll = async (kind: 'ideas' | 'budget', cursor?: string | null) => {
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
  const showAll = (kind: 'ideas' | 'budget') => {
    setAll(kind);
    setAllRows([]);
    setAllNext(null);
    void loadAll(kind);
  };
  const act = useAction(() => {
    setForm(null);
    void plan.reload();
  });

  const open = (kind: 'itinerary' | 'budget', edit?: Line, presetDay?: string | null, presetTitle?: string) => {
    setAll(null);
    setForm({ kind, edit });
    setTitle(edit?.title ?? presetTitle ?? '');
    setNote(edit?.note ?? '');
    setAmount(edit?.amount != null ? String(edit.amount) : '');
    setUnit('total');
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
      if (form!.kind === 'budget') {
        // a cost can be noted without a price ("price to be decided"); when there is one, it is the total per person
        const body = { title: title.trim(), note: note.trim() || undefined, amount: price == null ? undefined : price };
        return form!.edit ? patch(`/v1/trips/${id}/plan/items/${form!.edit.id}`, { ...body, note: note.trim() || null, amount: price ?? null }) : post(`/v1/trips/${id}/plan/items`, { kind: 'budget', ...body });
      }
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
      <Text style={{ width: 52, color: l.time ? c.text : c.muted, fontSize: 12, fontWeight: '800', paddingTop: 1 }}>{l.time ?? t('Any time')}</Text>
      <View style={{ flex: 1, borderLeftWidth: 2, borderColor: c.line, paddingLeft: 12, paddingBottom: 12, gap: 2 }}>
        <View style={{ position: 'absolute', left: -6, top: 4, width: 10, height: 10, borderRadius: 5, backgroundColor: l.time ? c.forest : c.surface, borderWidth: 2, borderColor: c.forest }} />
        <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{l.title}</Txt>
        {l.note ? <Txt>{l.note}</Txt> : null}
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
      <Card key={k} style={{ padding: 12, borderRadius: 18, gap: 10, borderColor: isToday ? c.forest : c.line }}>
        <Row style={{ gap: 12, alignItems: 'center' }}>
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 44, height: 48, borderRadius: 12, backgroundColor: isToday ? c.forest : c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: isToday ? '#fff' : c.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }}>{fmt(k, { month: 'short' }).toUpperCase()}</Text>
            <Text style={{ color: isToday ? '#fff' : c.text, fontSize: 18, fontWeight: '800', lineHeight: 22 }}>{Number(k.slice(8))}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20 }}>{dayNumber(k)} · {fmt(k, { weekday: 'long' })}</Txt>
            <Txt variant="small">{isToday ? t('Today') : fmt(k, { day: 'numeric', month: 'long', year: 'numeric' })}</Txt>
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

  // ---- the budget, read against the range the trip gave
  const B = p?.budget;
  const total = B?.perPersonTotal ?? 0;
  const top = B?.statedMax ?? 0;
  const scale = Math.max(top * 1.15, total * 1.05, 1);
  const at = (n: number) => `${Math.max(0, Math.min(100, (n / scale) * 100))}%` as const;
  const cur = B?.currency ?? 'EUR';
  const fill = B?.comparison === 'over' ? c.warnFg : B?.comparison === 'within' ? c.green : c.muted;
  const verdict = !B || !B.comparison ? t('Nothing noted yet.') : B.comparison === 'over' ? t('{amount} above the top of the range', { amount: money(total - B.statedMax, cur) }) : B.comparison === 'under' ? t('{amount} below the low end of the range', { amount: money(B.statedMin - total, cur) }) : total === B.statedMax ? t('Right at the top of the range') : t('{amount} left before the top of the range', { amount: money(B.statedMax - total, cur) });
  // the price being typed: multiplied out when it is per night or per day, and what it does to the total
  const mult = unit === 'night' ? Math.max(nights, 1) : unit === 'day' ? Math.max(tripDays.length, 1) : 1;
  const price = amount === '' ? null : Number(amount) * mult;
  const priceTooBig = price != null && price > 100000;
  const after = total - (form?.edit?.amount ?? 0) + (price ?? 0);
  const impact = !B || !price ? null : after > B.statedMax ? { tone: 'over', text: t('Total would be {total}: {amount} above the top of the range', { total: money(after, cur), amount: money(after - B.statedMax, cur) }) } : after >= B.statedMin ? { tone: 'within', text: t('Total would be {total}: {amount} left before the top of the range', { total: money(after, cur), amount: money(B.statedMax - after, cur) }) } : { tone: 'under', text: t('Total would be {total}: still {amount} below the low end of the range', { total: money(after, cur), amount: money(B.statedMin - after, cur) }) };
  const symbol = money(0, cur).replace(/0/g, '').trim();
  const share = (l: Line) => (top > 0 && l.amount != null ? Math.round((l.amount / top) * 100) : 0);
  /** One budget note: what it is for, its price, and who added it. */
  const seeAll = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [{ alignSelf: 'flex-start', minHeight: 34, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 4 }, pressed && { opacity: 0.8 }]}>
      <Txt variant="label" color={c.forest} style={{ fontSize: 12, lineHeight: 16 }}>{label}</Txt>
      <Ionicons name="chevron-forward" size={13} color={c.forest} />
    </Pressable>
  );
  const budgetRow = (l: Line) => (
        <View key={l.id} style={{ paddingVertical: 8, gap: 2, borderBottomWidth: 1, borderColor: c.line }}>
          <Row style={{ gap: 8, alignItems: 'center' }}>
            <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20, flex: 1 }}>{l.title}</Txt>
            {l.amount != null ? (
              <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Txt variant="h3" style={{ fontSize: 15 }}>{money(l.amount, cur)}</Txt>
              </View>
            ) : (
              <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Txt variant="small">{t('No price yet')}</Txt>
              </View>
            )}
          </Row>
          {l.note ? <Txt>{l.note}</Txt> : null}
          <Row style={{ gap: 12, alignItems: 'center' }}>
            <Txt variant="small" style={{ flex: 1 }}>{l.amount != null ? t('{pct}% of the top of the range · added by {name}', { pct: share(l), name: l.addedBy }) : t('added by {name}', { name: l.addedBy })}</Txt>
            {actions(l)}
          </Row>
        </View>
  );
  const cats = [t('Stay'), t('Food'), t('Local transport'), t('Activities'), ...(B?.includesTransport ? [t('Flights and travel')] : [])];
  const parts = PARTS.map(([l, v, i, h]) => [t(l), v, i, t(h)] as const);

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      {plan.loading && !p && <Spinner />}
      {forbidden ? <Empty title={t('The plan is for the group')} /> : <ErrorBanner message={plan.error?.message} />}
      {p ? (
        <>
          {/* the trip this plan belongs to */}
          {tr ? (
            <Card style={{ padding: 14, borderRadius: 18, gap: 4 }}>
              <Row style={{ gap: 8, alignItems: 'center' }}>
                <Ionicons name="airplane-outline" size={18} color={c.forest} />
                <Txt variant="h2" style={{ fontSize: 18, lineHeight: 24, flex: 1 }} numberOfLines={1}>{tr.destination}</Txt>
                {status ? <Chip label={status} tone={finished ? 'neutral' : 'ok'} /> : null}
              </Row>
              <Txt>{dateSpan(tr.dateStart, tr.dateEnd)} · {tn(nights, '{n} night', '{n} nights')}</Txt>
              <Txt variant="small">{t('{going} of {capacity} going', { going: tr.members, capacity: tr.maxCapacity })}</Txt>
            </Card>
          ) : null}

          <Txt variant="h2" style={{ fontSize: 20 }}>{t('Itinerary')}</Txt>

          {/* the trip as a calendar: days with something planned are marked; tap a day to see its plan below */}
          {active ? (
            <Card style={{ padding: 12, borderRadius: 18 }}>
              <TripCalendar tripDays={tripDays} planned={counts} selected={active} today={today} onSelect={setSel} dayNumber={dayNumber} />
            </Card>
          ) : null}
          {active ? <Swap key={active}>{dayPanel(active)}</Swap> : <Empty title={t('Nothing planned yet')} />}

          {/* ideas have no day, so they sit outside the calendar */}
          {ideas.length ? (
            <Card style={{ padding: 12, borderRadius: 18, gap: 10 }}>
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
              {ideasTotal > ideas.length ? seeAll(t('See all {n} ideas', { n: ideasTotal }), () => showAll('ideas')) : null}
            </Card>
          ) : null}

          {/* budget notes */}
          <Row style={{ alignItems: 'center', marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Txt variant="h2" style={{ fontSize: 20 }}>{t('Budget notes')}</Txt>
            </View>
            {p.editable ? <Btn title={t('Add')} small onPress={() => open('budget')} /> : null}
          </Row>
          <Card style={{ padding: 14, borderRadius: 18, gap: 10 }}>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Txt variant="small">{t('Trip budget, per person')}</Txt>
                <Txt variant="h3" style={{ fontSize: 17, lineHeight: 22 }}>{money(B!.statedMin, cur)} – {money(B!.statedMax, cur)}</Txt>
              </View>
              <Chip label={B!.includesTransport ? t('Travel included') : t('Travel not included')} tone="neutral" />
            </Row>

            {/* how much is noted so far, against that range (the two marks are the ends of the range) */}
            <View accessible accessibilityLabel={`${t('Noted so far {total} per person, against a trip budget of {min} to {max}.', { total: money(total, cur), min: money(B!.statedMin, cur), max: money(B!.statedMax, cur) })} ${verdict}`} style={{ gap: 6 }}>
              <Row style={{ alignItems: 'flex-end' }}>
                <Txt variant="h2" style={{ fontSize: 22, lineHeight: 28, flex: 1 }}>{money(total, cur)} <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600' }}>{t('noted per person')}</Text></Txt>
              </Row>
              <View style={{ height: 22, justifyContent: 'center' }}>
                <View style={{ height: 10, borderRadius: 5, backgroundColor: c.line, overflow: 'hidden' }}>
                  <View style={{ width: at(total), height: 10, backgroundColor: fill }} />
                </View>
                {[B!.statedMin, B!.statedMax].map((n) => (
                  <View key={n} style={{ position: 'absolute', left: at(n), top: 2, width: 2, height: 18, marginLeft: -1, borderRadius: 1, backgroundColor: c.forest }} />
                ))}
              </View>
              <Txt variant="small" bold color={B!.comparison === 'over' ? c.warnFg : B!.comparison === 'within' ? c.green : c.muted}>{verdict}</Txt>
            </View>

            {B!.items.length ? (
              <View style={{ borderTopWidth: 1, borderColor: c.line }}>
                {B!.items.map(budgetRow)}
              </View>
            ) : null}
            {(B!.total ?? 0) > B!.items.length ? seeAll(t('See all {n} notes', { n: B!.total }), () => showAll('budget')) : null}
          </Card>
          <Banner>{B!.note}</Banner>
        </>
      ) : null}

      <Sheet visible={all !== null} title={all === 'budget' ? t('All budget notes') : t('All ideas, no day yet')} onClose={() => setAll(null)}>
        <ErrorBanner message={allError} />
        {all === 'budget' ? <View>{allRows.map(budgetRow)}</View> : <View>{allRows.map(stop)}</View>}
        {allBusy && allRows.length === 0 ? <Spinner /> : null}
        {allNext ? <Btn title={t('Show more')} variant="secondary" loading={allBusy} onPress={() => void loadAll(all!, allNext)} /> : null}
      </Sheet>

      <Sheet visible={!!form} title={form?.kind === 'budget' ? (form?.edit ? t('Change a cost') : t('Add a cost')) : form?.edit ? t('Change a stop or idea') : t('Add a stop or idea')} onClose={() => setForm(null)}>
        <ErrorBanner message={act.error} />
        <Field label={form?.kind === 'budget' ? t('What is it for? (hostel, food, local transport)') : t('What is the plan?')} value={title} onChangeText={setTitle} maxLength={100} />
        {form?.kind === 'budget' ? (
          <>
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              {cats.map((x) => (
                <Pressable key={x} accessibilityRole="button" accessibilityLabel={t('Use {name}', { name: x })} onPress={() => setTitle(x)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: title === x ? c.forest : c.line, backgroundColor: title === x ? c.forest : c.surface, justifyContent: 'center' }}>
                  <Txt variant="small" style={{ color: title === x ? '#fff' : c.text, fontWeight: '800' }}>{x}</Txt>
                </Pressable>
              ))}
            </Row>
            <View style={{ gap: 4 }}>
              <Txt variant="label">{t('Price per person (optional)')}</Txt>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: priceTooBig ? c.danger : c.line, borderRadius: 14, backgroundColor: c.surface, paddingHorizontal: 14, minHeight: 60 }}>
                <Text style={{ color: c.muted, fontSize: 26, fontWeight: '800' }}>{symbol}</Text>
                <TextInput
                  accessibilityLabel={unit === 'night' ? t('Price per person in {cur}, per night', { cur }) : unit === 'day' ? t('Price per person in {cur}, per day', { cur }) : t('Price per person in {cur}', { cur })}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={c.placeholder}
                  value={amount ? Number(amount).toLocaleString(localeTag()) : ''}
                  onChangeText={(v) => setAmount(v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 6))}
                  style={{ flex: 1, marginLeft: 8, color: c.text, fontSize: 30, fontWeight: '800', paddingVertical: 8, minWidth: 0 }}
                />
                <Text style={{ color: c.muted, fontSize: 12, fontWeight: '700' }}>{unit === 'night' ? t('each night') : unit === 'day' ? t('each day') : t('per person')}</Text>
              </View>
            </View>
            {/* quick amounts, and a price that is per night or per day of the trip */}
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              {[10, 50, 100].map((n) => (
                <Pressable key={n} accessibilityRole="button" accessibilityLabel={t('Add {n}', { n })} onPress={() => setAmount(String(Math.min(100000, Number(amount || 0) + n)))} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.surface, justifyContent: 'center' }}>
                  <Txt variant="small" style={{ fontWeight: '800' }}>+{n}</Txt>
                </Pressable>
              ))}
              {amount ? (
                <Pressable accessibilityRole="button" accessibilityLabel={t('Clear the price')} onPress={() => setAmount('')} style={{ paddingHorizontal: 12, height: 32, justifyContent: 'center' }}>
                  <Txt variant="small" style={{ color: c.muted, fontWeight: '800' }}>{t('Clear')}</Txt>
                </Pressable>
              ) : null}
            </Row>
            {!form?.edit && nights > 0 ? (
              <View style={{ gap: 6 }}>
                <Txt variant="label">{t('Is this price for the whole trip, or each night or day?')}</Txt>
                <Row style={{ flexWrap: 'wrap', gap: 6 }}>
                  {([['total', t('The whole trip')], ['night', t('Each night')], ['day', t('Each day')]] as const).map(([v, l]) => (
                    <Pressable key={v} accessibilityRole="button" accessibilityLabel={v === 'total' ? t('This price is for the whole trip') : v === 'night' ? t('This price is for each night, {n} nights', { n: nights }) : t('This price is for each day, {n} days', { n: tripDays.length })} accessibilityState={{ selected: unit === v }} onPress={() => setUnit(v)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: unit === v ? c.forest : c.line, backgroundColor: unit === v ? c.forest : c.surface, justifyContent: 'center' }}>
                      <Txt variant="small" style={{ color: unit === v ? '#fff' : c.text, fontWeight: '800' }}>{l}</Txt>
                    </Pressable>
                  ))}
                </Row>
              </View>
            ) : null}
            {price != null && mult > 1 ? <Txt variant="small">{unit === 'night' ? t('{n} nights at {each} each =', { n: mult, each: money(Number(amount), cur) }) : t('{n} days at {each} each =', { n: mult, each: money(Number(amount), cur) })} <Text style={{ fontWeight: '800' }}>{money(price, cur)}</Text> {t('per person in all')}</Txt> : null}
            {priceTooBig ? <Txt variant="small" color={c.danger}>{t('That is more than the plan can hold ({amount}).', { amount: money(100000, cur) })}</Txt> : null}
            {impact ? <Txt variant="small" bold color={impact.tone === 'over' ? c.warnFg : impact.tone === 'within' ? c.green : c.muted}>{impact.text}</Txt> : null}
          </>
        ) : (
          <>
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('Which day?')}</Txt>
              <DayStrip days={tripDays.filter((d) => !isPast(d))} value={day} onChange={setDay} dayNumber={dayNumber} />
              <Txt variant="small">{day ? `${dayNumber(day)} · ${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}` : t('No day yet: goes on the ideas list')}</Txt>
            </View>
            <View style={{ gap: 6 }}>
              <Txt variant="label">{t('What time of day?')}</Txt>
              <Segmented options={parts} value={time} onChange={setTime} />
            </View>
            <Field label={t('Exact time (optional)')} value={time} onChangeText={(v) => setTime(v.replace(/[^0-9:]/g, '').slice(0, 5))} keyboardType="numbers-and-punctuation" maxLength={5} placeholder={t('Like 14:30')} error={timeOk ? null : t('Use 24-hour time like 09:30')} />
          </>
        )}
        <Field label={t('Note (optional)')} value={note} onChangeText={setNote} multiline maxLength={500} />
        <Btn title={t('Save')} loading={act.busy} disabled={title.trim().length < 2 || !timeOk || priceTooBig} onPress={save} />
      </Sheet>
    </Screen>
  );
}
