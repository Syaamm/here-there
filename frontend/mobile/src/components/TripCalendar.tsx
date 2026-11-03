import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { reducedMotion, SOFT } from './Pop';
import { Text } from './ScaledText';
import { useT } from '@/lib/i18n';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A calendar day is kept as "YYYY-MM-DD". */
const parts = (key: string) => ({ y: Number(key.slice(0, 4)), m: Number(key.slice(5, 7)) - 1, d: Number(key.slice(8, 10)) });
const monthIndex = (key: string) => parts(key).y * 12 + parts(key).m;

// the frame glides slowly and settles without a bounce
const GLIDE = { damping: 22, stiffness: 95, mass: 1 } as const;
const CELL = 44; // height of a row of days
const RING = 42; // the frame is a ring around the chosen day

/** One day of the grid. The chosen day is marked by the frame that glides over the grid (see TripCalendar), not here. */
function DayButton({ on, base, number, dots, onPress, label, disabled, look, ring }: {
  on: boolean; base: object | null; number: string; dots: number; onPress: () => void; label: string; disabled: boolean;
  look: { dot: string; numberColor: string; weight: '600' | '800' }; ring: object | null;
}) {
  const shape = { width: 36, height: 36, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 2 };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [shape, base, ring, pressed && !on && { opacity: 0.8 }]}
    >
      <Text style={{ color: look.numberColor, fontWeight: look.weight, fontSize: 13 }}>{number}</Text>
      <View style={{ flexDirection: 'row', gap: 2, height: 5 }}>
        {Array.from({ length: dots }, (_, n) => <View key={n} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: look.dot }} />)}
      </View>
    </Pressable>
  );
}

/**
 * The trip as a month calendar. The days of the trip are open to tap, other days are faded; a dot (or a count) marks a day
 * that has something planned, today has a ring, and the chosen day sits in a round frame that glides between days. If the trip crosses into another month, arrows
 * move between the months.
 *
 * `tripDays` are the days of the trip, `planned` says how many stops each day has (days outside the trip may have some too,
 * since a plan may reach a week either side, and they stay tappable), `selected` is the chosen day.
 */
export function TripCalendar({ tripDays, planned, selected, today, onSelect, dayNumber }: { tripDays: string[]; planned: Map<string, number>; selected: string; today: string; onSelect: (key: string) => void; /** "Day 3" for a day of the trip */ dayNumber: (key: string) => string }) {
  const { c } = useTheme();
  const { t, tn } = useT();
  const inTrip = new Set(tripDays);
  const known = [...new Set([...tripDays, ...planned.keys()])].sort();
  const first = monthIndex(known[0] ?? selected);
  const last = monthIndex(known[known.length - 1] ?? selected);
  const [month, setMonth] = useState(monthIndex(selected));
  // when another day is chosen from outside the month on show, the calendar follows it
  useEffect(() => {
    const m = monthIndex(selected);
    setMonth((cur) => (m < first || m > last ? cur : m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const shown = Math.min(Math.max(month, first), last);
  // changing month slides the grid in from the side it came from, springing into place
  const slide = useRef(new Animated.Value(1)).current;
  const dir = useRef<-1 | 1>(1);
  const seen = useRef(shown);
  useEffect(() => {
    if (seen.current === shown) return;
    dir.current = shown > seen.current ? 1 : -1;
    seen.current = shown;
    if (reducedMotion()) return;
    slide.setValue(0);
    Animated.spring(slide, { toValue: 1, ...SOFT, useNativeDriver: true }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const y = Math.floor(shown / 12);
  const m = shown % 12;

  // Monday first, blanks before the 1st
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const count = new Date(y, m + 1, 0).getDate();
  const keyOf = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const arrow = (dir: -1 | 1, label: string, ok: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ok }} disabled={!ok} hitSlop={8} onPress={() => setMonth(shown + dir)} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft, opacity: ok ? 1 : 0.3 }}>
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={16} color={c.forest} />
    </Pressable>
  );

  // The chosen day is a soft green frame that glides over the grid from day to day, and stays put while the calendar
  // changes under it. Where it belongs: the cell of the chosen day (if that day is in the month on show).
  const [gridW, setGridW] = useState(0);
  const selDay = monthIndex(selected) === shown ? parts(selected).d : null;
  const cw = gridW / 7;
  const ring = Math.min(cw - 2, RING); // a circle, so as wide as it is tall
  const target = selDay && gridW ? { x: ((lead + selDay - 1) % 7) * cw + (cw - ring) / 2, y: Math.floor((lead + selDay - 1) / 7) * CELL + (CELL - ring) / 2 } : null;
  const fx = useRef(new Animated.Value(0)).current;
  const fy = useRef(new Animated.Value(0)).current;
  const seeFrame = useRef(new Animated.Value(0)).current;
  const placedIn = useRef<number | null>(null); // the month the frame is showing in (null: hidden)
  useEffect(() => {
    if (!target) {
      if (placedIn.current !== null) {
        placedIn.current = null;
        Animated.timing(seeFrame, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      }
      return;
    }
    if (placedIn.current === shown) {
      // same month: glide to the new day
      if (reducedMotion()) {
        fx.setValue(target.x);
        fy.setValue(target.y);
      } else {
        Animated.parallel([
          Animated.spring(fx, { toValue: target.x, ...GLIDE, useNativeDriver: true }),
          Animated.spring(fy, { toValue: target.y, ...GLIDE, useNativeDriver: true }),
        ]).start();
      }
    } else {
      // first showing, or a different month: it is simply there (the grid slides in around it)
      fx.setValue(target.x);
      fy.setValue(target.y);
      placedIn.current = shown;
      Animated.timing(seeFrame, { toValue: 1, duration: reducedMotion() ? 0 : 240, useNativeDriver: true }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.x, target?.y, shown]);

  const plannedDays = tripDays.filter((k) => planned.has(k)).length;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        {first === last ? <View style={{ width: 32 }} /> : arrow(-1, t('Previous month'), shown > first)}
        <View style={{ alignItems: 'center' }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{t(MONTHS[m])} {y}</Text>
          <Text style={{ color: c.muted, fontSize: 11 }}>{tn(tripDays.length, '{planned} of {n} day planned', '{planned} of {n} days planned').split('{planned}').join(String(plannedDays))}</Text>
        </View>
        {first === last ? <View style={{ width: 32 }} /> : arrow(1, t('Next month'), shown < last)}
      </View>

      <Animated.View style={{ opacity: slide.interpolate({ inputRange: [0, 0.6], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [dir.current * 36, 0] }) }, { scale: slide.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }}>
        <View style={{ flexDirection: 'row' }}>
          {WEEK.map((w) => (
            <View key={w} style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}>
              <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>{t(w)}</Text>
            </View>
          ))}
        </View>
        <View onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
        {Array.from({ length: cells.length / 7 }, (_, row) => (
          <View key={row} style={{ flexDirection: 'row' }}>
            {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
              if (d === null) return <View key={i} style={{ flex: 1, height: 44 }} />;
              const k = keyOf(d);
              const stops = planned.get(k) ?? 0;
              const trip = inTrip.has(k);
              const open = trip || stops > 0; // days outside the trip are only tappable when they already have plans
              const on = k === selected;
              const label = `${t(WEEKDAYS[new Date(y, m, d).getDay()])} ${d} ${t(MONTHS[m])}${trip ? `, ${dayNumber(k)}` : `, ${t('outside the trip dates')}`}, ${stops ? tn(stops, '{n} stop planned', '{n} stops planned') : t('nothing planned')}${k === today ? `, ${t('today')}` : ''}`;
              return (
                <View key={i} style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <DayButton
                    on={on}
                    label={label}
                    disabled={!open}
                    onPress={() => onSelect(k)}
                    number={String(d)}
                    dots={Math.min(stops, 3)}
                    base={trip ? { backgroundColor: c.accentSoft } : null}
                    ring={k === today && !on ? { borderWidth: 1.5, borderColor: c.green } : null}
                    look={{ dot: c.green, numberColor: on ? c.forest : open ? c.text : c.line, weight: on || trip ? '800' : '600' }}
                  />
                </View>
              );
            })}
          </View>
        ))}
        {gridW ? (
          <Animated.View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={{ position: 'absolute', left: 0, top: 0, width: ring, height: ring, borderRadius: ring / 2, borderWidth: 1.5, borderColor: `${c.green}AA`, backgroundColor: `${c.green}1A`, opacity: seeFrame, transform: [{ translateX: fx }, { translateY: fy }] }}
          />
        ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
