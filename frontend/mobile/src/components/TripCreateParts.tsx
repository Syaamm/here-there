import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { notifyInputFocus, setListBelowField } from '@/lib/keyboard';
import { Pressable, View, type HostInstance, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { get } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { Text, TextInput, type InputHandle } from './ScaledText';
import { tap } from '@/lib/haptics';
import { StepBars, StepLabel } from './StepMotion';
import { PlainTitle, pressed } from './ui';

/** Building blocks of the THERE "Create a trip" wizard: the HERE wizard's look on the ivory page, with white pills. */

const WHITE = '#FFFFFF';

/** Back button, "Create a trip" and the step's name in the middle, "Step n/4" and four bars under them. */
export function TripTop({ step, title, onBack, right, onStep, canStep }: { step: number; title: string; onBack: () => void; right?: ReactNode; /** tapping a step bar jumps to it, where canStep allows */ onStep?: (i: number) => void; canStep?: (i: number) => boolean }) {
  const { t } = useT();
  const { c, mode } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      <PlainTitle
        onBack={onBack}
        custom={
          <View style={{ alignItems: 'center', gap: 2 }}>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13, lineHeight: 16 }}>{t('Create a trip')}</Text>
            <Text accessibilityRole="header" numberOfLines={1} style={{ color: c.text, fontSize: 15, lineHeight: 19, fontWeight: '500', textAlign: 'center' }}>{title}</Text>
          </View>
        }
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 30 }}>
        <StepLabel step={step} style={{ color: c.muted, fontSize: 12.7, lineHeight: 16 }} />
        {right}
      </View>
      <StepBars step={step} track={mode === 'there' ? '#fff' : c.sand} fill={c.forest} onPick={onStep} canPick={canStep} />
    </View>
  );
}

/** The big step heading with its grey promise underneath. */
export function TripHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 10, marginTop: 6 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 34, fontWeight: '600' }}>{title}</Text>
      {subtitle ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 24 }}>{subtitle}</Text> : null}
    </View>
  );
}

/** A section label in the form's dark text. */
export function TripLabel({ children, right, style }: { children: ReactNode; right?: string; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, style]}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 14, lineHeight: 20, fontWeight: '500', paddingLeft: 3 }}>{children}</Text>
      {right ? <Text style={{ color: c.muted, fontSize: 12 }}>{right}</Text> : null}
    </View>
  );
}

/** A big white pill: small grey label above, the value (typed or shown) below. */
export function TripField({ label, children, onPress, a11y, invalid, hint, icon, style }: { label: string; children: ReactNode; onPress?: () => void; a11y?: string; invalid?: boolean; /** a short red line under the pill, shown while it is invalid ("Pick a place from the list") */ hint?: string; /** a small icon inside the pill, at its right edge (the calendar of a date field): part of the field, not a separate button */ icon?: React.ComponentProps<typeof Ionicons>['name']; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const box: StyleProp<ViewStyle> = [{ minHeight: sc(78), borderRadius: 40, backgroundColor: WHITE, borderWidth: invalid ? 1.2 : 0, borderColor: c.danger, paddingLeft: 32, paddingRight: 56, paddingVertical: 12, justifyContent: 'center', gap: 4 }, style];
  const body = (
    <>
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{label}</Text>
      {children}
      {icon ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no" style={{ position: 'absolute', right: 24, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Ionicons name={icon} size={20} color={c.forest} />
        </View>
      ) : null}
    </>
  );
  const pill = onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y ?? label} onPress={onPress} style={({ pressed: p }) => [box, pressed(p)]}>{body}</Pressable>
  ) : (
    <View style={box}>{body}</View>
  );
  if (!(invalid && hint)) return pill;
  return (
    <View style={{ gap: 4 }}>
      {pill}
      <Text accessibilityLiveRegion="polite" style={{ color: c.danger, fontSize: 12, lineHeight: 16, paddingLeft: 32 }}>{hint}</Text>
    </View>
  );
}

/** How the group gets there, the first choice of a trip: leave together from one city, or each on their own and meet there. */
export type TravelStyle = 'together' | 'meet_at_destination';
export function TravelStyleChoice({ value, onChange }: { value: TravelStyle; onChange: (v: TravelStyle) => void }) {
  const { c } = useTheme();
  const { t } = useT();
  const opts: [TravelStyle, React.ComponentProps<typeof Ionicons>['name'], string, string][] = [
    ['together', 'people-outline', t('Travel together'), t('Leave from the same city as your companions')],
    ['meet_at_destination', 'location-outline', t('Meet at destination'), t('Everyone travels on their own and meets there')],
  ];
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('How will the group get there?')} style={{ flexDirection: 'row', gap: 10 }}>
      {opts.map(([v, icon, title, sub]) => {
        const on = value === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${title}. ${sub}`}
            onPress={() => {
              if (!on) tap('Light'); // a small tap when the choice changes (not when the chosen one is tapped again)
              onChange(v);
            }}
            style={({ pressed: p }) => [{ flex: 1, minHeight: sc(112), borderRadius: 26, padding: 16, gap: 6, backgroundColor: on ? c.forest : WHITE }, pressed(p)]}
          >
            <Ionicons name={icon} size={22} color={on ? '#fff' : c.forest} />
            <Text style={{ color: on ? '#fff' : c.text, fontSize: 15, lineHeight: 20, fontWeight: '600' }}>{title}</Text>
            <Text style={{ color: on ? 'rgba(255,255,255,0.8)' : c.muted, fontSize: 12, lineHeight: 16 }}>{sub}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The value text inside a TripField. */
export function TripValue({ children, placeholder }: { children?: string; placeholder?: string }) {
  const { c } = useTheme();
  return <Text numberOfLines={1} style={{ color: children ? c.text : c.muted, fontSize: 16, lineHeight: 22, fontWeight: '500' }}>{children || placeholder}</Text>;
}

/** The text input inside a TripField. */
export function TripInput({ label, style, ...rest }: TextInputProps & { label: string; ref?: Ref<InputHandle> }) {
  const { c } = useTheme();
  return <TextInput accessibilityLabel={label} placeholderTextColor={c.placeholder} selectionColor={c.forest} cursorColor={c.forest} underlineColorAndroid="transparent" returnKeyType="done" {...rest} style={[{ includeFontPadding: false, color: c.text, fontSize: 16, lineHeight: 22, fontWeight: '500', paddingVertical: 0, minHeight: 22, minWidth: 0 }, style]} />;
}

type Found = { id: string; name: string; address: string; label: string };

/**
 * A place, found by searching: as you type, real places from anywhere in the world are listed (countries, regions, cities,
 * neighbourhoods), each named with its country: "Milan, Italy", "Kerala, India". Tap one and it becomes the field's value: the
 * departure city and the destination are only ever set this way (what is typed is just the search).
 */
export function DestinationResults({ text, active, onPick }: { text: string; active: boolean; onPick: (label: string) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [found, setFound] = useState<Found[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const picked = useRef<string | null>(null); // the name a result put in the field, so choosing it does not start another search
  const latest = useRef(0);
  useEffect(() => {
    const q = text.trim();
    const mine = ++latest.current;
    if (!active || q.length < 2 || picked.current === text) {
      setFound(null);
      setState('idle');
      return;
    }
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const r = await get<{ items: (Found & { label?: string })[] }>(`/v1/places/search?${new URLSearchParams({ q, kind: 'destination' })}`);
        if (mine !== latest.current) return;
        setFound(r.items.map((x) => ({ ...x, label: x.label ?? x.name })));
        setState('done');
      } catch {
        if (mine !== latest.current) return;
        setFound(null);
        setState('error');
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [text, active]);
  // when results are showing, the page scrolls so they are above the keyboard (not hidden under it)
  const box = useRef<HostInstance>(null);
  const showing = state !== 'idle';
  useEffect(() => {
    if (!showing) return;
    setListBelowField(box);
    notifyInputFocus();
    return () => setListBelowField(null);
  }, [showing, found]);
  if (state === 'idle') return null;
  const say = (s: string) => <Text style={{ color: c.muted, fontSize: 12, paddingHorizontal: 16, paddingVertical: 10 }}>{s}</Text>;
  return (
    <View ref={box} collapsable={false} style={{ borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
      {state === 'searching' && !found ? say(t('Searching…')) : null}
      {state === 'error' ? say(t('Search is not available right now. Try again in a moment.')) : null}
      {state === 'done' && found?.length === 0 ? say(t('No place found.')) : null}
      {found?.map((p, i) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          accessibilityLabel={p.label}
          onPress={() => {
            picked.current = p.label;
            onPick(p.label);
          }}
          style={({ pressed: isPressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 16, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, isPressed && { backgroundColor: c.sand }]}
        >
          <Ionicons name="location-outline" size={18} color={c.muted} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{p.label}</Text>
            {p.address && p.address !== p.label.split(', ').slice(1).join(', ') ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{p.address}</Text> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** The dark round button between two stacked pills (swap, calendar). Sits on the right edge, half over each pill. */
export function TripRoundDark({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress?: () => void }) {
  const { c } = useTheme();
  const body = (
    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={20} color="#fff" />
    </View>
  );
  if (!onPress) return <View accessibilityElementsHidden importantForAccessibility="no">{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed: p }) => [{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}>{body}</Pressable>
  );
}

/** A round-cornered one-line white pill for a number (the budget). */
export function TripAmount({ label, ...rest }: TextInputProps & { label: string; ref?: Ref<InputHandle> }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, minHeight: sc(54), borderRadius: 32, backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20 }}>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '500' }}>€</Text>
      <TripInput label={label} keyboardType="number-pad" {...rest} style={{ flex: 1 }} />
    </View>
  );
}

/** A pill choice: white, dark green and white text when picked. */
export function TripPill({ label, spoken, active, onPress, wide, icon }: { label: string; spoken?: string; active: boolean; onPress: () => void; wide?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      accessibilityState={{ selected: active }}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: 44, minWidth: wide ? 96 : undefined, paddingHorizontal: 22, borderRadius: 32, backgroundColor: active ? c.forest : WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, pressed(p)]}
    >
      {icon && active ? <Ionicons name={icon} size={15} color="#fff" /> : null}
      {/* the same weight selected or not, so choosing a pill only turns it green and never changes its width */}
      <Text style={{ color: active ? '#fff' : c.text, fontSize: 14, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

/** One white card with rounded corners (the guidelines notice, the review). */
export function TripCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: WHITE, borderRadius: 32, padding: 20, gap: 8 }, style]}>{children}</View>;
}

/** The white page-wide "Continue" hint: a big dark pill like the design. */
export const TRIP_WHITE = WHITE;
