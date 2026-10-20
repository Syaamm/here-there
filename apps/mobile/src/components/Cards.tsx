import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import type { Activity, Trip } from '@/lib/api';
import { catColor, CATS } from '@/lib/constants';
import { dateSpan, money, when } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { CatPhoto } from './CatPhoto';
import { sc } from '@/lib/scale';
import { Card, Chip, Row, Txt, useGo } from './ui';

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** "Brera" out of "Bar in Brera (Brera)" style venue names; falls back to the whole venue. */
const place = (venue: string) => /\(([^)]+)\)\s*$/.exec(venue)?.[1] ?? venue;

/** Dark pill laid over the coloured top of a card: "19:30 · Brera". */
function Pill({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: c.forest, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, maxWidth: '90%' }}>
      <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: 10.5 }}>
        {text}
      </Text>
    </View>
  );
}

/** Big card for the "Happening soon" strip. */
export function FeatureCard({ a, width }: { a: Activity; width?: number }) {
  const go = useGo();
  const { c } = useTheme();
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  return (
    <Card
      onPress={() => go(`/activity/${a.id}`)}
      accessibilityLabel={`${a.title}, ${when(a.startsAt)}, ${a.venueName}, ${a.going} of ${a.capacity} going${full ? ', full' : `, ${a.spotsLeft} spots left`}`}
      style={{ width, padding: 0, gap: 0, borderRadius: 14, overflow: 'hidden' }}
    >
      <CatPhoto category={a.category} style={{ height: sc(64) }} />
      <View style={{ padding: 9, gap: 4 }}>
        {/* two lines of height reserved, so cards side by side stay level */}
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 12.5, lineHeight: 16, minHeight: 32 }}>{a.title}</Txt>
        <Txt variant="small" numberOfLines={1} color={c.forest} bold style={{ fontSize: 11, lineHeight: 15 }}>{clock(a.startsAt)} · {place(a.venueName)}</Txt>
        <Row style={{ justifyContent: 'space-between', gap: 4 }}>
          <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{a.going} of {a.capacity} going</Txt>
          {full ? <Chip label="Full" tone="warn" /> : <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 10 }}>{cat?.label ?? a.category}</Text></View>}
        </Row>
      </View>
    </Card>
  );
}

/** "in 45 min" / "in 1 h 20 min" / "in 3 h" */
function startsIn(iso: string) {
  const min = Math.max(1, Math.round((+new Date(iso) - Date.now()) / 60000));
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/** A wide card for the one activity that starts next, used when nothing starts within two hours. */
export function NextUpCard({ a }: { a: Activity }) {
  const go = useGo();
  const { c } = useTheme();
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  return (
    <Card
      onPress={() => go(`/activity/${a.id}`)}
      accessibilityLabel={`Next up: ${a.title}, ${when(a.startsAt)}, ${startsIn(a.startsAt)}, ${a.venueName}, ${a.going} of ${a.capacity} going`}
      style={{ padding: 0, gap: 0, borderRadius: 18, overflow: 'hidden' }}
    >
      <CatPhoto category={a.category} style={{ height: 104 }} />
      <View style={{ padding: 11, gap: 4 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="h3" numberOfLines={2} style={{ flex: 1, fontSize: 14, lineHeight: 19 }}>{a.title}</Txt>
          <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
            <Text style={{ color: c.onAccent, fontWeight: '800', fontSize: 11 }}>{startsIn(a.startsAt)}</Text>
          </View>
        </Row>
        <Txt variant="small" numberOfLines={1} color={c.forest} bold>{clock(a.startsAt)} · {place(a.venueName)}</Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">{a.going} of {a.capacity} going · {cat?.label ?? a.category}</Txt>
          {full ? <Chip label="Full" tone="warn" /> : <Txt variant="label" color={c.forest}>See details ›</Txt>}
        </Row>
      </View>
    </Card>
  );
}

/** The end of a sideways row: just a round arrow, centred against the card before it. Opens the full list. */
export function ShowMoreCard({ width = 56, onPress, label = 'Show more' }: { width?: number; onPress: () => void; label?: string }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: see every activity`} hitSlop={6} onPress={onPress} style={({ pressed }) => [{ width, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] }]}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-forward" size={20} color="#fff" />
      </View>
    </Pressable>
  );
}

/** Compact row card for "More around you" and lists: coloured thumbnail, title, time and place, who's going. */
export function ActivityCard({ a, onPress }: { a: Activity; onPress?: () => void }) {
  const go = useGo();
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  return (
    <Card
      onPress={onPress ?? (() => go(`/activity/${a.id}`))}
      accessibilityLabel={`${a.title}, ${when(a.startsAt)}, ${a.venueName}, ${a.spotsLeft} spots left${onPress ? '. Show on the map' : ''}`}
      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 12, padding: 8 }}
    >
      <CatPhoto category={a.category} style={{ width: 42, height: 42, borderRadius: 10 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="h3" numberOfLines={1} style={{ fontSize: 13, lineHeight: 17 }}>{a.title}</Txt>
        <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
          {clock(a.startsAt)} · {a.venueName}
          {a.distanceKm !== undefined ? ` · ${a.distanceKm} km` : ''}
        </Txt>
        <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
          {a.going} going · {full ? 'Full' : `${a.spotsLeft} ${a.spotsLeft === 1 ? 'spot' : 'spots'} left`} · {cat?.label ?? a.category}
        </Txt>
      </View>
    </Card>
  );
}

const tripColor = (t: Trip) => catColor(t.tags.includes('culture') ? 'culture' : t.tags.includes('food') ? 'food' : t.tags.some((x) => ['adventure', 'hiking', 'nature'].includes(x)) ? 'sports' : 'drinks');

/** Big card for THERE's "Featured trips" strip, in the same style as the HERE feature card. */
export function TripFeatureCard({ t, width }: { t: Trip; width?: number }) {
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  return (
    <Card
      onPress={() => go(`/trip/${t.id}`)}
      accessibilityLabel={`${t.title}, ${dateSpan(t.dateStart, t.dateEnd)}, estimated ${money(t.budget.min, t.budget.currency)} to ${money(t.budget.max, t.budget.currency)} per person, ${t.members} of ${t.maxCapacity} travelers`}
      style={{ width, padding: 0, gap: 0, borderRadius: 16, overflow: 'hidden' }}
    >
      <View style={{ height: 84, backgroundColor: tripColor(t), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 32, opacity: 0.5 }} accessibilityElementsHidden>✈️</Text>
        <Pill text={`${dateSpan(t.dateStart, t.dateEnd).replace(/ \d{4}$/, '')}${t.dateFlexibility !== 'exact' ? ' · flexible' : ''}`} />
      </View>
      <View style={{ padding: 11, gap: 6 }}>
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 14, lineHeight: 19 }}>{t.destination}</Txt>
        <Txt variant="muted" numberOfLines={1}>
          {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} pp {t.budget.includesTransport ? 'incl. travel' : 'excl. travel'}
        </Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">{t.members} of {t.maxCapacity} travelers</Txt>
          {full ? <Chip label="Full" tone="warn" /> : <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 11 }}>{t.spotsLeft} open</Text></View>}
        </Row>
      </View>
    </Card>
  );
}

export function TripCard({ t }: { t: Trip }) {
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  return (
    <Card onPress={() => go(`/trip/${t.id}`)} accessibilityLabel={`${t.title}, ${dateSpan(t.dateStart, t.dateEnd)}, estimated ${money(t.budget.min, t.budget.currency)} to ${money(t.budget.max, t.budget.currency)} per person`} style={{ gap: 6, borderRadius: 20 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Chip label="✈ Trip proposal" tone="neutral" />
        {t.match ? (
          t.match.dates === 'exact' ? <Chip label="Exact dates" tone="ok" /> : t.match.dates === 'approximate' ? <Chip label="Approximate dates" tone="warn" /> : null
        ) : full ? (
          <Chip label="Full" tone="warn" />
        ) : null}
      </Row>
      <Txt variant="h3">{t.destination}</Txt>
      <Txt variant="small">
        {dateSpan(t.dateStart, t.dateEnd)}
        {t.dateFlexibility !== 'exact' ? ' (flexible)' : ''} · {t.members}/{t.maxCapacity} travelers
      </Txt>
      <Text style={{ color: c.text, fontWeight: '700' }}>
        {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} <Text style={{ fontWeight: '400', color: c.muted }}>pp estimate{t.budget.includesTransport ? ', incl. travel' : ', excl. travel'}</Text>
      </Text>
      {t.match?.budgetScopeMismatch ? <Txt variant="small" color={c.warnFg}>Budget covers a different scope than you searched (travel included or not).</Txt> : null}
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {t.tags.slice(0, 4).map((x) => (
          <Chip key={x} label={x} tone="neutral" />
        ))}
      </Row>
      <Txt variant="small">Organizer: {t.host.displayName}{t.host.verifiedAdult ? ' ✓' : ''}</Txt>
    </Card>
  );
}
