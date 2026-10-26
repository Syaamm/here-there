import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Banner, Btn, Card, Chip, Empty, ErrorBanner, Field, Row, Screen, Sheet, Spinner, Txt } from '@/components/ui';
import { ApiError, del, get, patch, post, type Trip } from '@/lib/api';
import { confirmAsync } from '@/lib/confirm';
import { useAction, useLoad, useRefresh } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

type Line = { id: string; kind: 'itinerary' | 'budget'; title: string; note: string | null; day: string | null; amount: number | null; addedBy: string; canEdit: boolean };
type Plan = {
  editable: boolean;
  itinerary: { days: { day: string | null; items: Line[] }[] };
  budget: { label: string; currency: string; items: Line[]; perPersonTotal: number; statedMin: number; statedMax: number; comparison: 'under' | 'within' | 'over' | null; note: string };
};

const DAY = 24 * 3600e3;
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const money = (n: number, cur: string) => `${cur === 'EUR' ? '€' : cur + ' '}${n.toLocaleString()}`;

/** The group's shared plan: what to do on which day, and rough costs. Only people in the group can open it. */
export default function TripPlan() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c } = useTheme();
  const plan = useLoad(() => get<Plan>(`/v1/trips/${id}/plan`), [id], 30_000, 'trip:plan');
  const trip = useLoad(() => get<Trip>(`/v1/trips/${id}`), [id], undefined, 'trip:plan:trip');
  const { refreshing, onRefresh } = useRefresh(() => Promise.all([plan.reload(), trip.reload()]));

  // the form: a new line, or an existing one being changed
  const [form, setForm] = useState<null | { kind: 'itinerary' | 'budget'; edit?: Line }>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const act = useAction(() => {
    setForm(null);
    void plan.reload();
  });

  const open = (kind: 'itinerary' | 'budget', edit?: Line) => {
    setForm({ kind, edit });
    setTitle(edit?.title ?? '');
    setNote(edit?.note ?? '');
    setAmount(edit?.amount != null ? String(edit.amount) : '');
    setDay(edit?.day ? edit.day.slice(0, 10) : null);
    act.setError(null);
  };
  const save = () =>
    void act.run(() => {
      const body = form!.kind === 'itinerary' ? { title: title.trim(), note: note.trim() || undefined, day: day ? new Date(`${day}T12:00:00Z`).toISOString() : undefined } : { title: title.trim(), note: note.trim() || undefined, amount: Math.max(0, Math.floor(Number(amount) || 0)) };
      if (form!.edit) return patch(`/v1/trips/${id}/plan/items/${form!.edit.id}`, { ...body, note: note.trim() || null, ...(form!.kind === 'itinerary' ? { day: day ? body.day : null } : {}) });
      return post(`/v1/trips/${id}/plan/items`, { kind: form!.kind, ...body });
    });
  const remove = async (l: Line) => {
    if (await confirmAsync('Remove this line?', undefined, 'Remove', true)) void act.run(() => del(`/v1/trips/${id}/plan/items/${l.id}`));
  };

  // the days the trip covers, to pick from
  const days: string[] = [];
  if (trip.data) for (let t = +new Date(trip.data.dateStart); t <= +new Date(trip.data.dateEnd) && days.length < 31; t += DAY) days.push(new Date(t).toISOString().slice(0, 10));

  const p = plan.data;
  const forbidden = plan.error instanceof ApiError && plan.error.status === 403;

  const row = (l: Line) => (
    <View key={l.id} style={{ paddingVertical: 8, gap: 2, borderTopWidth: 1, borderColor: c.line }}>
      <Row style={{ gap: 8, alignItems: 'center' }}>
        <Txt variant="h3" style={{ fontSize: 15, lineHeight: 20, flex: 1 }}>{l.title}</Txt>
        {l.kind === 'budget' && l.amount != null ? <Txt variant="h3" style={{ fontSize: 15 }}>{money(l.amount, p?.budget.currency ?? 'EUR')}</Txt> : null}
      </Row>
      {l.note ? <Txt>{l.note}</Txt> : null}
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <Txt variant="small" style={{ flex: 1 }}>Added by {l.addedBy}</Txt>
        {l.canEdit ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${l.title}`} onPress={() => open(l.kind, l)} hitSlop={8}><Txt variant="small" style={{ color: c.green, fontWeight: '800' }}>Edit</Txt></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${l.title}`} onPress={() => void remove(l)} hitSlop={8}><Txt variant="small" style={{ color: c.danger, fontWeight: '800' }}>Remove</Txt></Pressable>
          </>
        ) : null}
      </Row>
    </View>
  );

  return (
    <Screen hasHeader onRefresh={onRefresh} refreshing={refreshing}>
      {plan.loading && !p && <Spinner />}
      {forbidden ? <Empty title="The plan is for the group">Once the organizer approves you, the shared plan opens here.</Empty> : <ErrorBanner message={plan.error?.message} />}
      {p ? (
        <>
          <Txt variant="muted">Plan together: who does what on which day, and rough costs. Anyone in the group can add a line.</Txt>

          <Row style={{ alignItems: 'center' }}>
            <Txt variant="h2" style={{ fontSize: 20, flex: 1 }}>Itinerary</Txt>
            {p.editable ? <Btn title="Add" small onPress={() => open('itinerary')} /> : null}
          </Row>
          {p.itinerary.days.length === 0 ? <Empty title="Nothing planned yet">Add the first stop or idea.</Empty> : null}
          {p.itinerary.days.map((d) => (
            <Card key={d.day ?? 'none'} style={{ padding: 14, borderRadius: 18, gap: 0 }}>
              <Txt variant="h3" style={{ marginBottom: 4 }}>{d.day ? dayLabel(d.day) : 'Not decided yet'}</Txt>
              {d.items.map(row)}
            </Card>
          ))}

          <Row style={{ alignItems: 'center', marginTop: 8 }}>
            <Txt variant="h2" style={{ fontSize: 20, flex: 1 }}>Budget notes</Txt>
            {p.editable ? <Btn title="Add" small onPress={() => open('budget')} /> : null}
          </Row>
          <Txt variant="small">{p.budget.label}. Per person, in {p.budget.currency}.</Txt>
          <Card style={{ padding: 14, borderRadius: 18, gap: 0 }}>
            {p.budget.items.length === 0 ? <Txt>No costs noted yet.</Txt> : p.budget.items.map(row)}
            {p.budget.items.length > 0 ? (
              <View style={{ paddingTop: 10, gap: 4, borderTopWidth: 1, borderColor: c.line }}>
                <Row style={{ alignItems: 'center' }}>
                  <Txt variant="h3" style={{ flex: 1 }}>Total per person</Txt>
                  <Txt variant="h3">{money(p.budget.perPersonTotal, p.budget.currency)}</Txt>
                </Row>
                <Row style={{ gap: 8, alignItems: 'center' }}>
                  <Txt variant="small" style={{ flex: 1 }}>The trip said {money(p.budget.statedMin, p.budget.currency)} to {money(p.budget.statedMax, p.budget.currency)}</Txt>
                  {p.budget.comparison ? <Chip label={p.budget.comparison === 'within' ? 'Within' : p.budget.comparison === 'over' ? 'Above' : 'Below'} tone={p.budget.comparison === 'over' ? 'warn' : 'ok'} /> : null}
                </Row>
              </View>
            ) : null}
          </Card>
          <Banner>{p.budget.note}</Banner>
        </>
      ) : null}

      <Sheet visible={!!form} title={`${form?.edit ? 'Change' : 'Add'} ${form?.kind === 'budget' ? 'a cost' : 'a stop or idea'}`} onClose={() => setForm(null)}>
        <ErrorBanner message={act.error} />
        <Field label={form?.kind === 'budget' ? 'What is it for? (hostel, food, local transport)' : 'What is the plan?'} value={title} onChangeText={setTitle} maxLength={100} />
        {form?.kind === 'budget' ? (
          <Field label={`Estimated cost per person (${p?.budget.currency ?? 'EUR'})`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" maxLength={6} />
        ) : (
          <>
            <Txt variant="small">Day</Txt>
            <Row style={{ flexWrap: 'wrap', gap: 6 }}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: day === null }} onPress={() => setDay(null)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: day === null ? c.forest : c.line, backgroundColor: day === null ? c.forest : c.surface, justifyContent: 'center' }}>
                <Txt variant="small" style={{ color: day === null ? '#fff' : c.text, fontWeight: '800' }}>Not decided</Txt>
              </Pressable>
              {days.map((d) => (
                <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: day === d }} onPress={() => setDay(d)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: day === d ? c.forest : c.line, backgroundColor: day === d ? c.forest : c.surface, justifyContent: 'center' }}>
                  <Txt variant="small" style={{ color: day === d ? '#fff' : c.text, fontWeight: '800' }}>{dayLabel(`${d}T12:00:00Z`)}</Txt>
                </Pressable>
              ))}
            </Row>
          </>
        )}
        <Field label="Note (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
        <Btn title="Save" loading={act.busy} disabled={title.trim().length < 2 || (form?.kind === 'budget' && amount === '')} onPress={save} />
      </Sheet>
    </Screen>
  );
}
