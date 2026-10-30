import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useCallback, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { DraftBar } from '@/components/DraftBar';
import { TabHeader } from '@/components/TabHeader';
import { Text, TextInput } from '@/components/ScaledText';
import { Banner, Between, Btn, CheckRow, Chip, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { get, post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { money, parseDay } from '@/lib/format';
import { useAction, useLoad } from '@/lib/hooks';
import { dropDraft } from '@/lib/drafts';
import { useFormDraft } from '@/lib/formDraft';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Section } from './CreateActivity';

const STEPS = 4;
/** The four date choices shown as one segmented control. */
const FLEX_CHOICES: readonly (readonly [string, string])[] = [
  ['exact', 'Exact'],
  ['plus_minus_1', '±1 day'],
  ['plus_minus_3', '±3 days'],
  ['plus_minus_7', '±1 wk'],
];
const GROUP_CHOICES: readonly (readonly [string, string])[] = GROUP_SIZES.map(([v]) => [v, v === '10+' ? '10+' : v.replace('-', '–')] as const);

type Draft = { destination: string; originCity: string; description: string; start: string; end: string; flex: string; min: string; max: string; transport: boolean; tags: string[]; size: string };

/** A card of the form with a small capitalised title and an optional note on the right ("8 nights", "3 selected"). */
function Block({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <Section>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 }}>{t(title)}</Text>
        {right ? <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>{right}</Text> : null}
      </View>
      {children}
    </Section>
  );
}

/** Two or more options in one rounded track; the chosen one is lifted. */
function Segments({ label, options, value, onChange }: { label: string; options: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map(([v, l]) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityLabel={t(l)}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(v)}
            style={{ flex: 1, minHeight: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}
          >
            <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '800' : '600', fontSize: 12 }}>{t(l)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A bordered tile with a small label above the value, like the route and date boxes. */
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

/**
 * THERE · Create: four short steps, like a form in any travel app. A trip is a proposal, never a booking or an offer to sell
 * travel. It behaves like the HERE form: leaving it saves what was typed as a draft and it comes back empty. Changing `round`
 * remounts the form, which is what empties it (and takes it back to the first step).
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
  const [f, setF] = useState<Draft>({ destination: '', originCity: me?.profile?.homeCity ?? '', description: '', start: '', end: '', flex: 'plus_minus_3', min: '', max: '', transport: true, tags: [], size: '4-6' });
  const [agree, setAgree] = useState(false);
  const [tried, setTried] = useState(false);
  const [calendar, setCalendar] = useState<null | 'start' | 'end'>(null);
  const act = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const loadDraft = useCallback((d: Record<string, unknown>) => setF((p) => ({ ...p, ...(d as Partial<Draft>) })), []);
  // leaving saves a draft and empties the form, "Clear all", and saving on leaving the app: shared with the activity form
  const { posted, clearAll } = useFormDraft('trip', f, hasContent, onReset);

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
  const detailProblems = [
    f.originCity.trim().length < 2 && t('where you leave from'),
    f.destination.trim().length < 2 && t('a destination'),
    !start && t('a departure date'),
    !!start && !end && t('a return date'),
    !!start && start < tomorrow && t('a departure from tomorrow on'),
    (nights ?? 0) > 90 && t('a trip of at most 90 nights'),
    ((!!start && start > lastDay) || (!!end && end > lastDay)) && tn(monthsAhead, 'dates within the next month', 'dates within the next {n} months'),
    (!f.min || !f.max || Number.isNaN(min) || Number.isNaN(max)) && t('a budget range'),
    !Number.isNaN(min) && !Number.isNaN(max) && !!f.min && !!f.max && max <= min && t('a maximum budget higher than the minimum'),
  ].filter(Boolean) as string[];
  const publishProblems = [...detailProblems, !agree && t('the guidelines ticked')].filter(Boolean) as string[];
  const verified = me?.eligibility === 'verified';

  const next = () => {
    if (step === 0 && detailProblems.length) return setTried(true);
    if (step === 2 && !agree) return setTried(true);
    setTried(false);
    setStep(step + 1);
  };
  const back = () => (step > 0 ? setStep(step - 1) : go('/'));

  const publish = async () => {
    if (publishProblems.length || !start || !end) return setTried(true);
    const created = await act.run(() =>
      post<Trip>('/v1/trips', {
        destination: f.destination.trim(),
        originCity: f.originCity.trim(),
        description: f.description.trim() || undefined,
        dateStart: start.toISOString(),
        dateEnd: end.toISOString(),
        dateFlexibility: f.flex,
        budgetCurrency: 'EUR',
        budgetMin: Math.floor(min),
        budgetMax: Math.floor(max),
        budgetIncludesTransport: f.transport,
        tags: f.tags,
        groupSize: f.size,
      }),
    );
    if (created) {
      posted.current = true;
      void dropDraft('trip');
      go(`/trip/${created.id}`);
    }
  };

  const titles = [t('Where are we going?'), t('Review your trip'), t('Group guidelines'), t('Ready to publish')];
  const input = { color: c.text, fontSize: 14, fontWeight: '700' as const, paddingVertical: 0, minHeight: 22, minWidth: 0 };
  const flexLabel = t(FLEX.find(([v]) => v === f.flex)?.[1] ?? '');
  const groupLabel = t(GROUP_SIZES.find(([v]) => v === f.size)?.[1] ?? '');

  return (
    <View style={{ flex: 1 }}>
    <Screen
      tabBar
      header={
        // the app header (wordmark and HERE | THERE), then this form's own back arrow, title and progress
        <View style={{ gap: 8 }}>
          <TabHeader compact />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={step > 0 ? t('Previous step') : t('Go back')} hitSlop={10} onPress={back} style={{ width: 44, height: 30, alignItems: 'flex-start', justifyContent: 'center' }}>
              <Ionicons name="chevron-back" size={22} color={c.text} />
            </Pressable>
            <Text accessibilityRole="header" style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{t('Create a trip')}</Text>
            <Text accessibilityLabel={t('Step {n} of {total}', { n: step + 1, total: STEPS })} style={{ color: c.muted, fontSize: 12, fontWeight: '700', width: 44, textAlign: 'right' }}>{t('{n} of {total}', { n: step + 1, total: STEPS })}</Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', gap: 5 }}>
            {Array.from({ length: STEPS }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? c.forest : c.line }} />
            ))}
          </View>
        </View>
      }
    >
      <Between>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{titles[step]}</Txt>
        </View>
        <Btn title={t('Clear all')} variant="ghost" small onPress={() => void clearAll()} disabled={!hasContent(f)} />
      </Between>

      {!verified && <Banner onPress={() => go('/verify')}>{t('Verify your identity to publish ›')}</Banner>}
      <ErrorBanner message={act.error} />

      {step === 0 && (
        <>
          <Block title="ROUTE">
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
              {/* a hollow dot where you leave, a line, a solid dot where you arrive */}
              <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 12, alignItems: 'center', paddingVertical: 18 }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: c.text }} />
                <View style={{ flex: 1, width: 1.5, backgroundColor: c.line, marginVertical: 3 }} />
                <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c.forest }} />
              </View>
              <View style={{ flex: 1, gap: 8 }}>
                <Tile label="Departing from *">
                  <TextInput accessibilityLabel={t('Departing from')} placeholder={t('Milan, Italy')} placeholderTextColor={c.placeholder} value={f.originCity} onChangeText={(v) => set('originCity', v)} maxLength={60} style={input} />
                </Tile>
                <Tile label="Destination *">
                  <TextInput accessibilityLabel={t('Destination')} placeholder={t('Tokyo & Kyoto, Japan')} placeholderTextColor={c.placeholder} value={f.destination} onChangeText={(v) => set('destination', v)} maxLength={100} style={input} />
                </Tile>
              </View>
            </View>
          </Block>

          <Block title="WHEN" right={nights !== null && nights >= 0 ? tn(nights, '{n} night', '{n} nights') : undefined}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['start', 'end'] as const).map((k) => {
                const d = k === 'start' ? start : end;
                return (
                  <Pressable key={k} accessibilityRole="button" accessibilityLabel={t('{kind} date: {day}. Opens a calendar', { kind: k === 'start' ? t('Depart') : t('Return'), day: d ? shortDay(d) : t('not chosen') })} onPress={() => setCalendar(k)} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.85 }]}>
                    <Tile label={k === 'start' ? 'Depart' : 'Return'} style={{ minHeight: 52, justifyContent: 'center', borderColor: tried && !d ? c.danger : c.line }}>
                      {d ? (
                        <>
                          <Text style={{ color: c.text, fontSize: 14, fontWeight: '800' }}>{shortDay(d)}</Text>
                          <Text style={{ color: c.muted, fontSize: 11 }}>{d.getFullYear()}</Text>
                        </>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="calendar-outline" size={16} color={c.muted} />
                          <Text style={{ color: c.muted, fontSize: 13, fontWeight: '700' }}>{t('Select date')}</Text>
                        </View>
                      )}
                    </Tile>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant="label">{t('How flexible are your dates?')}</Txt>
            <Segments label={t('How flexible are your dates?')} options={FLEX_CHOICES} value={f.flex} onChange={(v) => set('flex', v)} />
          </Block>

          <Block title="BUDGET & GROUP">
            <Txt variant="label">{t('Budget per person *')}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {([['Min', 'min'], ['Max', 'max']] as const).map(([label, k], i) => (
                <Fragment key={k}>
                  {i === 1 ? <Text style={{ color: c.muted, fontSize: 14 }}>–</Text> : null}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: tried && (!f[k] || (k === 'max' && (max <= min))) ? c.danger : c.line, borderRadius: 12, backgroundColor: c.surface, paddingHorizontal: 10, minHeight: 40 }}>
                    <Text style={{ color: c.muted, fontSize: 10 }}>{t(label)}</Text>
                    <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>€</Text>
                    <TextInput accessibilityLabel={label === 'Min' ? t('Budget minimum in euros') : t('Budget maximum in euros')} keyboardType="number-pad" placeholder={k === 'min' ? '1200' : '1800'} placeholderTextColor={c.placeholder} value={f[k]} onChangeText={(v) => set(k, v.replace(/\D/g, '').slice(0, 6))} style={{ ...input, flex: 1, minWidth: 0 }} />
                  </View>
                </Fragment>
              ))}
            </View>
            {!!f.min && !!f.max && max <= min ? <Txt variant="small" color={c.danger}>{t('The maximum has to be higher than the minimum.')}</Txt> : null}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([[true, 'Incl. travel'], [false, 'Excl. travel']] as const).map(([v, l]) => {
                const on = f.transport === v;
                return (
                  <Pressable key={l} accessibilityRole="button" accessibilityLabel={v ? t('Budget incl. travel') : t('Budget excl. travel')} accessibilityState={{ selected: on }} onPress={() => set('transport', v)} style={{ height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.forest : c.surface, justifyContent: 'center' }}>
                    <Text style={{ color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 11.5 }}>{t(l)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant="small">{t('Shown as an estimate, never a price.')}</Txt>
            <Txt variant="label">{t('Group size, including you *')}</Txt>
            <Segments label={t('Group size, including you')} options={GROUP_CHOICES} value={f.size} onChange={(v) => set('size', v)} />
          </Block>

          <Block title="TRAVEL INTERESTS" right={f.tags.length ? t('{n} selected', { n: f.tags.length }) : undefined}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {TRIP_TAGS.map((tag) => {
                const on = f.tags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    accessibilityRole="button"
                    accessibilityLabel={t(tag[0].toUpperCase() + tag.slice(1))}
                    accessibilityState={{ selected: on }}
                    hitSlop={{ top: 4, bottom: 4 }}
                    onPress={() => set('tags', on ? f.tags.filter((x) => x !== tag) : [...f.tags, tag])}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  >
                    {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                    <Text style={{ color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 12 }}>{t(tag[0].toUpperCase() + tag.slice(1))}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Block>

          <Block title="ABOUT THE TRIP">
            <TextInput
              accessibilityLabel={t('About the trip')}
              placeholder={t('Culture, food, city walks and local experiences.')}
              placeholderTextColor={c.placeholder}
              multiline
              value={f.description}
              onChangeText={(v) => set('description', v)}
              maxLength={2000}
              style={{ minHeight: 76, color: c.text, fontSize: 13, lineHeight: 19, textAlignVertical: 'top', paddingVertical: 0 }}
            />
            <Txt variant="small" style={{ textAlign: 'right' }}>{f.description.length} / 2000</Txt>
          </Block>
        </>
      )}

      {step === 1 && (
        <>
          <Block title="ROUTE">
            <Txt variant="h3" style={{ fontSize: 15 }}>{f.originCity || '—'} → {f.destination || '—'}</Txt>
          </Block>
          <Block title="WHEN" right={nights !== null ? tn(nights, '{n} night', '{n} nights') : undefined}>
            <Txt variant="h3" style={{ fontSize: 14 }}>{start && end ? `${shortDay(start)} ${start.getFullYear()}  →  ${shortDay(end)} ${end.getFullYear()}` : '—'}</Txt>
            <Txt variant="muted">{t('Dates: {flex}', { flex: flexLabel })}</Txt>
          </Block>
          <Block title="BUDGET & GROUP">
            <Txt variant="h3" style={{ fontSize: 14 }}>{t('{range} per person', { range: `${money(min || 0, 'EUR')}–${money(max || 0, 'EUR')}` })}</Txt>
            <Txt variant="muted">{f.transport ? t('Including travel') : t('Excluding travel')} · {groupLabel}</Txt>
          </Block>
          <Block title="TRAVEL INTERESTS">
            {f.tags.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {f.tags.map((tag) => (
                  <Chip key={tag} label={t(tag[0].toUpperCase() + tag.slice(1))} tone="neutral" />
                ))}
              </View>
            ) : (
              <Txt variant="muted">{t('None chosen')}</Txt>
            )}
          </Block>
          {f.description.trim() ? (
            <Block title="ABOUT THE TRIP">
              <Txt>{f.description.trim()}</Txt>
            </Block>
          ) : null}
        </>
      )}

      {step === 2 && (
        <Block title="BEFORE YOU PUBLISH">
          <View style={{ backgroundColor: c.accentSoft, borderRadius: 12, padding: 10 }}>
            <Txt variant="small" style={{ color: c.text, lineHeight: 17 }}>{t('THERE is not a travel agency. Everyone books flights, stays and activities themselves, directly with suppliers. Never ask for or send deposits.')}</Txt>
          </View>
          <CheckRow checked={agree} onChange={setAgree}>
            <Txt>{t('I confirm this is a non-commercial proposal for adults and I agree to the group guidelines.')}</Txt>
          </CheckRow>
        </Block>
      )}

      {step === 3 && (
        <Block title="WHAT HAPPENS NEXT">
          {(
            [
              ['person-add-outline', 'People apply to join. You read each introduction and approve who comes.'],
              ['chatbubbles-outline', 'The group chat opens only for approved members.'],
              ['calendar-outline', 'In the chat you can run a date poll, then ask everyone to confirm the final dates.'],
            ] as const
          ).map(([icon, text]) => (
            <Row key={text} style={{ gap: 12, alignItems: 'flex-start' }}>
              <View accessibilityElementsHidden importantForAccessibility="no" style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name={icon} size={17} color={c.forest} />
              </View>
              <Txt variant="muted" style={{ flex: 1, lineHeight: 20, color: c.text }}>{t(text)}</Txt>
            </Row>
          ))}
        </Block>
      )}

      {tried && step === 0 && detailProblems.length ? <Banner tone="bad">{t('Still needed: {list}.', { list: detailProblems.join(', ') })}</Banner> : null}
      {tried && step === 2 && !agree ? <Banner tone="bad">{t('Tick the box to continue.')}</Banner> : null}
      {tried && step === 3 && publishProblems.length ? <Banner tone="bad">{t('Still needed: {list}. Go back to fix it.', { list: publishProblems.join(', ') })}</Banner> : null}

      <Row style={{ gap: 10 }}>
        {step > 0 ? <Btn title={t('Back')} variant="secondary" onPress={back} style={{ flex: 1 }} /> : null}
        {step < STEPS - 1 ? <Btn title={t('Continue')} onPress={next} style={{ flex: 2 }} /> : <Btn title={t('Publish trip')} onPress={publish} loading={act.busy} style={{ flex: 2 }} />}
      </Row>
      <DraftBar kind="trip" data={f} onLoad={loadDraft} />
    </Screen>
    {/* the calendar sits just above the dock, outside the scrolling page */}
      <DateRangeSheet
        visible={calendar !== null}
        focus={calendar ?? 'start'}
        start={f.start}
        end={f.end}
        min={tomorrow}
        max={lastDay}
        onClose={() => setCalendar(null)}
        onDone={(s, e) => {
          setF((p) => ({ ...p, start: s, end: e }));
          setCalendar(null);
        }}
      />
    </View>
  );
}
