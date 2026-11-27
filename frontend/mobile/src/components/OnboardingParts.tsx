import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Keyboard, Linking, Pressable, View } from 'react-native';
import { approximateFix } from '@/features/mapShared';
import { get } from '@/lib/api';
import type { Near } from '@/lib/city';
import { tap } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { sc, sp, sph } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { RoundPhoto } from './CreateParts';
import { Text, TextInput } from './ScaledText';
import type { Place } from './PlaceSearch';
import { TogglePill } from './ProfileParts';
import { Reveal } from './Reveal';
import { StepBars } from './StepMotion';
import { pressed } from './ui';

/** The sign-up questions (Figma "onboarding 1 to 3"): back and Skip, a progress bar, a question, the choices, Next. */

/** Back button on the left, Skip on the right, and the progress bar under them. `back` is left out on the first question. */
export function OnboardingTop({ progress, onBack, onSkip, steps }: { progress: number; onBack?: () => void; /** left out where the question cannot be skipped */ onSkip?: () => void; /** the questions as steps: tap a bar to go to it (where `canPick` allows), like the steps of creating an activity */ steps?: { at: number; count: number; onPick: (i: number) => void; canPick: (i: number) => boolean } }) {
  const { t } = useT();
  const { c, mode } = useTheme();
  // the bar fills to its new place instead of jumping (it also fills in once when the first question opens)
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: progress, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [progress, fill]);
  return (
    <View style={{ gap: sp(18) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: sc(44) }}>
        {onBack ? <AuthBack onPress={onBack} /> : <View />}
        {onSkip ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onSkip} style={{ minHeight: sc(44), paddingHorizontal: sph(4), justifyContent: 'center' }}>
            <Text style={{ color: c.forest, fontSize: 16, fontWeight: '500' }}>{t('Skip')}</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>
      {steps ? (
        <StepBars step={steps.at} count={steps.count} track={mode === 'there' ? '#fff' : c.sand} fill={c.forest} onPick={steps.onPick} canPick={steps.canPick} />
      ) : (
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={{ height: sc(6), borderRadius: sc(65), backgroundColor: mode === 'there' ? '#fff' : c.sand, justifyContent: 'center' }}>
        <Animated.View style={{ width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), height: sc(4), marginLeft: 0, borderRadius: sc(65), backgroundColor: c.forest }} />
      </View>
      )}
    </View>
  );
}

/** The question and the line under it. */
export function OnboardingHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <Reveal from={10} style={{ gap: sp(10), marginTop: sp(6) }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 22, lineHeight: 29, fontWeight: '700' }}>{title}</Text>
      {subtitle ? <Text style={{ color: c.muted, fontSize: 16, lineHeight: 25 }}>{subtitle}</Text> : null}
    </Reveal>
  );
}

/**
 * A rounded choice with a round photo on the left. Picking one fades it to dark (fill, border and label together, about a fifth of a
 * second, no bounce) and fades a small check in at the right edge. The tile never grows or moves, so it stays inside its padding.
 */
export function InterestTile({ label, photo, selected, onPress, index = 0 }: { label: string; photo?: ImageSource | number; selected: boolean; onPress: () => void; /** its place in the list: the tiles ease in one after another */ index?: number }) {
  const { c, mode } = useTheme();
  // 0 = not picked, 1 = picked: one value drives everything that changes, so it all moves as one
  const v = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: selected ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [selected, v]);
  const rest = mode === 'there' ? '#fff' : c.surface;
  const fill = v.interpolate({ inputRange: [0, 1], outputRange: [rest, c.forest] });
  const edge = v.interpolate({ inputRange: [0, 1], outputRange: ['rgba(0,0,0,0.08)', c.forest] });
  return (
    <Reveal index={index + 1} style={{ flexBasis: '48%', flexGrow: 1 }}>
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={() => {
        tap('Light');
        onPress();
      }}
      style={({ pressed: p }) => [{ minHeight: sc(62), borderRadius: sc(999), flexDirection: 'row', alignItems: 'center', gap: sp(10), paddingVertical: photo ? sp(4) : 0, paddingLeft: photo ? sph(4) : sph(22), paddingRight: sph(12) }, pressed(p)]}
    >
      {/* the fill and the edge sit behind the content and fade between the two looks */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: sc(999), borderWidth: 1, backgroundColor: fill, borderColor: edge }} />
      {photo ? <RoundPhoto source={photo} size={sc(54)} ring={selected} /> : null}
      {/* two copies of the label, one dark and one white, cross-fade: a text colour cannot be animated smoothly on its own */}
      <View style={{ flex: 1 }}>
        <Animated.View style={{ opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
          <Text numberOfLines={2} style={{ color: c.forest, fontSize: 12 }}>{label}</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, right: 0, top: 0, opacity: v }}>
          <Text numberOfLines={2} style={{ color: '#fff', fontSize: 12 }}>{label}</Text>
        </Animated.View>
      </View>
      {/* the check: always takes its space, so the label never shifts; it only fades in */}
      <Animated.View style={{ width: sc(24), height: sc(24), borderRadius: sc(12), backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) }] }}>
        <Ionicons name="checkmark" size={sc(16)} color={c.forest} />
      </Animated.View>
    </Pressable>
    </Reveal>
  );
}

/** One of several answers (languages): the same pill as in Edit profile, filled deep forest when picked. No growing, no sliding. */
export function ChoiceRow({ label, selected, onPress, index = 0 }: { label: string; selected: boolean; onPress: () => void; index?: number }) {
  return (
    <Reveal index={index + 1}>
      <TogglePill
        label={label}
        on={selected}
        onPress={() => {
          tap('Light');
          onPress();
        }}
      />
    </Reveal>
  );
}

/** A line with a round marker on the left, for a question with one answer. Speaks as a radio button. */
export function RadioRow({ label, selected, onPress, index = 0 }: { label: string; selected: boolean; onPress: () => void; index?: number }) {
  const { c } = useTheme();
  return (
    <Reveal index={index + 1}>
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, checked: selected }} onPress={() => {
      tap('Light');
      onPress();
    }} style={({ pressed: p }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(14), minHeight: sc(44) }, pressed(p)]}>
      {/* the same ring whether picked or not (so nothing shifts), with the dot centred in it */}
      <View style={{ width: sc(22), height: sc(22), borderRadius: sc(11), borderWidth: 1.5, borderColor: selected ? c.forest : c.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: sc(12), height: sc(12), borderRadius: sc(6), backgroundColor: c.forest }} /> : null}
      </View>
      <Text style={{ color: c.forest, fontSize: 16 }}>{label}</Text>
    </Pressable>
    </Reveal>
  );
}

const MIN_CHARS = 2;
const DELAY_MS = 350; // one search per pause in typing

/**
 * "Which city are you usually in?": the city is picked, never typed by hand, so names are always real and the same everywhere.
 * Either search for it, or tap "Use my location": the phone asks for permission at that moment (and only then), one reading is
 * taken to find the city, and nothing is tracked or stored. Once picked it shows as a chip with "Change".
 */
export function CityField({ value, onPick }: { value: string; onPick: (name: string, at: Near) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [editing, setEditing] = useState(!value);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [loc, setLoc] = useState<null | 'locating' | 'denied' | 'blocked' | 'failed'>(null);
  const latest = useRef(0);

  useEffect(() => {
    const text = q.trim();
    const mine = ++latest.current;
    if (text.length < MIN_CHARS) {
      setFound(null);
      setState('idle');
      return;
    }
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const r = await get<{ items: Place[] }>(`/v1/places/search?${new URLSearchParams({ q: text, kind: 'city' })}`);
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
  }, [q]);

  const pick = (name: string, at: Near) => {
    Keyboard.dismiss();
    tap('Medium');
    latest.current++;
    onPick(name, at);
    setEditing(false);
    setQ('');
    setFound(null);
    setState('idle');
    setLoc(null);
  };

  const useMyLocation = async () => {
    if (loc === 'locating') return;
    Keyboard.dismiss();
    setLoc('locating');
    const fix = await approximateFix(); // the phone's own pop-up appears here: allow once / while using the app / don't allow
    if (!fix.ok) return setLoc(fix.reason === 'denied' ? (fix.canAskAgain === false ? 'blocked' : 'denied') : 'failed');
    try {
      const here = await get<Place | null>(`/v1/places/reverse?${new URLSearchParams({ lat: String(fix.lat), lng: String(fix.lng) })}`);
      if (!here) return setLoc('failed');
      pick(here.name, { lat: here.lat, lng: here.lng });
    } catch {
      setLoc('failed');
    }
  };

  if (!editing && value)
    return (
      <View style={{ minHeight: sc(56), borderRadius: sc(32), backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: sp(12), paddingLeft: sph(20), paddingRight: sph(8) }}>
        <Ionicons name="location" size={sc(20)} color={c.forest} />
        <Text accessibilityLabel={t('Your city: {city}', { city: value })} numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{value}</Text>
        <Ionicons name="checkmark-circle" size={sc(20)} color={c.forest} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Change city')} hitSlop={6} onPress={() => setEditing(true)} style={{ minHeight: sc(44), paddingHorizontal: sph(10), justifyContent: 'center' }}>
          <Text style={{ color: c.forest, fontSize: 16, fontWeight: '600' }}>{t('Change')}</Text>
        </Pressable>
      </View>
    );

  const say = (text: string) => <Text style={{ color: c.muted, fontSize: 12, paddingLeft: sph(12) }}>{text}</Text>;
  return (
    <View style={{ gap: sp(10) }}>
      <View style={{ minHeight: sc(56), borderRadius: sc(32), backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: sp(12), paddingHorizontal: sph(20) }}>
        <Ionicons name="search-outline" size={sc(22)} color={c.forest} />
        <TextInput
          accessibilityLabel={t('Your city')}
          placeholder={t('Search your city')}
          placeholderTextColor={c.placeholder}
          selectionColor={c.forest}
          cursorColor={c.forest}
          underlineColorAndroid="transparent"
          returnKeyType="search"
          value={q}
          onChangeText={setQ}
          maxLength={60}
          autoCorrect={false}
          autoComplete="off"
          style={{ flex: 1, color: c.forest, fontSize: 16, paddingVertical: sp(12), includeFontPadding: false }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Use my location')}
        accessibilityState={{ busy: loc === 'locating' }}
        onPress={useMyLocation}
        style={({ pressed: isPressed }) => [{ minHeight: sc(52), borderRadius: sc(32), borderWidth: 1.2, borderColor: c.forest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(10) }, isPressed && { opacity: 0.7 }]}
      >
        {loc === 'locating' ? <ActivityIndicator size="small" color={c.forest} /> : <Ionicons name="navigate-outline" size={sc(18)} color={c.forest} />}
        <Text style={{ color: c.forest, fontSize: 16, fontWeight: '600' }}>{loc === 'locating' ? t('Finding your city…') : t('Use my location')}</Text>
      </Pressable>
      {loc === 'denied' ? say(t('Location is off. Search your city instead, or try again.')) : null}
      {loc === 'blocked' ? (
        <View style={{ gap: sp(4) }}>
          {say(t('Location is blocked for this app. Search your city, or allow it in your phone settings.'))}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void Linking.openSettings()} style={{ paddingLeft: sph(12), minHeight: sc(36), justifyContent: 'center' }}>
            <Text style={{ color: c.forest, fontSize: 12, fontWeight: '600' }}>{t('Open settings')}</Text>
          </Pressable>
        </View>
      ) : null}
      {loc === 'failed' ? say(t("Couldn't find your city from your location. Search it instead.")) : null}
      {state === 'searching' ? say(t('Searching…')) : null}
      {state === 'error' ? say(t('City search is not available right now. Try again in a moment.')) : null}
      {state === 'done' && found && found.length === 0 ? say(t('No city found with that name.')) : null}
      {found && found.length > 0 ? (
        <View style={{ borderRadius: sc(18), borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {found.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={p.address ? `${p.name}, ${p.address}` : p.name}
              onPress={() => pick(p.name, { lat: p.lat, lng: p.lng })}
              style={({ pressed: isPressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: sp(10), paddingVertical: sp(11), paddingHorizontal: sph(16), minHeight: sc(48), borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, isPressed && { backgroundColor: c.sand }]}
            >
              <Ionicons name="location-outline" size={sc(18)} color={c.muted} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{p.name}</Text>
                {p.address ? <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{p.address}</Text> : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {value ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditing(false)} style={{ minHeight: sc(36), justifyContent: 'center', paddingLeft: sph(12) }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>{t('Keep {city}', { city: value })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
