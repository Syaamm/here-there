import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { AuthButton } from '@/components/AuthForm';
import { EmailVerifyCard } from '@/components/EmailVerifyCard';
import { useCity } from '@/lib/city';
import { ChoiceRow, CityField, InterestTile, OnboardingHeading, OnboardingTop, RadioRow } from '@/components/OnboardingParts';
import { Btn, ErrorBanner, Screen, Txt } from '@/components/ui';
import { patch } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { keyboardTaps } from '@/lib/keyboard';

type Step = 'email' | 'wishlist' | 'window' | 'companions' | 'interests' | 'city' | 'languages';

/** The activity choices: what is saved on the profile, what the person reads, and the photo (Figma "onboarding 1"). */
const TILES = [
  { key: 'coffee', label: 'Coffee', photo: require('../../assets/interests/coffee.webp') },
  { key: 'food', label: 'Food & Drinks', photo: require('../../assets/interests/food.webp') },
  { key: 'culture', label: 'Culture', photo: require('../../assets/interests/culture.webp') },
  { key: 'fitness', label: 'Fitness', photo: require('../../assets/interests/fitness.webp') },
  { key: 'adventure', label: 'Adventures', photo: require('../../assets/interests/adventure.webp') },
  { key: 'nightlife', label: 'Music & Nightlife', photo: require('../../assets/interests/nightlife.webp') },
];
/** THERE's "travel vibe" choices (Figma page 46): saved in the same `interests` list of the profile. */
const THERE_TILES = [
  { key: 'adventure', label: 'Adventure', photo: require('../../assets/there-onboarding/adventure.webp') },
  { key: 'food', label: 'Food & Local life', photo: require('../../assets/there-onboarding/food.webp') },
  { key: 'culture', label: 'Culture & History', photo: require('../../assets/there-onboarding/culture.webp') },
  { key: 'fitness', label: 'Running & Fitness', photo: require('../../assets/there-onboarding/fitness.webp') },
  { key: 'outdoor', label: 'Outdoor', photo: require('../../assets/there-onboarding/outdoor.webp') },
  { key: 'nightlife', label: 'Nightlife', photo: require('../../assets/there-onboarding/nightlife.webp') },
];
/** THERE's first questions (Figma pages 43 to 45): where, when and with whom. Saved on the profile as private preferences. */
const WISHLIST = [
  { key: 'mountains', label: 'Mountains', photo: require('../../assets/there-wishlist/mountains.webp') },
  { key: 'beaches', label: 'Beaches', photo: require('../../assets/there-wishlist/beaches.webp') },
  { key: 'cities', label: 'Cities', photo: require('../../assets/there-wishlist/cities.webp') },
  { key: 'nature', label: 'Nature', photo: require('../../assets/there-wishlist/nature.webp') },
  { key: 'international', label: 'International', photo: require('../../assets/there-wishlist/international.webp') },
  { key: 'anywhere', label: 'Anywhere', photo: undefined },
];
const WINDOWS = [
  { key: 'month', label: 'Within a month' },
  { key: 'one_to_three', label: 'Next 1–3 months' },
  { key: 'three_to_six', label: 'Next 3–6 months' },
  { key: 'flexible', label: "I'm flexible" },
  { key: 'exploring', label: 'Just exploring for now' },
];
const COMPANIONS = [
  { key: 'one', label: 'One travel companion' },
  { key: 'small_group', label: 'A small group (3–5 people)' },
  { key: 'large_group', label: 'A larger group (6+ people)' },
  { key: 'open', label: "I'm open to anything" },
];
const LANGS = ['English', 'Italian', 'German', 'Spanish', 'Arabic', 'Other'];
/** How full the progress bar is on each question (as drawn in the design). */
const PROGRESS = { interests: 0.19, city: 0.52, languages: 0.81 } as const;
const ORDER: Step[] = ['interests', 'city', 'languages'];
/** THERE asks three more questions first, in the design's order; the bar then fills evenly. */
const ORDER_THERE: Step[] = ['wishlist', 'window', 'companions', 'interests', 'city', 'languages'];

/**
 * Sign-up onboarding: confirm the email address when it is not confirmed yet, then three questions (interests, city,
 * languages). Every question can be skipped, and browsing never depends on the answers.
 */
export default function Onboarding() {
  const { me, reload, finishOnboarding } = useMe();
  const { t } = useT();
  const router = useRouter();
  const there = useTheme().mode === 'there';
  const tiles = there ? THERE_TILES : TILES;
  const order = there ? ORDER_THERE : ORDER;
  const first = order[0];
  const [step, setStep] = useState<Step>(me?.emailVerified ? first : 'email');
  const [interests, setInterests] = useState<string[]>(me?.profile?.interests ?? []);
  const [city, setCity] = useState(me?.profile?.homeCity ?? '');
  const [, pickCity] = useCity(); // the city picked here is also the app's city (with its place on the map) for this account
  const [wishlist, setWishlist] = useState<string[]>(me?.profile?.travelWishlist ?? []);
  const [window, setWindow] = useState<string | null>(me?.profile?.travelWindow ?? null);
  const [companions, setCompanions] = useState<string | null>(me?.profile?.travelCompanions ?? null);
  const [languages, setLanguages] = useState<string[]>(me?.profile?.languages ?? []);
  const act = useAction();

  const done = () => {
    finishOnboarding();
    router.replace('/' as never);
  };
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  /** Saves what was answered (a skipped question leaves what the profile already has) and leaves. */
  const save = async () => {
    const body: Record<string, unknown> = {};
    if (interests.length) body.interests = interests;
    if (languages.length) body.languages = languages;
    if (there) {
      if (wishlist.length) body.travelWishlist = wishlist;
      if (window) body.travelWindow = window;
      if (companions) body.travelCompanions = companions;
    }
    if (city.trim().length >= 2) body.homeCity = city.trim();
    if (!Object.keys(body).length) return done();
    const r = await act.run(() => patch('/v1/me/profile', body));
    if (r) {
      await reload();
      done();
    }
  };

  if (step === 'email')
    return (
      <Screen maxWidth={600}>
        <Txt variant="h1">{t('Welcome, {name} 👋', { name: me?.profile?.displayName ?? t('there') })}</Txt>
        <EmailVerifyCard onVerified={() => setStep(first)} />
        <Btn title={t('Skip for now')} variant="ghost" onPress={() => setStep(first)} />
      </Screen>
    );

  const at = order.indexOf(step);
  const last = at === order.length - 1;
  const next = () => (last ? save() : setStep(order[at + 1]));
  const ready =
    step === 'wishlist' ? wishlist.length > 0 : step === 'window' ? !!window : step === 'companions' ? !!companions : step === 'interests' ? interests.length > 0 : step === 'city' ? city.trim().length >= 2 : languages.length > 0;
  const progress = there ? 0.19 + (at * 0.62) / (order.length - 1) : PROGRESS[step as keyof typeof PROGRESS];

  return (
    <Screen scroll={false} maxWidth={600}>
      <OnboardingTop progress={progress} onBack={at > 0 ? () => setStep(order[at - 1]) : undefined} onSkip={step === 'city' ? undefined : next} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24, paddingBottom: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps={keyboardTaps}>
        {step === 'wishlist' && (
          <>
            <OnboardingHeading title={t('Where would you love to go?')} subtitle={t('Choose a few destinations on your travel wishlist.')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 12 }}>
              {WISHLIST.map((x) => (
                <InterestTile key={x.key} label={t(x.label)} photo={x.photo} selected={wishlist.includes(x.key)} onPress={() => toggle(wishlist, setWishlist, x.key)} />
              ))}
            </View>
          </>
        )}
        {step === 'window' && (
          <>
            <OnboardingHeading title={t('When are you planning to travel?')} subtitle={t("We'll help you discover trips that fit your schedule.")} />
            <View accessibilityRole="radiogroup">
              {WINDOWS.map((x) => (
                <RadioRow key={x.key} label={t(x.label)} selected={window === x.key} onPress={() => setWindow(x.key)} />
              ))}
            </View>
          </>
        )}
        {step === 'companions' && (
          <>
            <OnboardingHeading title={t('Who would you like to travel with?')} subtitle={t('Tell us what kind of travel group feels right for you.')} />
            <View accessibilityRole="radiogroup">
              {COMPANIONS.map((x) => (
                <RadioRow key={x.key} label={t(x.label)} selected={companions === x.key} onPress={() => setCompanions(x.key)} />
              ))}
            </View>
          </>
        )}
        {step === 'interests' && (
          <>
            <OnboardingHeading title={there ? t("What's your travel vibe?") : t('What kinds of activities interest you?')} subtitle={t('Select your interests to discover activities and connect with like-minded people.')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 12 }}>
              {tiles.map((x) => (
                <InterestTile key={x.key} label={t(x.label)} photo={x.photo} selected={interests.includes(x.key)} onPress={() => toggle(interests, setInterests, x.key)} />
              ))}
            </View>
          </>
        )}
        {step === 'city' && (
          <>
            <OnboardingHeading title={t('Which city are you usually in?')} subtitle={t('This helps us find relevant local activities and nearby people.')} />
            {/* picked from the search or found from the phone's location (never typed by hand); the question cannot be skipped */}
            <CityField value={city} onPick={(name, at) => { setCity(name); pickCity(name, at); }} />
          </>
        )}
        {step === 'languages' && (
          <>
            <OnboardingHeading title={t('Which languages are you comfortable communicating in?')} />
            <View>
              {LANGS.map((l) => (
                <ChoiceRow key={l} label={t(l)} selected={languages.includes(l)} onPress={() => toggle(languages, setLanguages, l)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <ErrorBanner message={act.error} />
      <AuthButton title={t('Next')} onPress={next} loading={act.busy} disabled={!ready} />
    </Screen>
  );
}
