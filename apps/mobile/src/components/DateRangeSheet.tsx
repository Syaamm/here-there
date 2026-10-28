import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useDockSpace } from '@/lib/dock';
import { isoDay, parseDay } from '@/lib/format';
import { t as tr, useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';
import { Btn, Txt } from './ui';

const DAY = 864e5;
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const same = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() === b.getTime();
const nights = (a: Date, b: Date) => Math.round((+b - +a) / DAY);

/** "Fri, 20 Nov" */
export const shortDay = (d: Date) => `${tr(WEEKDAYS[d.getDay()]).slice(0, 3)}, ${d.getDate()} ${tr(MONTHS[d.getMonth()]).slice(0, 3)}`;

/** The last day a trip may be planned for: the end of the month that is `months` months after this one. */
export const lastPlanningDay = (months = 6, from = new Date()) => new Date(from.getFullYear(), from.getMonth() + months + 1, 0);

/**
 * A calendar for picking a trip's dates: tap the day you leave, then the day you come back. It slides up from just
 * above the dock (the dock stays usable) and nothing is saved until "Done". Days before `min`, after `max`, and trips
 * longer than `maxNights` cannot be picked. Render it next to the screen, inside a view that fills the tab.
 */
export function DateRangeSheet({
  visible,
  focus,
  start,
  end,
  min,
  max,
  maxNights = 90,
  onClose,
  onDone,
}: {
  visible: boolean;
  /** which tile opened it: the next tap sets the leaving day or the return day */
  focus: 'start' | 'end';
  start: string;
  end: string;
  min: Date;
  /** the last day that can be picked */
  max: Date;
  maxNights?: number;
  onClose: () => void;
  onDone: (start: string, end: string) => void;
}) {
  const { t, tn } = useT();
  const { c } = useTheme();
  const dock = useDockSpace();
  const today = startOfDay(new Date());
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  // which date the next tap sets: the day you leave or the day you come back. It moves on by itself after the leaving
  // day, then stays on the return day (so tapping again just changes the return day); the tabs above switch it.
  const [target, setTarget] = useState<'start' | 'end'>('start');

  // slide up from the dock, fade the page behind; unmounted once it has slid away
  const [mounted, setMounted] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(slide, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(slide, { toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => finished && setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  // the phone's back button closes the calendar first
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // every time it opens: start from what is already chosen
  useEffect(() => {
    if (!visible) return;
    const s = start ? parseDay(start) : null;
    const e = end ? parseDay(end) : null;
    setFrom(s);
    setTo(e);
    setTarget(focus === 'end' && s ? 'end' : 'start');
    const shown = (focus === 'end' && e) || s || min;
    setMonth(new Date(shown.getFullYear(), shown.getMonth(), 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const first = startOfDay(min.getTime() > today.getTime() ? min : today);
  const last = startOfDay(max);
  const choosingEnd = target === 'end' && !!from;
  const limit = choosingEnd ? addDays(from!, maxNights) : null;
  // while choosing the return day, days before the leaving day are out (switch to the Depart tab to move that one)
  const disabled = (d: Date) => d < first || d > last || (!!limit && d > limit) || (choosingEnd && d < from!);

  const pick = (d: Date) => {
    if (choosingEnd) {
      setTo(d); // only the return day changes
    } else {
      setFrom(d);
      if (to && to < d) setTo(null); // a return day before the new leaving day no longer fits
      setTarget('end'); // next: when do you come back
    }
  };

  // the month grid, Monday first, blanks before the 1st
  const lead = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  while (cells.length % 7) cells.push(null);
  const canPrev = new Date(month.getFullYear(), month.getMonth(), 0) >= first;
  const canNext = new Date(month.getFullYear(), month.getMonth() + 1, 1) <= last;
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  const summary = !from ? t('Pick your departure day') : target === 'end' ? (to ? tn(nights(from, to), '{n} night', '{n} nights') : t('Pick your return day')) : t('Pick your departure day');
  if (!mounted) return null;

  const arrow = (dir: -1 | 1, label: string, ok: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !ok }} disabled={!ok} hitSlop={8} onPress={() => step(dir)} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accentSoft, opacity: ok ? 1 : 0.35 }}>
      <Ionicons name={dir < 0 ? 'chevron-back' : 'chevron-forward'} size={16} color={c.forest} />
    </Pressable>
  );

  return (
    // fills the tab above the dock, so the dock itself is never covered
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { bottom: dock, zIndex: 20, justifyContent: 'flex-end' }]}>
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,20,17,0.35)', opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('Close the calendar')} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={{
          alignSelf: 'center',
          width: '100%',
          maxWidth: 520,
          backgroundColor: c.surface,
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderBottomLeftRadius: dock ? 22 : 0,
          borderBottomRightRadius: dock ? 22 : 0,
          paddingHorizontal: 14,
          paddingTop: 12,
          paddingBottom: 12,
          gap: 8,
          elevation: 8,
          shadowColor: '#0B2620',
          shadowOpacity: 0.18,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -3 },
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) }],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {arrow(-1, t('Previous month'), canPrev)}
          <Text accessibilityRole="header" style={{ color: c.text, fontWeight: '800', fontSize: 14 }}>{t(MONTHS[month.getMonth()])} {month.getFullYear()}</Text>
          {arrow(1, t('Next month'), canNext)}
        </View>

        <View>
          <View style={{ flexDirection: 'row' }}>
            {WEEK.map((w) => (
              <View key={w} style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}>
                <Text style={{ color: c.muted, fontSize: 10, fontWeight: '700' }}>{t(w)}</Text>
              </View>
            ))}
          </View>
          {Array.from({ length: cells.length / 7 }, (_, row) => (
            <View key={row} style={{ flexDirection: 'row' }}>
              {cells.slice(row * 7, row * 7 + 7).map((d, i) => {
                if (!d) return <View key={i} style={{ flex: 1, height: 36 }} />;
                const isStart = same(d, from);
                const isEnd = same(d, to);
                const inside = !!from && !!to && d > from && d < to;
                const off = disabled(d);
                const edge = isStart || isEnd;
                return (
                  <View key={i} style={{ flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                    {/* the band behind a chosen range, joined across the days */}
                    {(inside || (isStart && !!to && !same(from, to)) || (isEnd && !!from && !same(from, to))) && (
                      <View style={{ position: 'absolute', top: 3, bottom: 3, left: isStart ? '50%' : 0, right: isEnd ? '50%' : 0, backgroundColor: c.accentSoft }} />
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${t(WEEKDAYS[d.getDay()])} ${d.getDate()} ${t(MONTHS[d.getMonth()])} ${d.getFullYear()}${isStart ? t(', leaving') : ''}${isEnd ? t(', returning') : ''}`}
                      accessibilityState={{ selected: edge, disabled: off }}
                      disabled={off}
                      onPress={() => pick(d)}
                      style={({ pressed }) => [{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: edge ? c.forest : 'transparent', borderWidth: same(d, today) && !edge ? 1.5 : 0, borderColor: c.green }, pressed && !edge && { backgroundColor: c.accentSoft }]}
                    >
                      <Text style={{ color: edge ? '#fff' : off ? c.line : c.text, fontWeight: edge ? '800' : '600', fontSize: 13 }}>{d.getDate()}</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8 }}>
          {([['start', t('Depart'), from], ['end', t('Return'), to]] as const).map(([k, label, d]) => {
            const on = target === k;
            const locked = k === 'end' && !from; // pick the leaving day first
            return (
              <Pressable
                key={k}
                accessibilityRole="tab"
                accessibilityLabel={`${label}: ${d ? shortDay(d) : t('not chosen')}`}
                accessibilityState={{ selected: on, disabled: locked }}
                disabled={locked}
                onPress={() => setTarget(k)}
                style={{ flex: 1, borderRadius: 12, borderWidth: 1.5, borderColor: on ? c.forest : c.line, backgroundColor: on ? c.accentSoft : 'transparent', paddingVertical: 6, paddingHorizontal: 10, opacity: locked ? 0.55 : 1 }}
              >
                <Text style={{ color: c.muted, fontSize: 10 }}>{label}</Text>
                <Text style={{ color: c.text, fontSize: 13, fontWeight: '800' }}>{d ? shortDay(d) : t('Select date')}</Text>
              </Pressable>
            );
          })}
        </View>
        <Txt variant="small" style={{ textAlign: 'center', color: c.text }}>{summary}</Txt>
        <Btn
          title={t('Done')}
          small
          disabled={!from}
          onPress={() => {
            if (!from) return;
            onDone(isoDay(from), to ? isoDay(to) : ''); // no return day chosen yet: it stays empty, it is not copied from the leaving day
          }}
        />
      </Animated.View>
    </View>
  );
}
