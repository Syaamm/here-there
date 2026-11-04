import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { get } from '@/lib/api';
import { localeTag, useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { Text, TextInput } from './ScaledText';
import type { Place } from './PlaceSearch';
import { StepBars, StepLabel } from './StepMotion';
import { PlainTitle, pressed } from './ui';

/** The four "Host activity" steps (Figma "Host activity 1/4 to 4/4"): back button, title, progress, then the step's content. */

/** The top of every step: round back button, "Host activity" and the step's name in the middle, "Step n/4" and four bars under them. */
export function WizardTop({ step, title, onBack, right }: { step: number; title: string; onBack: () => void; right?: ReactNode }) {
  const { t } = useT();
  const { c, mode } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <PlainTitle
        onBack={onBack}
        custom={
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 16 }}>{t('Host activity')}</Text>
            <Text accessibilityRole="header" numberOfLines={1} style={{ color: c.text, fontSize: 15, lineHeight: 19, fontWeight: '500', textAlign: 'center' }}>{title}</Text>
          </View>
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 }}>
        <StepLabel step={step} style={{ color: c.muted, fontSize: 12.7, lineHeight: 16 }} />
        {right}
      </View>
      <StepBars step={step} track={mode === 'there' ? '#fff' : c.sand} fill={c.forest} />
    </View>
  );
}

/** A section label: forest green, medium weight. */
export function CreateLabel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={style}>
      <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 16, lineHeight: 22, fontWeight: '500', paddingLeft: 2 }}>{children}</Text>
    </View>
  );
}

/** The full-width pill field (one line). */
export function PillInput({ label, style, ...rest }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={c.placeholder}
      selectionColor={c.forest}
      cursorColor={c.forest}
      underlineColorAndroid="transparent"
      returnKeyType="done"
      {...rest}
      style={[{ includeFontPadding: false, minHeight: sc(54), borderWidth: 1, borderRadius: 32, borderColor: c.line, backgroundColor: c.surface, color: c.text, fontSize: 14, paddingHorizontal: 20, paddingVertical: 10 }, style]}
    />
  );
}

/** The roomy rounded box for the description. */
export function PillArea({ label, style, ...rest }: TextInputProps & { label: string }) {
  const { c } = useTheme();
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={c.placeholder}
      multiline
      textAlignVertical="top"
      selectionColor={c.forest}
      cursorColor={c.forest}
      underlineColorAndroid="transparent"
      {...rest}
      style={[{ minHeight: sc(100), borderWidth: 1, borderRadius: 32, borderColor: c.line, backgroundColor: c.surface, color: c.text, fontSize: 14, lineHeight: 20, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 16 }, style]}
    />
  );
}

/** A category: round photo and a word inside a pill. Dark and filled when picked. */
export function CategoryPill({ label, spoken, photo, selected, onPress }: { label: string; spoken: string; photo: ImageSource | number; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2 }}
      style={({ pressed: p }) => [{ width: '31.5%', minHeight: sc(40), borderRadius: 26, borderWidth: 1.2, borderColor: selected ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: selected ? c.forest : c.surface, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4, paddingRight: 8 }, pressed(p)]}
    >
      <Image source={photo} contentFit="cover" style={{ width: 32, height: 32, borderRadius: 16, borderWidth: selected ? 1.5 : 0, borderColor: '#fff' }} accessibilityLabel="" />
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', color: selected ? '#fff' : c.forest, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

/** A small pill choice (am / pm, quick picks, durations, neighbourhoods): white with a thin rim, dark when picked. */
export function SmallPill({ label, spoken, active, onPress }: { label: string; spoken?: string; active: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: 40, paddingHorizontal: 18, borderRadius: 32, borderWidth: 1.2, borderColor: active ? c.forest : 'rgba(0,0,0,0.08)', backgroundColor: active ? c.forest : c.surface, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}
    >
      <Text style={{ color: active ? '#fff' : c.forest, fontSize: 14, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

/** The round "−" / "+" and the arrows: white, 44 px to touch. */
export function RoundBtn({ icon, label, onPress, onLongPress, disabled, size = 44, filled }: { icon: 'add' | 'remove' | 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean; size?: number; filled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed: p }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: filled ? c.surface : 'transparent', borderWidth: filled ? 0 : 1, borderColor: 'rgba(0,0,0,0.09)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }, pressed(p)]}
    >
      <Ionicons name={icon} size={icon === 'add' || icon === 'remove' ? 22 : 18} color={c.text} />
    </Pressable>
  );
}

/** A number between − and +, in a soft pill (the party size). */
export function CountPill({ value, onMinus, onPlus, minusLabel, plusLabel, canMinus, canPlus }: { value: number; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; canMinus: boolean; canPlus: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ alignSelf: 'center', width: '78%', minHeight: 56, borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }}>
      <RoundBtn filled icon="remove" label={minusLabel} disabled={!canMinus} onPress={onMinus} size={44} />
      <Text accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 32, lineHeight: 40, fontWeight: '700' }}>{value}</Text>
      <RoundBtn filled icon="add" label={plusLabel} disabled={!canPlus} onPress={onPlus} size={44} />
    </View>
  );
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * A month to pick the day from. Days outside min..max are greyed and cannot be picked. The arrows change the month,
 * only as far as the first and last day that can be picked.
 */
export function MonthCalendar({ month, onMonth, selected, min, max, onPick }: { month: Date; onMonth: (m: Date) => void; selected: Date; min: Date; max: Date; onPick: (d: Date) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const tag = localeTag() ?? 'en';
  const weekStart = tag.toLowerCase().startsWith('it') ? 1 : 0; // Italian weeks start on Monday
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(2023, 0, 1 + ((i + weekStart) % 7)).toLocaleDateString(tag, { weekday: 'short' })), [tag, weekStart]);
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const lo = startOfDay(min);
  const hi = startOfDay(max);
  const canPrev = new Date(month.getFullYear(), month.getMonth(), 0) >= lo;
  const canNext = new Date(month.getFullYear(), month.getMonth() + 1, 1) <= hi;
  const monthName = first.toLocaleDateString(tag, { month: 'long', year: 'numeric' });
  const sel = startOfDay(selected);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <RoundBtn icon="chevron-back" label={t('Previous month')} disabled={!canPrev} onPress={() => onMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1))} />
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={{ color: c.text, fontSize: 16, fontWeight: '600', textTransform: 'capitalize' }}>{monthName}</Text>
        <RoundBtn icon="chevron-forward" label={t('Next month')} disabled={!canNext} onPress={() => onMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1))} />
      </View>
      <View style={{ flexDirection: 'row' }}>
        {weekdays.map((w, i) => (
          <View key={i} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: 13 }}>{w}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((n, i) => {
          if (n == null) return <View key={i} style={{ width: `${100 / 7}%`, height: 44 }} />;
          const d = new Date(month.getFullYear(), month.getMonth(), n);
          const off = d < lo || d > hi;
          const on = +d === +sel;
          return (
            <View key={i} style={{ width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={d.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' })}
                accessibilityState={{ selected: on, disabled: off }}
                disabled={off}
                onPress={() => onPick(d)}
                style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : 'transparent' }}
              >
                <Text style={{ color: on ? '#fff' : off ? c.placeholder : c.text, fontSize: 13, fontWeight: on ? '500' : '400' }}>{n}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const MIN_CHARS = 3;
const DELAY_MS = 500; // one search per pause in typing

/**
 * The spot: a pill search field over the map search. Picking a result shows it as a card with Change; the typed words
 * stay usable as a plain name when the search finds nothing or is not available, so nobody gets stuck. Same behaviour as
 * the earlier PlaceSearch, in the design's look.
 */
export function PlacePick({ label, text, onText, place, onPlace, city }: { label: string; text: string; onText: (v: string) => void; place: Place | null; onPlace: (p: Place | null) => void; city: string }) {
  const { t } = useT();
  const { c } = useTheme();
  const [found, setFound] = useState<Place[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const latest = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (place || q.length < MIN_CHARS) {
      latest.current++;
      setFound(null);
      setState('idle');
      return;
    }
    const mine = ++latest.current;
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const r = await get<{ items: Place[] }>(`/v1/places/search?${new URLSearchParams({ q, ...(city.trim() && { city: city.trim() }) })}`);
        if (mine !== latest.current) return;
        setFound(r.items);
        setState('done');
      } catch {
        if (mine !== latest.current) return;
        setFound(null);
        setState('error');
      }
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, city, place]);

  if (place) {
    return (
      <View style={{ minHeight: sc(64), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 8 }}>
        <Ionicons name="location" size={22} color={c.forest} />
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ color: c.forest, fontSize: 14, fontWeight: '600' }}>{place.name}</Text>
          {place.address ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{place.address}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Change location, now {name}', { name: place.name })} hitSlop={6} onPress={() => onPlace(null)} style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}>
          <Text style={{ color: c.forest, fontSize: 14, fontWeight: '600' }}>{t('Change')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      <View style={{ minHeight: sc(56), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 }}>
        <Ionicons name="search-outline" size={22} color={c.text} />
        <TextInput
          accessibilityLabel={label}
          placeholder={t('Search a place')}
          placeholderTextColor={c.placeholder}
          selectionColor={c.forest}
          cursorColor={c.forest}
          underlineColorAndroid="transparent"
          returnKeyType="search"
          value={text}
          onChangeText={onText}
          maxLength={100}
          autoCorrect={false}
          style={{ flex: 1, color: c.forest, fontSize: 14, paddingVertical: 12, includeFontPadding: false }}
        />
      </View>
      {state === 'searching' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Searching…')}</Text> : null}
      {state === 'error' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Search unavailable. Type the place name.')}</Text> : null}
      {state === 'done' && found && found.length === 0 ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('No place found.')}</Text> : null}
      {found && found.length > 0 ? (
        <View style={{ borderRadius: 24, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {found.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={t('Use {name}, {address}', { name: p.name, address: p.address })}
              onPress={() => onPlace(p)}
              style={({ pressed: isPressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 18, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, isPressed && { backgroundColor: c.sand }]}
            >
              <Ionicons name="location-outline" size={18} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 14, fontWeight: '600' }}>{p.name}</Text>
                {p.address ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{p.address}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {state === 'done' || state === 'error' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Pick a place to show it on the map.')}</Text> : null}
    </View>
  );
}
