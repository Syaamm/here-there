import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { DateRangeSheet, lastPlanningDay, shortDay } from '@/components/DateRangeSheet';
import { TabHeader } from '@/components/TabHeader';
import { Text, TextInput } from '@/components/ScaledText';
import { Banner, Btn, CheckRow, Chip, ErrorBanner, Row, Screen, Txt, useGo } from '@/components/ui';
import { post, type Trip } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { FLEX, GROUP_SIZES, TRIP_TAGS } from '@/lib/constants';
import { money, parseDay } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';
import { Section } from './CreateActivity';

const DRAFT = 'ht_trip_draft_v2';
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
  return (
    <Section>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 }}>{title}</Text>
        {right ? <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700' }}>{right}</Text> : null}
      </View>
      {children}
    </Section>
  );
}

/** Two or more options in one rounded track; the chosen one is lifted. */
function Segments({ label, options, value, onChange }: { label: string; options: readonly (readonly [string, string])[]; value: string; onChange: (v: string) => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: c.sand, borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map(([v, l]) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityLabel={l}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(v)}
            style={{ flex: 1, minHeight: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.surface : 'transparent', borderWidth: 1, borderColor: on ? c.line : 'transparent' }}
          >
            <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '800' : '600', fontSize: 12 }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A bordered tile with a small label above the value, like the route and date boxes. */
function Tile({ label, children, style }: { label: string; children: ReactNode; style?: object }) {
  const { c } = useTheme();
  return (
    <View style={[{ borderWidth: 1, borderColor: c.line, borderRadius: 12, backgroundColor: c.surface, paddingHorizontal: 10, paddingVertical: 6, gap: 0 }, style]}>
      <Text style={{ color: c.muted, fontSize: 10 }}>{label}</Text>
      {children}
    </View>
  );
}

/** THERE · Create: four short steps, like a form in any travel app. A trip is a proposal, never a booking or an offer to sell travel. Drafts stay on this device. */
export function CreateTrip() {
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

  useEffect(() => {
    AsyncStorage.getItem(DRAFT)
      .then((raw) => raw && setF((p) => ({ ...p, ...JSON.parse(raw) })))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => AsyncStorage.setItem(DRAFT, JSON.stringify(f)).catch(() => {}), 600);
    return () => clearTimeout(t);
  }, [f]);

  const start = parseDay(f.start);
  const end = parseDay(f.end);
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const min = Number(f.min);
  const max = Number(f.max);
  const nights = start && end ? Math.round((+end - +start) / 864e5) : null;
  // plans reach at most to the end of the month six months from now
  const lastDay = lastPlanningDay(6);

  // what is still missing, so a button can say so instead of sitting there greyed out
  const detailProblems = [
    f.originCity.trim().length < 2 && 'where you leave from',
    f.destination.trim().length < 2 && 'a destination',
    !start && 'a departure date',
    !!start && !end && 'a return date',
    !!start && start < tomorrow && 'a departure from tomorrow on',
    (nights ?? 0) > 90 && 'a trip of at most 90 nights',
    ((!!start && start > lastDay) || (!!end && end > lastDay)) && 'dates within the next 6 months',
    (!f.min || !f.max || Number.isNaN(min) || Number.isNaN(max)) && 'a budget range',
    !Number.isNaN(min) && !Number.isNaN(max) && !!f.min && !!f.max && max <= min && 'a maximum budget higher than the minimum',
  ].filter(Boolean) as string[];
  const publishProblems = [...detailProblems, !agree && 'the guidelines ticked'].filter(Boolean) as string[];
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
    const t = await act.run(() =>
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
    if (t) {
      AsyncStorage.removeItem(DRAFT).catch(() => {});
      go(`/trip/${t.id}`);
    }
  };

  const titles = ['Where are we going?', 'Review your trip', 'Group guidelines', 'Ready to publish'];
  const lines = [
    "Propose a trip and we'll match you with compatible travelers. Details stay open until you agree on them together.",
    'Check everything once more. You can still go back and change it.',
    'A trip is a proposal. These rules keep every group safe.',
    'Your trip goes live in the feed. Nobody is charged and nothing is booked.',
  ];
  const input = { color: c.text, fontSize: 14, fontWeight: '700' as const, paddingVertical: 0, minHeight: 22, minWidth: 0 };
  const flexLabel = FLEX.find(([v]) => v === f.flex)?.[1] ?? '';
  const groupLabel = GROUP_SIZES.find(([v]) => v === f.size)?.[1] ?? '';

  return (
    <View style={{ flex: 1 }}>
    <Screen
      tabBar
      header={
        // the app header (wordmark and HERE | THERE), then this form's own back arrow, title and progress
        <View style={{ gap: 8 }}>
          <TabHeader compact />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable accessibilityRole="button" accessibilityLabel={step > 0 ? 'Previous step' : 'Go back'} hitSlop={10} onPress={back} style={{ width: 44, height: 30, alignItems: 'flex-start', justifyContent: 'center' }}>
              <Ionicons name="chevron-back" size={22} color={c.text} />
            </Pressable>
            <Text accessibilityRole="header" style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>Create a trip</Text>
            <Text accessibilityLabel={`Step ${step + 1} of ${STEPS}`} style={{ color: c.muted, fontSize: 12, fontWeight: '700', width: 44, textAlign: 'right' }}>{step + 1} of {STEPS}</Text>
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', gap: 5 }}>
            {Array.from({ length: STEPS }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? c.forest : c.line }} />
            ))}
          </View>
        </View>
      }
    >
      <View style={{ gap: 2 }}>
        <Txt variant="h1" style={{ fontSize: 22, lineHeight: 28 }}>{titles[step]}</Txt>
        <Txt variant="muted">{lines[step]}</Txt>
      </View>

      {!verified && <Banner onPress={() => go('/verify')}>You need a verified identity to publish a trip. You can fill this in now and it is kept as a draft. Verify ›</Banner>}
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
                  <TextInput accessibilityLabel="Departing from" placeholder="Milan, Italy" placeholderTextColor={c.placeholder} value={f.originCity} onChangeText={(v) => set('originCity', v)} maxLength={60} style={input} />
                </Tile>
                <Tile label="Destination *">
                  <TextInput accessibilityLabel="Destination" placeholder="Tokyo & Kyoto, Japan" placeholderTextColor={c.placeholder} value={f.destination} onChangeText={(v) => set('destination', v)} maxLength={100} style={input} />
                </Tile>
              </View>
            </View>
          </Block>

          <Block title="WHEN" right={nights !== null && nights >= 0 ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : undefined}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['start', 'end'] as const).map((k) => {
                const d = k === 'start' ? start : end;
                return (
                  <Pressable key={k} accessibilityRole="button" accessibilityLabel={`${k === 'start' ? 'Depart' : 'Return'} date: ${d ? shortDay(d) : 'not chosen'}. Opens a calendar`} onPress={() => setCalendar(k)} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.85 }]}>
                    <Tile label={k === 'start' ? 'Depart' : 'Return'} style={{ minHeight: 52, justifyContent: 'center', borderColor: tried && !d ? c.danger : c.line }}>
                      {d ? (
                        <>
                          <Text style={{ color: c.text, fontSize: 14, fontWeight: '800' }}>{shortDay(d)}</Text>
                          <Text style={{ color: c.muted, fontSize: 11 }}>{d.getFullYear()}</Text>
                        </>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="calendar-outline" size={16} color={c.muted} />
                          <Text style={{ color: c.muted, fontSize: 13, fontWeight: '700' }}>Select date</Text>
                        </View>
                      )}
                    </Tile>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant="label">How flexible are your dates?</Txt>
            <Segments label="How flexible are your dates?" options={FLEX_CHOICES} value={f.flex} onChange={(v) => set('flex', v)} />
            <Txt variant="small">Dates stay tentative until every approved member confirms them.</Txt>
          </Block>

          <Block title="BUDGET & GROUP">
            <Txt variant="label">Budget per person *</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {([['Min', 'min'], ['Max', 'max']] as const).map(([label, k], i) => (
                <Fragment key={k}>
                  {i === 1 ? <Text style={{ color: c.muted, fontSize: 14 }}>–</Text> : null}
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: tried && (!f[k] || (k === 'max' && (max <= min))) ? c.danger : c.line, borderRadius: 12, backgroundColor: c.surface, paddingHorizontal: 10, minHeight: 40 }}>
                    <Text style={{ color: c.muted, fontSize: 10 }}>{label}</Text>
                    <Text style={{ color: c.text, fontSize: 14, fontWeight: '700' }}>€</Text>
                    <TextInput accessibilityLabel={`Budget ${label === 'Min' ? 'minimum' : 'maximum'} in euros`} keyboardType="number-pad" placeholder={k === 'min' ? '1200' : '1800'} placeholderTextColor={c.placeholder} value={f[k]} onChangeText={(v) => set(k, v.replace(/\D/g, '').slice(0, 6))} style={{ ...input, flex: 1, minWidth: 0 }} />
                  </View>
                </Fragment>
              ))}
            </View>
            {!!f.min && !!f.max && max <= min ? <Txt variant="small" color={c.danger}>The maximum has to be higher than the minimum.</Txt> : null}
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([[true, 'Incl. travel'], [false, 'Excl. travel']] as const).map(([v, l]) => {
                const on = f.transport === v;
                return (
                  <Pressable key={l} accessibilityRole="button" accessibilityLabel={`Budget ${l.toLowerCase()}`} accessibilityState={{ selected: on }} onPress={() => set('transport', v)} style={{ height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.forest : c.surface, justifyContent: 'center' }}>
                    <Text style={{ color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 11.5 }}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Txt variant="small">{f.transport ? 'Includes the journey there. ' : 'Excludes flights and other travel to the destination. '}Shown to others as an estimate, never as a price.</Txt>
            <Txt variant="label">Group size, including you *</Txt>
            <Segments label="Group size, including you" options={GROUP_CHOICES} value={f.size} onChange={(v) => set('size', v)} />
          </Block>

          <Block title="TRAVEL INTERESTS" right={f.tags.length ? `${f.tags.length} selected` : undefined}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {TRIP_TAGS.map((t) => {
                const on = f.tags.includes(t);
                return (
                  <Pressable
                    key={t}
                    accessibilityRole="button"
                    accessibilityLabel={`${t[0].toUpperCase()}${t.slice(1)}`}
                    accessibilityState={{ selected: on }}
                    hitSlop={{ top: 4, bottom: 4 }}
                    onPress={() => set('tags', on ? f.tags.filter((x) => x !== t) : [...f.tags, t])}
                    style={{ height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: 5 }}
                  >
                    {on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                    <Text style={{ color: on ? '#fff' : c.text, fontWeight: '700', fontSize: 12 }}>{t[0].toUpperCase() + t.slice(1)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Block>

          <Block title="ABOUT THE TRIP">
            <TextInput
              accessibilityLabel="About the trip"
              placeholder="Culture, food, city walks and local experiences."
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
          <Block title="WHEN" right={nights !== null ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : undefined}>
            <Txt variant="h3" style={{ fontSize: 14 }}>{start && end ? `${shortDay(start)} ${start.getFullYear()}  →  ${shortDay(end)} ${end.getFullYear()}` : '—'}</Txt>
            <Txt variant="muted">Dates: {flexLabel}</Txt>
          </Block>
          <Block title="BUDGET & GROUP">
            <Txt variant="h3" style={{ fontSize: 14 }}>{money(min || 0, 'EUR')}–{money(max || 0, 'EUR')} per person</Txt>
            <Txt variant="muted">{f.transport ? 'Including travel' : 'Excluding travel'} · {groupLabel}</Txt>
          </Block>
          <Block title="TRAVEL INTERESTS">
            {f.tags.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {f.tags.map((t) => (
                  <Chip key={t} label={t} tone="neutral" />
                ))}
              </View>
            ) : (
              <Txt variant="muted">None chosen</Txt>
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
            <Txt variant="small" style={{ color: c.text, lineHeight: 17 }}>THERE is not a travel agency. Everyone books flights, stays and activities themselves, directly with suppliers. Never ask for or send deposits.</Txt>
          </View>
          <CheckRow checked={agree} onChange={setAgree}>
            <Txt>I confirm this is a non-commercial proposal for adults and I agree to the group guidelines.</Txt>
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
              <Txt variant="muted" style={{ flex: 1, lineHeight: 20, color: c.text }}>{text}</Txt>
            </Row>
          ))}
        </Block>
      )}

      {tried && step === 0 && detailProblems.length ? <Banner tone="bad">{`Still needed: ${detailProblems.join(', ')}.`}</Banner> : null}
      {tried && step === 2 && !agree ? <Banner tone="bad">Tick the box to continue.</Banner> : null}
      {tried && step === 3 && publishProblems.length ? <Banner tone="bad">{`Still needed: ${publishProblems.join(', ')}. Go back to fix it.`}</Banner> : null}

      <Row style={{ gap: 10 }}>
        {step > 0 ? <Btn title="Back" variant="secondary" onPress={back} style={{ flex: 1 }} /> : null}
        {step < STEPS - 1 ? <Btn title="Continue" onPress={next} style={{ flex: 2 }} /> : <Btn title="Publish trip" onPress={publish} loading={act.busy} style={{ flex: 2 }} />}
      </Row>

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
