import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './ScaledText';
import type { Activity, Trip } from '@/lib/api';
import { catColor, CATS } from '@/lib/constants';
import { circleLine, dateSpan, money, timeText, when } from '@/lib/format';
import { localeTag, t as tr, tn as trn, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { CatPhoto } from './CatPhoto';
import { sc } from '@/lib/scale';
import { FS, LH, type } from '@/lib/type';
import { Avatar, Btn, Card, Chip, Row, Txt, useGo } from './ui';
import { tripFrom } from '@/lib/travelStyle';
import { TravelStyleBadge } from './TravelStyleBadge';
import { SampleTag } from './SampleTag';

/** Android adds invisible space above and below text; off, text sits centred in pills and badges like on iPhone. */
const FLAT = { includeFontPadding: false } as const;

const clock = (iso: string) => timeText(iso); // the app's one time format (lib/format)
/** The category's name for display; the server's own value stays untouched. */
const catLabel = (category: string) => tr(CATS[category]?.label ?? category);
/** "Title, when, venue, 3 of 6 going, 2 spots left" for screen readers (the words differ only at the end). */
const goingLine = (a: Activity) =>
  tr('{title}, {when}, {venue}, {going} of {capacity} going', { title: a.title, when: when(a.startsAt), venue: a.venueName, going: a.going, capacity: a.capacity }) +
  (a.spotsLeft === 0 ? tr(', full') : trn(a.spotsLeft, ', {n} spot left', ', {n} spots left'));
/** The trip's facts for screen readers. */
const tripLine = (t: Trip) => tr('{title}, {dates}, estimated {min} to {max} per person, {members} of {capacity} travelers', { title: t.title, dates: dateSpan(t.dateStart, t.dateEnd), min: money(t.budget.min, t.budget.currency), max: money(t.budget.max, t.budget.currency), members: t.members, capacity: t.maxCapacity });
/** "Brera" out of "Bar in Brera (Brera)" style venue names; falls back to the whole venue. */
const place = (venue: string) => /\(([^)]+)\)\s*$/.exec(venue)?.[1] ?? venue;

/** Dark pill laid over the coloured top of a card: "19:30 · Brera". */
function Pill({ text }: { text: string }) {
  const { c } = useTheme();
  return (
    <View style={{ position: 'absolute', left: 8, bottom: 8, backgroundColor: c.forest, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, maxWidth: '90%' }}>
      <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700', fontSize: 10.5, lineHeight: 14, ...FLAT }}>
        {text}
      </Text>
    </View>
  );
}

/** Big card for the "Happening soon" strip. */
function FeatureCardBase({ a, width }: { a: Activity; width?: number }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = a.spotsLeft === 0;
  return (
    <Card
      onPress={() => go(`/activity/${a.id}`)}
      accessibilityLabel={goingLine(a)}
      style={{ width, padding: 0, gap: 0, borderRadius: 14, overflow: 'hidden' }}
    >
      <CatPhoto category={a.category} style={{ height: sc(64) }} />
      <View style={{ padding: 9, gap: 4 }}>
        {/* two lines of height reserved, so cards side by side stay level */}
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 12.5, lineHeight: 16, minHeight: 32 }}>{a.title}</Txt>
        <Txt variant="small" numberOfLines={1} color={c.forest} bold style={{ fontSize: 11, lineHeight: 15 }}>{clock(a.startsAt)} · {place(a.venueName)}</Txt>
        <Row style={{ justifyContent: 'space-between', gap: 4 }}>
          <Txt variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>{tr('{going} of {capacity} going', { going: a.going, capacity: a.capacity })}</Txt>
          {full ? <Chip label={tr('Full')} tone="warn" /> : <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 10, lineHeight: 14, ...FLAT }}>{catLabel(a.category)}</Text></View>}
        </Row>
      </View>
    </Card>
  );
}

/** "in 45 min" / "in 1 h 20 min" / "in 3 h" */
function startsIn(iso: string) {
  const min = Math.max(1, Math.round((+new Date(iso) - Date.now()) / 60000));
  if (min < 60) return tr('in {n} min', { n: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? tr('in {h} h {m} min', { h, m }) : tr('in {h} h', { h });
}


/**
 * Who is going, at a glance: the real faces of the people going (the host first, then in the order they joined; the server
 * sends the first three in `faces`), then a dark "+n" circle when more are going. If a face is missing (an older answer from
 * the server) the host's own face and a plain person circle stand in.
 */
function Faces({ a, size = 29 }: { a: Activity; size?: number }) {
  const { c } = useTheme();
  const people = Math.min(Math.max(1, a.going), 3);
  const extra = a.going - people;
  const faces = Array.from({ length: people }, (_, i) => a.faces?.[i] ?? (i === 0 ? { id: a.host.id, displayName: a.host.displayName, photoUrl: a.host.photoUrl } : null));
  const ring = { borderRadius: 999, borderWidth: 1.5, borderColor: c.surface };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', alignItems: 'center' }}>
      {faces.map((f, i) =>
        f ? (
          <View key={f.id} style={[ring, { marginLeft: i === 0 ? 0 : -7 }]}>
            <Avatar name={f.displayName} uri={f.photoUrl} size={size} />
          </View>
        ) : (
          <View key={`p${i}`} style={[ring, { marginLeft: -7, width: sc(size + 3), height: sc(size + 3), backgroundColor: c.line, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="person" size={15} color={c.muted} />
          </View>
        ),
      )}
      {extra > 0 ? (
        <View style={[ring, { marginLeft: -7, width: sc(size + 3), height: sc(size + 3), backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#fff', fontSize: 11.5, lineHeight: 16, fontWeight: '600', textAlign: 'center', ...FLAT }}>{extra > 99 ? '99+' : `+${extra}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Green for "N spots left": a shade darker than the drawing's, so the small text stays readable on white. */
const SPOTS_GREEN = '#2E7D32';

/**
 * The big activity card of HERE's Home (Figma "HOME"): a rounded photo with a small tag on it, the title and the spots left,
 * the time and place, who is going, and a See details button. `tag` is the small label on the photo; `status` is your part
 * in it ("You host this"), shown at the photo's right.
 */
export function ActivityBigCard({ a, tag, status: given, accessibilityLabel }: { a: Activity; tag?: string; status?: { label: string; tone: 'ok' | 'warn' | 'bad' }; accessibilityLabel?: string }) {
  useT();
  const status = given ?? mineStatus(a);
  const go = useGo();
  const { c } = useTheme();
  const full = a.spotsLeft === 0;
  const open = () => go(`/activity/${a.id}`);
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: sc(30), borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: sc(13), gap: sc(12) }}>
      {/* the picture and the facts open the activity; the button below is its own control (a button cannot sit inside another) */}
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? goingLine(a)} onPress={open} style={{ gap: sc(12) }}>
        <CatPhoto category={a.category} style={{ height: sc(145), borderRadius: sc(24) }}>
          {tag ? (
            <View style={{ position: 'absolute', left: sc(14), top: sc(14), backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', borderRadius: 999, paddingHorizontal: sc(11), paddingVertical: sc(4) }}>
              <Text style={{ color: '#fff', fontSize: 11.5, lineHeight: 16, fontWeight: '500', ...FLAT }}>{tag}</Text>
            </View>
          ) : null}
          {status ? (
            <View style={{ position: 'absolute', right: 12, top: 12 }}>
              <Chip label={status.label} tone={status.tone} />
            </View>
          ) : null}
          {a.host?.sample ? (
            <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
              <SampleTag onPhoto />
            </View>
          ) : null}
        </CatPhoto>
        <View style={{ paddingHorizontal: 8, gap: 10 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <Txt variant="h2" numberOfLines={2} style={[type.cardTitle, { flex: 1 }]}>{a.title}</Txt>
            <Text style={{ color: full ? c.danger : SPOTS_GREEN, fontSize: FS.caption, lineHeight: LH.caption, fontWeight: '500', ...FLAT }}>{full ? tr('Full') : trn(a.spotsLeft, '{n} spot left', '{n} spots left')}</Text>
          </Row>
          <Row style={{ gap: 5 }}>
            <Ionicons name="location-outline" size={16} color={c.muted} />
            <Txt variant="muted" numberOfLines={1} style={[type.button, { flex: 1, fontWeight: '400' }]}>{clock(a.startsAt)} · {place(a.venueName)}</Txt>
          </Row>
          <Row style={{ gap: 10 }}>
            <Faces a={a} />
            <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>{tr('{going} of {capacity} going', { going: a.going, capacity: a.capacity })}</Txt>
          </Row>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('See details: {title}', { title: a.title })}
        onPress={open}
        hitSlop={{ top: 2, bottom: 2 }}
        style={({ pressed }) => [{ height: sc(42), borderRadius: sc(21), borderWidth: 1, borderColor: 'rgba(0,0,0,0.16)', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
      >
        <Txt variant="h3" color={c.text} style={type.button}>{tr('See details')}</Txt>
      </Pressable>
    </View>
  );
}

/** The one activity that starts next: the big card with a "Starts in" tag on the photo. */
export function NextUpCard({ a, status }: { a: Activity; /** your part in it: "You host this", "Going", "Request pending" */ status?: { label: string; tone: 'ok' | 'warn' | 'bad' } }) {
  useT();
  return (
    <ActivityBigCard
      a={a}
      status={status}
      tag={+new Date(a.startsAt) <= Date.now() ? tr('Happening now') : tr('Starts {time}', { time: startsIn(a.startsAt) })}
      accessibilityLabel={tr('Next up: {title}, {when}, starts {time}, {venue}, {going} of {capacity} going', { title: a.title, when: when(a.startsAt), time: startsIn(a.startsAt), venue: a.venueName, going: a.going, capacity: a.capacity })}
    />
  );
}

/** HERE's compact row card for one activity (same style as TripRow): its picture, title, time and place, the spots left, and who is going. */
function ActivityRowBase({ a }: { a: Activity }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = a.spotsLeft === 0;
  const circle = circleLine(a.buddiesGoing, a.followingGoing);
  const mine = mineStatus(a);
  const live = a.status === 'in_progress';
  // one layout for every row card (activities and trips): picture on the left; title with the places left at its right end, the
  // time and place, small tags; and along the bottom the faces, how many are going, and your friends at the right
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => go(`/activity/${a.id}`)}
      accessibilityLabel={goingLine(a)}
      style={({ pressed }) => [{ backgroundColor: c.surface, borderRadius: sc(20), borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: sc(10), gap: sc(8), minHeight: 44 }, pressed && { opacity: 0.92 }]}
    >
      <Row style={{ gap: sc(12), alignItems: 'flex-start' }}>
        <CatPhoto category={a.category} style={{ width: sc(56), height: sc(56), borderRadius: sc(14) }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <Txt variant="h3" numberOfLines={2} style={{ flex: 1, fontSize: FS.body, lineHeight: LH.body, fontWeight: '600' }}>{a.title}</Txt>
            <Text style={{ color: full ? c.danger : SPOTS_GREEN, fontSize: FS.caption, lineHeight: LH.body, fontWeight: '600', ...FLAT }}>{full ? tr('Full') : trn(a.spotsLeft, '{n} spot left', '{n} spots left')}</Text>
          </Row>
          <Row style={{ gap: 4 }}>
            <Ionicons name="location-outline" size={14} color={c.muted} />
            <Txt variant="muted" numberOfLines={1} style={{ flex: 1, fontSize: 13, lineHeight: 17 }}>{clock(a.startsAt)} · {place(a.venueName)}</Txt>
          </Row>
          {mine || live || a.host?.sample ? (
            <Row style={{ gap: 6, flexWrap: 'wrap' }}>
              {live ? <Chip label={tr('Happening now')} tone="ok" /> : null}
              {mine ? <Chip label={mine.label} tone={mine.tone} /> : null}
              {a.host?.sample ? <SampleTag /> : null}
            </Row>
          ) : null}
        </View>
      </Row>
      <Row style={{ gap: 10 }}>
        <Faces a={a} size={22} />
        <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
          {tr('{going} of {capacity} going', { going: a.going, capacity: a.capacity })}
          {circle ? <Text style={{ color: c.green, fontWeight: '600' }}>{` · ${circle}`}</Text> : null}
        </Txt>
      </Row>
    </Pressable>
  );
}

/** The end of a sideways row: just a round arrow, centred against the card before it. Opens the full list. */
export function ShowMoreCard({ width = 56, onPress, label = 'Show more' }: { width?: number; onPress: () => void; label?: string }) {
  useT();
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={tr('{label}: see every activity', { label: tr(label) })} hitSlop={6} onPress={onPress} style={({ pressed }) => [{ width, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.8, transform: [{ scale: 0.95 }] }]}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-forward" size={20} color="#fff" />
      </View>
    </Pressable>
  );
}

/** Compact row card for "More around you" and lists: coloured thumbnail, title, time and place, who's going. */
function ActivityCardBase({ a, onPress, plain }: { a: Activity; onPress?: () => void; /** no "Completed"/"Cancelled" mark (the row already says "Rejected") */ plain?: boolean }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = a.spotsLeft === 0;
  // once the time has passed (or the host called it off) the card is greyed and says how it ended
  const live = !plain && a.status === 'in_progress';
  const ended = plain ? null : a.status === 'cancelled' ? { text: tr('Cancelled'), color: c.danger } : a.status === 'completed' || a.status === 'archived' ? { text: tr('Completed'), color: c.green } : null;
  return (
    <Card
      onPress={onPress ?? (() => go(`/activity/${a.id}`))}
      accessibilityLabel={`${a.title}, ${ended ? `${ended.text}, ` : ''}${when(a.startsAt)}, ${a.venueName}, ${trn(a.spotsLeft, '{n} spot left', '{n} spots left')}${onPress ? tr('. Show on the map') : ''}`}
      style={{ flexDirection: 'row', gap: sc(14), alignItems: 'center', borderRadius: sc(20), padding: sc(12) }}
    >
      <CatPhoto category={a.category} style={{ width: sc(60), height: sc(60), borderRadius: sc(14), opacity: ended ? 0.4 : 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ opacity: ended ? 0.5 : 1, gap: 4 }}>
          <Txt variant="h3" numberOfLines={1} style={[type.body, { fontWeight: '600' }]}>{a.title}</Txt>
          <Txt variant="small" numberOfLines={1} style={[type.button, { fontWeight: '400' }]}>
            {clock(a.startsAt)} · {a.venueName}
            {a.distanceKm !== undefined ? ` · ${a.distanceKm} km` : ''}
          </Txt>
          <Txt variant="small" numberOfLines={1} style={[type.button, { fontWeight: '400' }]}>
            {tr('{n} going', { n: a.going })} · {full ? tr('Full') : trn(a.spotsLeft, '{n} spot left', '{n} spots left')} · {catLabel(a.category)}
          </Txt>
          {circleLine(a.buddiesGoing, a.followingGoing) ? <Txt variant="small" numberOfLines={1} bold color={c.green} style={type.button}>{circleLine(a.buddiesGoing, a.followingGoing)}</Txt> : null}
        </View>
        {ended ? <Txt variant="small" bold color={ended.color} style={type.button}>{ended.text}</Txt> : null}
        {live ? <Txt variant="small" bold color={c.green} style={type.button}>{tr('Happening now')}</Txt> : null}
      </View>
    </Card>
  );
}

const tripColor = (t: Trip) => catColor(t.tags.includes('culture') ? 'culture' : t.tags.includes('food') ? 'food' : t.tags.some((x) => ['adventure', 'hiking', 'nature'].includes(x)) ? 'sports' : 'drinks');

/** Big card for THERE's "Featured trips" strip, in the same style as the HERE feature card. */
function TripFeatureCardBase({ t, width }: { t: Trip; width?: number }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  return (
    <Card
      onPress={() => go(`/trip/${t.id}`)}
      accessibilityLabel={tripLine(t)}
      style={{ width, padding: 0, gap: 0, borderRadius: 16, overflow: 'hidden' }}
    >
      <View style={{ height: 84, backgroundColor: tripColor(t), alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 32, opacity: 0.5 }} accessibilityElementsHidden>✈️</Text>
        <Pill text={`${dateSpan(t.dateStart, t.dateEnd).replace(/ \d{4}$/, '')}${t.dateFlexibility !== 'exact' ? tr(' · flexible') : ''}`} />
      </View>
      <View style={{ padding: 11, gap: 6 }}>
        <Txt variant="h3" numberOfLines={2} style={{ fontSize: 14, lineHeight: 19 }}>{t.destination}</Txt>
        <Txt variant="muted" numberOfLines={1}>
          {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} {t.budget.includesTransport ? tr('pp incl. travel') : tr('pp excl. travel')}
        </Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt variant="muted">{tr('{members} of {capacity} travelers', { members: t.members, capacity: t.maxCapacity })}</Txt>
          {full ? <Chip label={tr('Full')} tone="warn" /> : <View style={{ backgroundColor: c.accentSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 11, lineHeight: 15, ...FLAT }}>{tr('{n} open', { n: t.spotsLeft })}</Text></View>}
        </Row>
      </View>
    </Card>
  );
}

function TripCardBase({ t }: { t: Trip }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  return (
    <Card onPress={() => go(`/trip/${t.id}`)} accessibilityLabel={tripLine(t)} style={{ gap: 6, borderRadius: 20 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: 6, flexWrap: 'wrap', flex: 1 }}>
          <Chip label={tr('✈ Trip proposal')} tone="neutral" />
          <TravelStyleBadge trip={t} small />
          {t.host?.sample ? <SampleTag /> : null}
        </Row>
        {t.match ? (
          t.match.dates === 'exact' ? <Chip label={tr('Exact dates')} tone="ok" /> : t.match.dates === 'approximate' ? <Chip label={tr('Approximate dates')} tone="warn" /> : null
        ) : full ? (
          <Chip label={tr('Full')} tone="warn" />
        ) : null}
      </Row>
      <Txt variant="h3">{t.destination}</Txt>
      <Txt variant="small">
        {dateSpan(t.dateStart, t.dateEnd)}
        {t.dateFlexibility !== 'exact' ? tr(' (flexible)') : ''}
        {` · ${tripFrom(t)}`}
      </Txt>
      <Text style={{ color: c.text, fontWeight: '700' }}>
        {money(t.budget.min, t.budget.currency)}–{money(t.budget.max, t.budget.currency)} <Text style={{ fontWeight: '400', color: c.muted }}>{t.budget.includesTransport ? tr('pp estimate, incl. travel') : tr('pp estimate, excl. travel')}</Text>
      </Text>
      {t.match?.budgetScopeMismatch ? <Txt variant="small" color={c.warnFg}>{tr('Budget covers a different scope than you searched (travel included or not).')}</Txt> : null}
      <Txt variant="small">{tr('{members}/{capacity} travelers', { members: t.members, capacity: t.maxCapacity })}</Txt>
      <Row style={{ flexWrap: 'wrap', gap: 6 }}>
        {t.tags.slice(0, 4).map((x) => (
          <Chip key={x} label={tr(x)} tone="neutral" />
        ))}
      </Row>
      {circleLine(t.buddiesGoing, t.followingGoing) ? <Txt variant="small" bold color={c.green}>{circleLine(t.buddiesGoing, t.followingGoing)}</Txt> : null}
      <Txt variant="small">{tr('Organizer: {name}', { name: t.host.displayName })}{t.host.verifiedAdult ? ' ✓' : ''}</Txt>
    </Card>
  );
}

/**
 * A trip in the same compact card as ActivityCard (a small picture, the destination, when and from where, how many are going and
 * the places left): for lists of your own trips, so they look like your activities.
 */
function TripCompactCardBase({ t }: { t: Trip }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  const ended = t.status === 'cancelled' ? { text: tr('Cancelled'), color: c.danger } : t.status === 'completed' ? { text: tr('Completed'), color: c.green } : null;
  const circle = circleLine(t.buddiesGoing, t.followingGoing);
  return (
    <Card
      onPress={() => go(`/trip/${t.id}`)}
      accessibilityLabel={`${t.destination}, ${ended ? `${ended.text}, ` : ''}${dateSpan(t.dateStart, t.dateEnd)}, ${tr('{members} of {capacity} going', { members: t.members, capacity: t.maxCapacity })}, ${full ? tr('Full') : trn(t.spotsLeft, '{n} spot left', '{n} spots left')}`}
      style={{ flexDirection: 'row', gap: sc(14), alignItems: 'center', borderRadius: sc(20), padding: sc(12) }}
    >
      <TripThumb t={t} size={26} style={{ width: sc(60), height: sc(60), borderRadius: sc(14), opacity: ended ? 0.4 : 1 }} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ opacity: ended ? 0.5 : 1, gap: 4 }}>
          <Txt variant="h3" numberOfLines={1} style={[type.body, { fontWeight: '600' }]}>{t.destination}</Txt>
          <Txt variant="small" numberOfLines={1} style={[type.button, { fontWeight: '400' }]}>{tripWhen(t)}</Txt>
          <Txt variant="small" numberOfLines={1} style={[type.button, { fontWeight: '400' }]}>
            {tr('{n} going', { n: t.members })} · {full ? tr('Full') : trn(t.spotsLeft, '{n} spot left', '{n} spots left')}
          </Txt>
          {circle ? <Txt variant="small" numberOfLines={1} bold color={c.green} style={type.button}>{circle}</Txt> : null}
        </View>
        {ended ? <Txt variant="small" bold color={ended.color} style={type.button}>{ended.text}</Txt> : null}
      </View>
    </Card>
  );
}

/** "in 5 days", "in 3 weeks", "in 2 months", or "under way" once the trip has begun. */
function tripStartsIn(iso: string) {
  const days = Math.ceil((+new Date(iso) - Date.now()) / 864e5);
  if (days <= 0) return tr('under way');
  if (days === 1) return tr('tomorrow');
  if (days < 14) return tr('in {n} days', { n: days });
  if (days < 60) return tr('in {n} weeks', { n: Math.round(days / 7) });
  return tr('in {n} months', { n: Math.round(days / 30) });
}

/**
 * The trips have no photos of their own yet, so a trip shows the picture of its travel style (adventure, nature, beach,
 * photography), as the category chips do. A trip with none of those styles gets a soft sand tile with a plane. The style
 * is always also named in text.
 */
export const TRIP_PHOTOS: Record<string, number> = {
  adventure: require('../../assets/there/adventure.webp'),
  nature: require('../../assets/there/nature.webp'),
  beach: require('../../assets/there/beach.webp'),
  photography: require('../../assets/there/photography.webp'),
};
/** The travel style whose picture the trip shows (the first of its tags that has one). */
export const tripStyle = (t: Trip) => t.tags.find((x) => TRIP_PHOTOS[x]) ?? null;

export function TripThumb({ t, style, size, children }: { t: Trip; style: object; size: number; children?: React.ReactNode }) {
  const { c } = useTheme();
  const st = tripStyle(t);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={[{ backgroundColor: c.sand, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, style]}>
      {st ? <Image source={TRIP_PHOTOS[st]} contentFit="cover" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} /> : <Ionicons name="airplane" size={size} color={c.forest} />}
      {children}
    </View>
  );
}

/** Who is going: the organiser's face, then a dark "+n" circle for the others (the server sends no other faces for trips). */
function TripFaces({ t, size = 29 }: { t: Trip; size?: number }) {
  const { c } = useTheme();
  const extra = Math.max(0, t.members - 1);
  const ring = { borderRadius: 999, borderWidth: 1.5, borderColor: c.surface };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={ring}>
        <Avatar name={t.host.displayName} uri={t.host.photoUrl} size={size} />
      </View>
      {extra > 0 ? (
        <View style={[ring, { marginLeft: -7, width: sc(size + 3), height: sc(size + 3), backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#fff', fontSize: 11.5, lineHeight: 16, fontWeight: '600', textAlign: 'center', ...FLAT }}>{extra > 99 ? '99+' : `+${extra}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** "12 Mar - 20 Mar · From Milan": when and from where, for the line under a trip's name. */
const tripWhen = (t: Trip) => `${dateSpan(t.dateStart, t.dateEnd)}${t.dateFlexibility !== 'exact' ? tr(' (flexible)') : ''} · ${tripFrom(t)}`;

/**
 * The big trip card of THERE's Home (Figma): a rounded picture with a small tag on it, the destination and the places left,
 * when and from where, who is going, and a See details button. `tag` is the small label on the picture; `status` is your part
 * in the trip ("You organise this"), shown at the picture's right.
 */
export function TripBigCard({ t, tag, status, accessibilityLabel }: { t: Trip; tag?: string; status?: { label: string; tone: 'ok' | 'warn' | 'bad' }; accessibilityLabel?: string }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  const open = () => go(`/trip/${t.id}`);
  const circle = circleLine(t.buddiesGoing, t.followingGoing);
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: sc(30), borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: sc(13), gap: sc(12) }}>
      {/* the picture and the facts open the trip; the button below is its own control (a button cannot sit inside another) */}
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? tripLine(t) + (full ? tr(', full') : trn(t.spotsLeft, ', {n} spot left', ', {n} spots left'))} onPress={open} style={{ gap: sc(12) }}>
        <TripThumb t={t} size={44} style={{ height: sc(145), borderRadius: sc(24) }}>
          {tag ? (
            <View style={{ position: 'absolute', left: sc(14), top: sc(14), backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', borderRadius: 999, paddingHorizontal: sc(11), paddingVertical: sc(4) }}>
              <Text style={{ color: '#fff', fontSize: 11.5, lineHeight: 16, fontWeight: '500', ...FLAT }}>{tag}</Text>
            </View>
          ) : null}
          {status ? (
            <View style={{ position: 'absolute', right: 12, top: 12 }}>
              <Chip label={status.label} tone={status.tone} />
            </View>
          ) : null}
          {/* how the group gets there, at a glance */}
          <View style={{ position: 'absolute', left: 12, bottom: 12 }}>
            <TravelStyleBadge trip={t} onPhoto />
          </View>
          {t.host?.sample ? (
            <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
              <SampleTag onPhoto />
            </View>
          ) : null}
        </TripThumb>
        <View style={{ paddingHorizontal: 8, gap: 10 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <Txt variant="h2" numberOfLines={2} style={[type.cardTitle, { flex: 1 }]}>{t.destination}</Txt>
            <Text style={{ color: full ? c.danger : SPOTS_GREEN, fontSize: FS.caption, lineHeight: LH.caption, fontWeight: '500', ...FLAT }}>{full ? tr('Full') : trn(t.spotsLeft, '{n} spot left', '{n} spots left')}</Text>
          </Row>
          <Row style={{ gap: 5 }}>
            <Ionicons name="location-outline" size={16} color={c.muted} />
            <Txt variant="muted" numberOfLines={1} style={[type.button, { flex: 1, fontWeight: '400' }]}>{tripWhen(t)}</Txt>
          </Row>
          <Row style={{ gap: 10 }}>
            <TripFaces t={t} />
            <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>{tr('{members} of {capacity} going', { members: t.members, capacity: t.maxCapacity })}</Txt>
          </Row>
          {t.match?.dates === 'approximate' ? <Txt variant="small" bold color={c.warnFg}>{tr('Approximate dates')}</Txt> : null}
          {circle ? <Txt variant="small" bold color={c.green}>{circle}</Txt> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('See details: {title}', { title: t.destination })}
        onPress={open}
        hitSlop={{ top: 2, bottom: 2 }}
        style={({ pressed }) => [{ height: sc(42), borderRadius: sc(21), borderWidth: 1, borderColor: 'rgba(0,0,0,0.16)', backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
      >
        <Txt variant="h3" color={c.text} style={type.button}>{tr('See details')}</Txt>
      </Pressable>
    </View>
  );
}

/** THERE's compact row card for one trip (Figma): its picture, the destination, when and from where, the places left, and who is going. */
function TripRowBase({ t }: { t: Trip }) {
  useT();
  const go = useGo();
  const { c } = useTheme();
  const full = t.spotsLeft === 0 || t.status === 'full';
  const circle = circleLine(t.buddiesGoing, t.followingGoing);
  // the same layout as the activity row (ActivityRowBase)
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => go(`/trip/${t.id}`)}
      accessibilityLabel={tripLine(t) + (full ? tr(', full') : trn(t.spotsLeft, ', {n} spot left', ', {n} spots left'))}
      style={({ pressed }) => [{ backgroundColor: c.surface, borderRadius: sc(20), borderWidth: 1, borderColor: 'rgba(0,0,0,0.07)', padding: sc(10), gap: sc(8), minHeight: 44 }, pressed && { opacity: 0.92 }]}
    >
      <Row style={{ gap: sc(12), alignItems: 'flex-start' }}>
        <TripThumb t={t} size={26} style={{ width: sc(56), height: sc(56), borderRadius: sc(14) }} />
        <View style={{ flex: 1, gap: 4 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <Txt variant="h3" numberOfLines={2} style={{ flex: 1, fontSize: FS.body, lineHeight: LH.body, fontWeight: '600' }}>{t.destination}</Txt>
            <Text style={{ color: full ? c.danger : SPOTS_GREEN, fontSize: FS.caption, lineHeight: LH.body, fontWeight: '600', ...FLAT }}>{full ? tr('Full') : trn(t.spotsLeft, '{n} spot left', '{n} spots left')}</Text>
          </Row>
          <Row style={{ gap: 4 }}>
            <Ionicons name="location-outline" size={14} color={c.muted} />
            <Txt variant="muted" numberOfLines={1} style={{ flex: 1, fontSize: 13, lineHeight: 17 }}>{tripWhen(t)}</Txt>
          </Row>
          <Row style={{ gap: 6, flexWrap: 'wrap' }}>
            <TravelStyleBadge trip={t} small />
            {t.host?.sample ? <SampleTag /> : null}
            {t.match?.dates === 'approximate' ? <Chip label={tr('Approximate dates')} tone="warn" /> : null}
          </Row>
        </View>
      </Row>
      <Row style={{ gap: 10 }}>
        <TripFaces t={t} size={22} />
        <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>
          {tr('{members} of {capacity} going', { members: t.members, capacity: t.maxCapacity })}
          {circle ? <Text style={{ color: c.green, fontWeight: '600' }}>{` · ${circle}`}</Text> : null}
        </Txt>
      </Row>
    </Pressable>
  );
}

/** THERE's version of NextUpCard: the soonest trip that is yours (organising, going or applied to), as the big trip card. */
export function TripNextUpCard({ t, status }: { t: Trip; status?: { label: string; tone: 'ok' | 'warn' | 'bad' } }) {
  useT();
  return (
    <TripBigCard
      t={t}
      status={status}
      tag={+new Date(t.dateStart) <= Date.now() ? tr('Under way') : tr('Leaves {time}', { time: tripStartsIn(t.dateStart) })}
      accessibilityLabel={tr('Next up: {destination}, {dates}, leaves {time}, {members} of {capacity} travelers', { destination: t.destination, dates: dateSpan(t.dateStart, t.dateEnd), time: tripStartsIn(t.dateStart), members: t.members, capacity: t.maxCapacity })}
    />
  );
}

/**
 * The cards in lists are redrawn only when what they show changed. A refresh brings back new objects even when nothing is
 * different, so the comparison is by content (functions count only as "there is one"). Cards that show a countdown
 * (Next up) are not in this group: they must redraw as time passes.
 */
/** Your part in an activity, shown on its card so you need not open it: "You're going", "Requested"... (null: none). */
export function mineStatus(a: Pick<Activity, 'mine'>): { label: string; tone: 'ok' | 'warn' } | null {
  switch (a.mine) {
    case 'host':
      return { label: tr('You host this'), tone: 'ok' };
    case 'going':
      return { label: tr("You're going"), tone: 'ok' };
    case 'requested':
      return { label: tr('Request pending'), tone: 'warn' };
    case 'waitlisted':
      return { label: tr('On the waiting list'), tone: 'warn' };
    default:
      return null;
  }
}

function sameCard(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (a === b) continue;
    if (typeof a === 'function' && typeof b === 'function') continue;
    if (typeof a === 'object' && typeof b === 'object' && a && b && JSON.stringify(a) === JSON.stringify(b)) continue;
    return false;
  }
  return true;
}
export const FeatureCard = memo(FeatureCardBase, sameCard);
export const ActivityRow = memo(ActivityRowBase, sameCard);
export const ActivityBig = memo(ActivityBigCard, sameCard);
export const ActivityCard = memo(ActivityCardBase, sameCard);
export const TripFeatureCard = memo(TripFeatureCardBase, sameCard);
export const TripCard = memo(TripCardBase, sameCard);
export const TripCompactCard = memo(TripCompactCardBase, sameCard);
export const TripRow = memo(TripRowBase, sameCard);
export const TripBig = memo(TripBigCard, sameCard);
