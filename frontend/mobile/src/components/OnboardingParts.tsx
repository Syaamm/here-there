import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Pressable, View } from 'react-native';
import { approximateFix } from '@/features/mapShared';
import { get } from '@/lib/api';
import type { Near } from '@/lib/city';
import { tap } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { RoundPhoto } from './CreateParts';
import { Text, TextInput } from './ScaledText';
import type { Place } from './PlaceSearch';
import { pressed } from './ui';

/** The sign-up questions (Figma "onboarding 1 to 3"): back and Skip, a progress bar, a question, the choices, Next. */

/** Back button on the left, Skip on the right, and the progress bar under them. `back` is left out on the first question. */
export function OnboardingTop({ progress, onBack, onSkip }: { progress: number; onBack?: () => void; /** left out where the question cannot be skipped */ onSkip?: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  return (
    <View style={{ gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        {onBack ? <AuthBack onPress={onBack} /> : <View />}
        {onSkip ? (
          <Pressable accessibilityRole="button" hitSlop={10} onPress={onSkip} style={{ minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' }}>
            <Text style={{ color: c.forest, fontSize: 14.7, fontWeight: '500' }}>{t('Skip')}</Text>
          </Pressable>
        ) : (
          <View />
        )}
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={{ height: 6, borderRadius: 65, backgroundColor: c.sand, justifyContent: 'center' }}>
        <View style={{ width: `${progress * 100}%`, height: 4, marginLeft: 0, borderRadius: 65, backgroundColor: c.forest }} />
      </View>
    </View>
  );
}

/** The question and the line under it. */
export function OnboardingHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: 10, marginTop: 6 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 24, lineHeight: 32, fontWeight: '600' }}>{title}</Text>
      {subtitle ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 22 }}>{subtitle}</Text> : null}
    </View>
  );
}

/** A rounded choice with a round photo on the left. Dark and filled when picked. */
export function InterestTile({ label, photo, selected, onPress }: { label: string; photo?: ImageSource | number; selected: boolean; onPress: () => void }) {
  const { c, mode } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed: p }) => [{ flexBasis: '48%', flexGrow: 1, minHeight: sc(62), borderRadius: 999, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: selected ? c.forest : mode === 'there' ? '#fff' : c.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: photo ? sc(4) : 0, paddingLeft: photo ? sc(4) : 22, paddingRight: 12 }, pressed(p)]}
    >
      {photo ? <RoundPhoto source={photo} size={sc(54)} ring={selected} /> : null}
      <Text numberOfLines={2} style={{ flex: 1, color: selected ? '#fff' : c.forest, fontSize: mode === 'there' ? 12 : 13 }}>{label}</Text>
    </Pressable>
  );
}

/** A line with a round marker on the left: a dot inside when picked. Several can be picked, so it speaks as a checkbox. */
export function ChoiceRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c, mode } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={onPress} style={({ pressed: p }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 }, pressed(p)]}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: c.forest, backgroundColor: mode === 'there' ? '#fff' : undefined, alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.forest }} /> : null}
      </View>
      <Text style={{ color: c.forest, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

/** A line with a round marker on the left, for a question with one answer. Speaks as a radio button. */
export function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected, checked: selected }} onPress={onPress} style={({ pressed: p }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 44 }, pressed(p)]}>
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: selected ? 1 : 0, borderColor: c.forest, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.forest }} /> : null}
      </View>
      <Text style={{ color: c.forest, fontSize: 16 }}>{label}</Text>
    </Pressable>
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
      <View style={{ minHeight: sc(56), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 8 }}>
        <Ionicons name="location" size={20} color={c.forest} />
        <Text accessibilityLabel={t('Your city: {city}', { city: value })} numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 15, fontWeight: '600' }}>{value}</Text>
        <Ionicons name="checkmark-circle" size={20} color={c.forest} />
        <Pressable accessibilityRole="button" accessibilityLabel={t('Change city')} hitSlop={6} onPress={() => setEditing(true)} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <Text style={{ color: c.forest, fontSize: 14, fontWeight: '600' }}>{t('Change')}</Text>
        </Pressable>
      </View>
    );

  const say = (text: string) => <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{text}</Text>;
  return (
    <View style={{ gap: 10 }}>
      <View style={{ minHeight: sc(56), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 }}>
        <Ionicons name="search-outline" size={22} color={c.forest} />
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
          style={{ flex: 1, color: c.forest, fontSize: 14, paddingVertical: 12, includeFontPadding: false }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('Use my location')}
        accessibilityState={{ busy: loc === 'locating' }}
        onPress={useMyLocation}
        style={({ pressed: isPressed }) => [{ minHeight: sc(52), borderRadius: 32, borderWidth: 1.2, borderColor: c.forest, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, isPressed && { opacity: 0.7 }]}
      >
        {loc === 'locating' ? <ActivityIndicator size="small" color={c.forest} /> : <Ionicons name="navigate-outline" size={18} color={c.forest} />}
        <Text style={{ color: c.forest, fontSize: 15, fontWeight: '600' }}>{loc === 'locating' ? t('Finding your city…') : t('Use my location')}</Text>
      </Pressable>
      {loc === 'denied' ? say(t('Location is off. Search your city instead, or try again.')) : null}
      {loc === 'blocked' ? (
        <View style={{ gap: 4 }}>
          {say(t('Location is blocked for this app. Search your city, or allow it in your phone settings.'))}
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void Linking.openSettings()} style={{ paddingLeft: 12, minHeight: 36, justifyContent: 'center' }}>
            <Text style={{ color: c.forest, fontSize: 13, fontWeight: '600' }}>{t('Open settings')}</Text>
          </Pressable>
        </View>
      ) : null}
      {loc === 'failed' ? say(t("Couldn't find your city from your location. Search it instead.")) : null}
      {state === 'searching' ? say(t('Searching…')) : null}
      {state === 'error' ? say(t('City search is not available right now. Try again in a moment.')) : null}
      {state === 'done' && found && found.length === 0 ? say(t('No city found with that name.')) : null}
      {found && found.length > 0 ? (
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {found.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={p.address ? `${p.name}, ${p.address}` : p.name}
              onPress={() => pick(p.name, { lat: p.lat, lng: p.lng })}
              style={({ pressed: isPressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 16, minHeight: 48, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }, isPressed && { backgroundColor: c.sand }]}
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
      {value ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setEditing(false)} style={{ minHeight: 36, justifyContent: 'center', paddingLeft: 12 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>{t('Keep {city}', { city: value })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
