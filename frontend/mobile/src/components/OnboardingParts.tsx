import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, type ImageSource } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { get } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { Text, TextInput } from './ScaledText';
import type { Place } from './PlaceSearch';
import { pressed } from './ui';

/** The sign-up questions (Figma "onboarding 1 to 3"): back and Skip, a progress bar, a question, the choices, Next. */

/** Back button on the left, Skip on the right, and the progress bar under them. `back` is left out on the first question. */
export function OnboardingTop({ progress, onBack, onSkip }: { progress: number; onBack?: () => void; onSkip: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  return (
    <View style={{ gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
        {onBack ? <AuthBack onPress={onBack} /> : <View />}
        <Pressable accessibilityRole="button" hitSlop={10} onPress={onSkip} style={{ minHeight: 44, paddingHorizontal: 4, justifyContent: 'center' }}>
          <Text style={{ color: c.forest, fontSize: 14.7, fontWeight: '500' }}>{t('Skip')}</Text>
        </Pressable>
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
export function InterestTile({ label, photo, selected, onPress }: { label: string; photo: ImageSource | number; selected: boolean; onPress: () => void }) {
  const { c, mode } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed: p }) => [{ flexBasis: '48%', flexGrow: 1, minHeight: sc(62), borderRadius: 32, borderWidth: 1.3, borderColor: 'rgba(0,0,0,0.08)', backgroundColor: selected ? c.forest : mode === 'there' ? '#fff' : c.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 4, paddingRight: 12 }, pressed(p)]}
    >
      <Image source={photo} contentFit="cover" style={{ width: 54, height: 54, borderRadius: 27, borderWidth: selected ? 2 : 0, borderColor: '#fff' }} accessibilityLabel="" />
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

const MIN_CHARS = 3;
const DELAY_MS = 500; // one search per pause in typing

/**
 * "Which city are you usually in?": a pill field with a map search. Picking a result fills in the city's name; whatever
 * is typed is also fine when the search finds nothing or is not available, so nobody gets stuck here.
 */
export function CitySearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const [found, setFound] = useState<Place[] | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const picked = useRef<string | null>(null); // the text a result put in the field, so choosing it does not start another search
  const latest = useRef(0);

  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_CHARS || picked.current === value) {
      latest.current++;
      setFound(null);
      setState('idle');
      return;
    }
    const mine = ++latest.current;
    setState('searching');
    const timer = setTimeout(async () => {
      try {
        const r = await get<{ items: Place[] }>(`/v1/places/search?${new URLSearchParams({ q })}`);
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
  }, [value]);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ minHeight: sc(56), borderRadius: 32, backgroundColor: c.sand, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 }}>
        <Ionicons name="search-outline" size={22} color={c.forest} />
        <TextInput
          accessibilityLabel={t('Your city')}
          placeholder={t('Search your city')}
          placeholderTextColor={c.placeholder}
          value={value}
          onChangeText={onChange}
          maxLength={60}
          autoCorrect={false}
          autoComplete="off"
          style={{ flex: 1, color: c.forest, fontSize: 14, paddingVertical: 12 }}
        />
      </View>
      {state === 'searching' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Searching…')}</Text> : null}
      {state === 'error' ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('Search unavailable. Type the place name.')}</Text> : null}
      {state === 'done' && found && found.length === 0 ? <Text style={{ color: c.muted, fontSize: 12, paddingLeft: 12 }}>{t('No place found.')}</Text> : null}
      {found && found.length > 0 ? (
        <View style={{ borderRadius: 18, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
          {found.map((p, i) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={t('Use {name}, {address}', { name: p.name, address: p.address })}
              onPress={() => {
                picked.current = p.name;
                onChange(p.name);
              }}
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
    </View>
  );
}
