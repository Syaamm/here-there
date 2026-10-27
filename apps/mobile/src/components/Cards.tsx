import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import type { Activity, Trip } from '@/lib/api';
import { catColor, CATS } from '@/lib/constants';
import { circleLine, dateSpan, money, when } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { CatPhoto } from './CatPhoto';
import { sc } from '@/lib/scale';
import { Avatar, Btn, Card, Chip, Row, Txt, useGo } from './ui';

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


/** The host's face and dashed rings for the open places (up to three in all): who is going, at a glance. */
function Faces({ a }: { a: Activity }) {
  const { c } = useTheme();
  const rings = Math.max(0, Math.min(3, a.capacity) - 1);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ borderRadius: 999, borderWidth: 2, borderColor: c.surface }}>
        <Avatar name={a.host.displayName} uri={a.host.photoUrl} size={28} />
      </View>
      {Array.from({ length: rings }).map((_, i) => (
        <View key={i} style={{ marginLeft: -7, width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.muted, backgroundColor: c.surface }} />
      ))}
    </View>
  );
}

/** The one activity that starts next: a big card with a "Starts in" pill on the photo, the facts, and a See details button. */
export function NextUpCard({ a, status }: { a: Activity; /** your part in it: "You host this", "Going", "Request pending" */ status?: { label: string; tone: 'ok' | 'warn' | 'bad' } }) {
  const go = useGo();
  const { c } = useTheme();
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  return (
    <Card style={{ padding: 0, gap: 0, borderRadius: 20, overflow: 'hidden' }}>
      {/* the picture and the facts open the activity; the button below is its own control (a button cannot sit inside another) */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Next up: ${a.title}, ${when(a.startsAt)}, starts ${startsIn(a.startsAt)}, ${a.venueName}, ${a.going} of ${a.capacity} going`}
        onPress={() => go(`/activity/${a.id}`)}
      >
      <View>
        <CatPhoto category={a.category} style={{ height: 120 }} />
        <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: c.text, fontWeight: '700', fontSize: 11 }}>{+new Date(a.startsAt) <= Date.now() ? 'Happening now' : `Starts ${startsIn(a.startsAt)}`}</Text>
        </View>
        {status ? (
          <View style={{ position: 'absolute', right: 10, top: 10 }}>
            <Chip label={status.label} tone={status.tone} />
          </View>
        ) : null}
      </View>
      <View style={{ padding: 12, paddingBottom: 0, gap: 9 }}>
        <Row style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <Txt variant="h2" numberOfLines={2} style={{ flex: 1, fontSize: 17, lineHeight: 22 }}>{a.title}</Txt>
          <Chip label={cat?.label ?? a.category} tone="ok" />
        </Row>
        <Row style={{ gap: 16, flexWrap: 'wrap' }}>
          <Row style={{ gap: 6 }}>
            <Ionicons name="time-outline" size={16} color={c.muted} />
            <Txt variant="muted">{clock(a.startsAt)}</Txt>
          </Row>
          <Row style={{ gap: 6, flexShrink: 1 }}>
            <Ionicons name="location-outline" size={16} color={c.muted} />
            <Txt variant="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{place(a.venueName)}</Txt>
          </Row>
        </Row>
        <Row style={{ gap: 10 }}>
          <Faces a={a} />
          <Txt variant="small" style={{ flex: 1 }}>
            {a.going} of {a.capacity} going ·{' '}
            <Text style={{ color: full ? c.danger : c.text, fontWeight: '700' }}>{full ? 'Full' : `${a.spotsLeft} ${a.spotsLeft === 1 ? 'spot' : 'spots'} left`}</Text>
          </Txt>
        </Row>
      </View>
      </Pressable>
      <View style={{ padding: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See details: ${a.title}`}
          onPress={() => go(`/activity/${a.id}`)}
          style={({ pressed }) => [{ height: 40, borderRadius: 999, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
        >
          <Txt variant="h3" color={c.forest} style={{ fontSize: 13 }}>See details</Txt>
          <Ionicons name="chevron-forward" size={16} color={c.forest} />
        </Pressable>
      </View>
    </Card>
  );
}

/** One activity as a list row: category tile, title, time and place, who is going, and an arrow. */
export function ActivityRow({ a }: { a: Activity }) {
  const go = useGo();
  const { c } = useTheme();
  const cat = CATS[a.category];
  return (
    <Card
      onPress={() => go(`/activity/${a.id}`)}
      accessibilityLabel={`${a.title}, ${when(a.startsAt)}, ${a.venueName}, ${a.going} of ${a.capacity} going${a.spotsLeft === 0 ? ', full' : `, ${a.spotsLeft} spots left`}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, borderRadius: 16 }}
    >
      {/* the category's own picture, as everywhere else */}
      <CatPhoto category={a.category} style={{ width: 52, height: 52, borderRadius: 12 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{a.title}</Txt>
        <Txt variant="small" numberOfLines={1} style={{ fontSize: 12, lineHeight: 16 }}>{clock(a.startsAt)} · {place(a.venueName)}</Txt>
        <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
          {a.status === 'in_progress' ? <Text style={{ color: c.green, fontWeight: '800' }}>Happening now · </Text> : null}
          {a.going} of {a.capacity} going · {cat?.label ?? a.category}
        </Txt>
        {circleLine(a.buddiesGoing, a.followingGoing) ? <Txt variant="small" numberOfLines={1} bold color={c.green} style={{ fontSize: 11, lineHeight: 15 }}>{circleLine(a.buddiesGoing, a.followingGoing)}</Txt> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.muted} />
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
export function ActivityCard({ a, onPress, plain }: { a: Activity; onPress?: () => void; /** no "Completed"/"Cancelled" mark (the row already says "Rejected") */ plain?: boolean }) {
  const go = useGo();
  const { c } = useTheme();
  const cat = CATS[a.category];
  const full = a.spotsLeft === 0;
  // once the time has passed (or the host called it off) the card is greyed and says how it ended
  const live = !plain && a.status === 'in_progress';
  const ended = plain ? null : a.status === 'cancelled' ? { text: 'Cancelled', color: c.danger } : a.status === 'completed' || a.status === 'archived' ? { text: 'Completed', color: c.green } : null;
  return (
    <Card
      onPress={onPress ?? (() => go(`/activity/${a.id}`))}
      accessibilityLabel={`${a.title}, ${ended ? `${ended.text}, ` : ''}${when(a.startsAt)}, ${a.venueName}, ${a.spotsLeft} spots left${onPress ? '. Show on the map' : ''}`}
      style={{ flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 12, padding: 8 }}
    >
      <CatPhoto category={a.category} style={{ width: 42, height: 42, borderRadius: 10, opacity: ended ? 0.4 : 1 }} />
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ opacity: ended ? 0.5 : 1, gap: 1 }}>
          <Txt variant="h3" numberOfLines={1} style={{ fontSize: 13, lineHeight: 17 }}>{a.title}</Txt>
          <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
            {clock(a.startsAt)} · {a.venueName}
            {a.distanceKm !== undefined ? ` · ${a.distanceKm} km` : ''}
          </Txt>
          <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
            {a.going} going · {full ? 'Full' : `${a.spotsLeft} ${a.spotsLeft === 1 ? 'spot' : 'spots'} left`} · {cat?.label ?? a.category}
          </Txt>
          {circleLine(a.buddiesGoing, a.followingGoing) ? <Txt variant="small" numberOfLines={1} bold color={c.green} style={{ fontSize: 11, lineHeight: 15 }}>{circleLine(a.buddiesGoing, a.followingGoing)}</Txt> : null}
        </View>
        {ended ? <Txt variant="small" bold color={ended.color} style={{ fontSize: 11, lineHeight: 15 }}>{ended.text}</Txt> : null}
        {live ? <Txt variant="small" bold color={c.green} style={{ fontSize: 11, lineHeight: 15 }}>Happening now</Txt> : null}
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
    <Card onPress={() => go(`/trip/${t.id}`)} accessibilityLabel={`${t.title}, ${dateSpan(t.dateStart, t.dateEnd)}, estimated ${money(t.budget.min, t.budget.currency)} to ${money(t.budget.max, t.budget.currency)} per person, ${t.members} of ${t.maxCapacity} travelers`} style={{ gap: 6, borderRadius: 20 }}>
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
        {t.dateFlexibility !== 'exact' ? ' (flexible)' : ''}
      </Txt>
      <Text style={{ color: c.text, fontWeight: '700' }}>
        {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} <Text style={{ fontWeight: '400', color: c.muted }}>pp estimate{t.budget.includesTransport ? ', incl. travel' : ', excl. travel'}</Text>
      </Text>
      {t.match?.budgetScopeMismatch ? <Txt variant="small" color={c.warnFg}>Budget covers a different scope than you searched (travel included or not).</Txt> : null}
      <Txt variant="small">{t.members}/{t.maxCapacity} travelers</Txt>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {t.tags.slice(0, 4).map((x) => (
          <Chip key={x} label={x} tone="neutral" />
        ))}
      </Row>
      {circleLine(t.buddiesGoing, t.followingGoing) ? <Txt variant="small" bold color={c.green}>{circleLine(t.buddiesGoing, t.followingGoing)}</Txt> : null}
      <Txt variant="small">Organizer: {t.host.displayName}{t.host.verifiedAdult ? ' ✓' : ''}</Txt>
    </Card>
  );
}

/** "in 5 days", "in 3 weeks", "in 2 months", or "under way" once the trip has begun. */
function tripStartsIn(iso: string) {
  const days = Math.ceil((+new Date(iso) - Date.now()) / 864e5);
  if (days <= 0) return 'under way';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** The trip's stand-in picture (until real photos exist): a soft green tile with a plane. */
function TripThumb({ style, size }: { style: object; size: number }) {
  const { c } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={[{ backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name="airplane" size={size} color={c.forest} />
    </View>
  );
}

/** THERE's version of ActivityRow: a compact row for one trip proposal. */
export function TripRow({ t }: { t: Trip }) {
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  return (
    <Card
      onPress={() => go(`/trip/${t.id}`)}
      accessibilityLabel={`${t.title}, ${dateSpan(t.dateStart, t.dateEnd)}, estimated ${money(t.budget.min, t.budget.currency)} to ${money(t.budget.max, t.budget.currency)} per person, ${t.members} of ${t.maxCapacity} travelers${full ? ', full' : `, ${t.spotsLeft} places open`}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 9, borderRadius: 16 }}
    >
      <TripThumb size={22} style={{ width: 52, height: 52, borderRadius: 12 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="h3" numberOfLines={1} style={{ fontSize: 14, lineHeight: 18 }}>{t.destination}</Txt>
        <Txt variant="small" numberOfLines={1} style={{ fontSize: 12, lineHeight: 16 }}>
          {dateSpan(t.dateStart, t.dateEnd)}
          {t.dateFlexibility !== 'exact' ? ' (flexible)' : ''}
        </Txt>
        <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, lineHeight: 15 }}>
          {t.match?.dates === 'approximate' ? <Text style={{ color: c.warnFg, fontWeight: '800' }}>Approximate dates · </Text> : null}
          {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} · {t.members} of {t.maxCapacity} going
          {full ? <Text style={{ color: c.danger, fontWeight: '800' }}> · Full</Text> : null}
        </Txt>
        {circleLine(t.buddiesGoing, t.followingGoing) ? <Txt variant="small" numberOfLines={1} bold color={c.green} style={{ fontSize: 11, lineHeight: 15 }}>{circleLine(t.buddiesGoing, t.followingGoing)}</Txt> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={c.muted} />
    </Card>
  );
}

/** THERE's version of NextUpCard: the soonest trip that is yours (organising, going or applied to). */
export function TripNextUpCard({ t, status }: { t: Trip; status?: { label: string; tone: 'ok' | 'warn' | 'bad' } }) {
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  return (
    <Card style={{ padding: 0, gap: 0, borderRadius: 20, overflow: 'hidden' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Next up: ${t.destination}, ${dateSpan(t.dateStart, t.dateEnd)}, leaves ${tripStartsIn(t.dateStart)}, ${t.members} of ${t.maxCapacity} travelers`} onPress={() => go(`/trip/${t.id}`)}>
        <View>
          <TripThumb size={44} style={{ height: 120 }} />
          <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: c.surface, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 11 }}>{+new Date(t.dateStart) <= Date.now() ? 'Under way' : `Leaves ${tripStartsIn(t.dateStart)}`}</Text>
          </View>
          {status ? (
            <View style={{ position: 'absolute', right: 10, top: 10 }}>
              <Chip label={status.label} tone={status.tone} />
            </View>
          ) : null}
        </View>
        <View style={{ padding: 12, paddingBottom: 0, gap: 9 }}>
          <Row style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
            <Txt variant="h2" numberOfLines={2} style={{ flex: 1, fontSize: 17, lineHeight: 22 }}>{t.destination}</Txt>
            <Chip label="Trip" tone="ok" />
          </Row>
          <Row style={{ gap: 16, flexWrap: 'wrap' }}>
            <Row style={{ gap: 6 }}>
              <Ionicons name="calendar-outline" size={16} color={c.muted} />
              <Txt variant="muted">{dateSpan(t.dateStart, t.dateEnd)}</Txt>
            </Row>
            <Row style={{ gap: 6, flexShrink: 1 }}>
              <Ionicons name="location-outline" size={16} color={c.muted} />
              <Txt variant="muted" numberOfLines={1} style={{ flexShrink: 1 }}>From {t.originCity}</Txt>
            </Row>
          </Row>
          <Txt variant="small">
            {t.members} of {t.maxCapacity} going ·{' '}
            <Text style={{ color: full ? c.danger : c.text, fontWeight: '700' }}>{full ? 'Full' : `${t.spotsLeft} ${t.spotsLeft === 1 ? 'place' : 'places'} open`}</Text>
          </Txt>
        </View>
      </Pressable>
      <View style={{ padding: 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See details: ${t.destination}`}
          onPress={() => go(`/trip/${t.id}`)}
          style={({ pressed }) => [{ height: 40, borderRadius: 999, borderWidth: 1.5, borderColor: c.forest, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
        >
          <Txt variant="h3" color={c.forest} style={{ fontSize: 13 }}>See details</Txt>
          <Ionicons name="chevron-forward" size={16} color={c.forest} />
        </Pressable>
      </View>
    </Card>
  );
}
