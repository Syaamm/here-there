import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { AuthButton } from '@/components/AuthForm';
import { EmailVerifyCard } from '@/components/EmailVerifyCard';
import { ChoiceRow, CitySearch, InterestTile, OnboardingHeading, OnboardingTop } from '@/components/OnboardingParts';
import { Btn, ErrorBanner, Screen, Txt } from '@/components/ui';
import { patch } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

type Step = 'email' | 'interests' | 'city' | 'languages';

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
const LANGS = ['English', 'Italian', 'German', 'Spanish', 'Arabic', 'Other'];
/** How full the progress bar is on each question (as drawn in the design). */
const PROGRESS = { interests: 0.19, city: 0.52, languages: 0.81 } as const;
const ORDER: Step[] = ['interests', 'city', 'languages'];

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
  const [step, setStep] = useState<Step>(me?.emailVerified ? 'interests' : 'email');
  const [interests, setInterests] = useState<string[]>(me?.profile?.interests ?? []);
  const [city, setCity] = useState(me?.profile?.homeCity ?? '');
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
        <EmailVerifyCard onVerified={() => setStep('interests')} />
        <Btn title={t('Skip for now')} variant="ghost" onPress={() => setStep('interests')} />
      </Screen>
    );

  const at = ORDER.indexOf(step);
  const last = at === ORDER.length - 1;
  const next = () => (last ? save() : setStep(ORDER[at + 1]));
  const ready = step === 'interests' ? interests.length > 0 : step === 'city' ? city.trim().length >= 2 : languages.length > 0;

  return (
    <Screen scroll={false} maxWidth={600}>
      <OnboardingTop progress={PROGRESS[step]} onBack={at > 0 ? () => setStep(ORDER[at - 1]) : undefined} onSkip={next} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 24, paddingBottom: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
            <CitySearch value={city} onChange={setCity} />
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
