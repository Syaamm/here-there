import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import type { Activity, Trip } from '@/lib/api';
import { catColor, CATS } from '@/lib/constants';
import { dateSpan, money, when } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Card, Chip, Row, Txt, useGo } from './ui';

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** "Brera" out of "Bar in Brera (Brera)" style venue names; falls back to the whole venue. */
const place = (venue: string) => /\(([^)]+)\)\s*$/.exec(venue)?.[1] ?? venue;

/** Dark pill laid over the coloured top of a card: "19:30 · Brera". */
function Pill({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ position: 'absolute', left: 10, bottom: 10, backgroundColor: c.forest, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5, maxWidth: '90%' }}>
      <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
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
      style={{ width, padding: 0, gap: 0, borderRadius: 20, overflow: 'hidden' }}
    >
      <View style={{ height: 104, backgroundColor: catColor(a.category), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40, opacity: 0.5 }} accessibilityElementsHidden>
          {cat?.emoji ?? '📍'}
        </Text>
        <Pill text={`${clock(a.startsAt)} · ${place(a.venueName)}`} />
      </View>
      <View style={{ padding: 14, gap: 8 }}>
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 17, lineHeight: 22 }}>{a.title}</Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">{a.going} of {a.capacity} going</Txt>
          {full ? <Chip label="Full" tone="warn" /> : <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 3 }}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 12 }}>{cat?.label ?? a.category}</Text></View>}
        </Row>
      </View>
    </Card>
  );
}

/** The last card of a sideways row: an arrow and "SHOW MORE", same width as the cards beside it. */
export function ShowMoreCard({ width, onPress, label = 'Show more' }: { width?: number; onPress: () => void; label?: string }) {
  const { c } = useTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: see every activity`} style={{ width, borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.accentSoft, borderWidth: 0, minHeight: 160 }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-forward" size={24} color="#fff" />
      </View>
      <Text style={{ color: c.text, fontWeight: '800', fontSize: 14, letterSpacing: 1 }}>{label.toUpperCase()}</Text>
    </Card>
  );
}

/** Compact row card for "More around you" and lists: coloured thumbnail, title, time and place, who's going. */
export function ActivityCard({ a }: { a: Activity }) {
  const go = useGo();
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  return (
    <Card
      onPress={() => go(`/activity/${a.id}`)}
      accessibilityLabel={`${a.title}, ${when(a.startsAt)}, ${a.venueName}, ${a.spotsLeft} spots left`}
      style={{ flexDirection: 'row', gap: 14, alignItems: 'center', borderRadius: 20, padding: 12 }}
    >
      <View style={{ width: 68, height: 68, borderRadius: 16, backgroundColor: catColor(a.category), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 28, opacity: 0.55 }} accessibilityElementsHidden>
          {cat?.emoji ?? '📍'}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 17, lineHeight: 22 }}>{a.title}</Txt>
        <Txt variant="muted" numberOfLines={1}>
          {clock(a.startsAt)} · {a.venueName}
          {a.distanceKm !== undefined ? ` · ${a.distanceKm} km` : ''}
        </Txt>
        <Txt variant="muted">
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
      style={{ width, padding: 0, gap: 0, borderRadius: 20, overflow: 'hidden' }}
    >
      <View style={{ height: 104, backgroundColor: tripColor(t), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 40, opacity: 0.5 }} accessibilityElementsHidden>✈️</Text>
        <Pill text={`${dateSpan(t.dateStart, t.dateEnd).replace(/ \d{4}$/, '')}${t.dateFlexibility !== 'exact' ? ' · flexible' : ''}`} />
      </View>
      <View style={{ padding: 14, gap: 8 }}>
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 17, lineHeight: 22 }}>{t.destination}</Txt>
        <Txt variant="muted" numberOfLines={1}>
          {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} pp {t.budget.includesTransport ? 'incl. travel' : 'excl. travel'}
        </Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">{t.members} of {t.maxCapacity} travelers</Txt>
          {full ? <Chip label="Full" tone="warn" /> : <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 3 }}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 12 }}>{t.spotsLeft} open</Text></View>}
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
