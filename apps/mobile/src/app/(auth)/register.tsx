import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Btn, CheckRow, ErrorBanner, Field, Screen, Txt } from '@/components/ui';
import { post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';

/** 18+ confirmation is required here; identity verification comes later, before hosting or joining. */
export default function Register() {
  const router = useRouter();
  const { t, tn } = useT();
  const { signIn } = useMe();
  const [f, setF] = useState({ displayName: '', email: '', password: '', homeCity: 'Milan' });
  const [adult, setAdult] = useState(false);
  const act = useAction();
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  const valid = f.displayName.trim().length >= 2 && /\S+@\S+\.\S+/.test(f.email) && f.password.length >= 10 && adult;
  const submit = () =>
    act.run(async () => {
      const r = await post<{ token: string; devCode?: string }>('/v1/auth/register', {
        displayName: f.displayName.trim(),
        email: f.email.trim(),
        password: f.password,
        homeCity: f.homeCity.trim() || undefined,
        adultConfirmed: adult,
      });
      // fresh: true sends the new user through onboarding (confirm email, set up profile) once
      await signIn(r.token, { fresh: true, devCode: r.devCode });
    });

  return (
    <Screen maxWidth={520}>
      <Btn title={t('‹ Back')} variant="ghost" small onPress={() => router.back()} style={{ alignSelf: 'flex-start' }} />
      <Txt variant="h1">{t('Create your account')}</Txt>
      <ErrorBanner message={act.error} />
      <Field label={t('Display name')} value={f.displayName} onChangeText={set('displayName')} maxLength={40} autoComplete="nickname" />
      <Field label={t('Email')} value={f.email} onChangeText={set('email')} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t('Password')} hint={t('At least {n} characters', { n: 10 })} value={f.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Field label={t('Home city')} hint={t('City only, never an address')} value={f.homeCity} onChangeText={set('homeCity')} maxLength={60} />
      <CheckRow checked={adult} onChange={setAdult}>
        <Txt>{t('I confirm that I am 18 or older.')}</Txt>
      </CheckRow>
      <Btn title={t('Create account')} onPress={submit} loading={act.busy} disabled={!valid} />
      <Txt variant="small">
        {t("We'll email you a code. We never show your documents to anyone.")}
      </Txt>
      <Btn title={t('Already have an account? Log in')} variant="ghost" onPress={() => router.replace('/login')} />
    </Screen>
  );
}
