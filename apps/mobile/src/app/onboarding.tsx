import { useRouter } from 'expo-router';
import { useState } from 'react';
import { EmailVerifyCard } from '@/components/EmailVerifyCard';
import { PhoneVerifyCard } from '@/components/PhoneVerifyCard';
import { Btn, ErrorBanner, Field, Pill, Row, Screen, Txt } from '@/components/ui';
import { patch } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { INTERESTS, LANGUAGES } from '@/lib/constants';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

type Step = 'email' | 'phone' | 'profile';

/**
 * Sign-up onboarding (spec 3.1): confirm the email address, then set up the profile.
 * Both steps can be skipped. Browsing never depends on them.
 */
export default function Onboarding() {
  const { me, reload, finishOnboarding } = useMe();
  const { t, tn } = useT();
  const router = useRouter();
  const [step, setStep] = useState<Step>(me?.emailVerified ? 'phone' : 'email');
  const [languages, setLanguages] = useState<string[]>(me?.profile?.languages ?? []);
  const [interests, setInterests] = useState<string[]>(me?.profile?.interests ?? []);
  const [bio, setBio] = useState(me?.profile?.bio ?? '');
  const act = useAction();

  const done = (next?: string) => {
    finishOnboarding();
    router.replace((next ?? '/') as never);
  };
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    const r = await act.run(() => patch('/v1/me/profile', { languages, interests, bio: bio.trim() || null }));
    if (r) {
      await reload();
      done();
    }
  };

  return (
    <Screen maxWidth={600}>
      <Txt variant="small">{t('Step {n} of 3', { n: step === 'email' ? 1 : step === 'phone' ? 2 : 3 })}</Txt>

      {step === 'email' && (
        <>
          <Txt variant="h1">{t('Welcome, {name} 👋', { name: me?.profile?.displayName ?? t('there') })}</Txt>
          <EmailVerifyCard onVerified={() => setStep('phone')} />
          <Btn title={t('Skip for now')} variant="ghost" onPress={() => setStep('phone')} />
        </>
      )}

      {step === 'phone' && (
        <>
          <Txt variant="h1">{t('Add your mobile (optional)')}</Txt>
          <PhoneVerifyCard />
          <Btn title={me?.phoneVerified ? t('Continue') : t('Skip for now')} variant={me?.phoneVerified ? 'primary' : 'ghost'} onPress={() => setStep('profile')} />
        </>
      )}

      {step === 'profile' && (
        <>
          <Txt variant="h1">{t('Make it yours')}</Txt>
          <ErrorBanner message={act.error} />

          <Txt variant="h3">{t('Languages you speak')}</Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {LANGUAGES.map((l) => (
              <Pill key={l} label={l} active={languages.includes(l)} onPress={() => toggle(languages, setLanguages, l)} />
            ))}
          </Row>

          <Txt variant="h3">{t('Interests')}</Txt>
          <Row style={{ flexWrap: 'wrap' }}>
            {INTERESTS.map((i) => (
              <Pill key={i} label={i[0].toUpperCase() + i.slice(1)} active={interests.includes(i)} onPress={() => toggle(interests, setInterests, i)} />
            ))}
          </Row>

          <Field label={t('About you')} placeholder={t('What you like doing')} multiline value={bio} onChangeText={setBio} maxLength={300} hint={`${bio.length}/300`} />

          <Btn title={t('Save and start exploring')} onPress={save} loading={act.busy} />
          <Btn title={t('Skip, just explore')} variant="secondary" onPress={() => done()} />
          <Btn title={t('Verify my identity now')} variant="ghost" onPress={() => done('/verify')} />
        </>
      )}
    </Screen>
  );
}
